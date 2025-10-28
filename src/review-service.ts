import { GitHubCLI } from './github-cli';
import { PRReviewer } from './pr-reviewer';
import { PullRequest, ReviewCriteria } from './types';
import { AIReviewService, AIReviewResult, AIComment } from './ai-review-service';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

export class ReviewService {
  private githubCLI: GitHubCLI;
  private prReviewer: PRReviewer;
  private username: string = '';
  private repository: string;
  private teamNames: string[];
  private userNames: string[];
  private ignoredPRs: Set<number>;
  private ignoreListPath: string;
  private aiReviewService?: AIReviewService;

  constructor(repository: string, teamNames: string[] = [], userNames: string[] = [], criteria?: Partial<ReviewCriteria>) {
    this.githubCLI = new GitHubCLI();
    this.prReviewer = new PRReviewer(criteria);
    this.repository = repository;
    this.teamNames = teamNames;
    this.userNames = userNames;
    this.ignoredPRs = new Set<number>();
    this.ignoreListPath = path.join(process.cwd(), '.ignored-prs.json');
    this.loadIgnoredPRs();
    
    // Initialize AI review service if API key is available
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (geminiApiKey) {
      this.aiReviewService = new AIReviewService(geminiApiKey);
      console.log('🤖 AI review enabled with Gemini');
    } else {
      console.log('⚠️  AI review disabled - GEMINI_API_KEY not found');
    }
  }

  async initialize(): Promise<void> {
    const user = await this.githubCLI.getCurrentUser();
    this.username = user.login;
    console.log(`Initialized for user: ${this.username}`);
  }

  async reviewPendingPRs(dryRun: boolean = false): Promise<void> {
    console.log('🔍 Fetching PRs from repository...\n');

    const [owner, repo] = this.repository.split('/');
    
    // Get PRs based on assignments using GitHub CLI search
    const filteredPRs = await this.getPRsByAssignments(owner, repo);
    console.log(`🔍 Found ${filteredPRs.length} PRs matching your criteria\n`);

    if (filteredPRs.length === 0) {
      console.log('🎉 No PRs match your filter criteria!');
      return;
    }

    let approvedCount = 0;
    let openedCount = 0;
    let skippedCount = 0;
    let ignoredCount = 0;

    for (const pr of filteredPRs) {
      console.log(`\n📋 ${this.prReviewer.getPRSummary(pr)}`);
      console.log(`🔗 ${pr.html_url}`);

      const isSimple = this.prReviewer.isSimplePR(pr);
      if (isSimple) {
        console.log('✅ This PR looks simple');
      } else {
        console.log('⚠️  This PR is large or complex');
      }

      const action = await this.askUserAction(pr, dryRun);
      
      // Handle AI review if requested
      if (action === 'ai' && this.aiReviewService) {
        await this.handleAIReview(pr, dryRun);
        continue;
      }
      
      switch (action) {
        case 'a':
          if (dryRun) {
            console.log('🔍 [DRY RUN] Would approve this PR');
          } else {
            try {
              const comment = this.prReviewer.getApprovalComment(pr);
              await this.githubCLI.approvePullRequest(
                pr.repository.owner.login,
                pr.repository.name,
                pr.number,
                comment
              );
              console.log('✅ Approved!');
            } catch (error) {
              console.error('❌ Failed to approve PR:', error);
            }
          }
          approvedCount++;
          break;
        case 'o':
          console.log(`🔗 Opening ${pr.html_url} in browser...`);
          if (!dryRun) {
            const { exec } = require('child_process');
            exec(`open "${pr.html_url}"`);
          } else {
            console.log('🔍 [DRY RUN] Would open browser');
          }
          openedCount++;
          break;
        case 's':
          console.log('⏭️  Skipped');
          skippedCount++;
          break;
        case 'i':
          console.log('🚫 Ignored (will not be shown again)');
          this.addIgnoredPR(pr.number);
          ignoredCount++;
          break;
      }
    }

    console.log('\n📊 Summary:');
    console.log(`✅ Approved: ${approvedCount}`);
    console.log(`🔗 Opened: ${openedCount}`);
    console.log(`⏭️  Skipped: ${skippedCount}`);
    console.log(`🚫 Ignored: ${ignoredCount}`);
  }

  private async getPRsByAssignments(owner: string, repo: string): Promise<PullRequest[]> {
    const allPRs: PullRequest[] = [];
    const seenPRs = new Set<number>();

    // Get PRs where current user is directly assigned
    if (this.userNames.length === 0 || this.userNames.includes(this.username)) {
      console.log(`🔍 Searching for PRs assigned to ${this.username}...`);
      const userPRs = await this.githubCLI.getPullRequestsForReview(this.username, owner, repo);
      for (const pr of userPRs) {
        if (!seenPRs.has(pr.number)) {
          allPRs.push(pr);
          seenPRs.add(pr.number);
          console.log(`✅ PR #${pr.number} included: directly assigned as reviewer`);
        }
      }
    }

    // Get PRs assigned to teams
    for (const teamName of this.teamNames) {
      console.log(`🔍 Searching for PRs assigned to team ${teamName}...`);
      const teamPRs = await this.githubCLI.getPullRequestsForTeamReview(owner, teamName, repo);
      for (const pr of teamPRs) {
        if (!seenPRs.has(pr.number)) {
          // Check if current user is actually in the team
          const isUserInTeam = await this.githubCLI.isUserInTeam(owner, teamName, this.username);
          if (isUserInTeam) {
            allPRs.push(pr);
            seenPRs.add(pr.number);
            console.log(`✅ PR #${pr.number} included: assigned via team ${teamName}`);
          }
        }
      }
    }

    // Get PRs assigned to specific users
    for (const userName of this.userNames) {
      if (userName !== this.username) { // Don't duplicate if we already checked current user
        console.log(`🔍 Searching for PRs assigned to user ${userName}...`);
        const userPRs = await this.githubCLI.getPullRequestsForReview(userName, owner, repo);
        for (const pr of userPRs) {
          if (!seenPRs.has(pr.number)) {
            allPRs.push(pr);
            seenPRs.add(pr.number);
            console.log(`✅ PR #${pr.number} included: user ${userName} is assigned as reviewer`);
          }
        }
      }
    }

    // Filter out ignored PRs
    const filteredPRs = allPRs.filter(pr => !this.isPRIgnored(pr.number));
    
    if (allPRs.length > filteredPRs.length) {
      const ignoredCount = allPRs.length - filteredPRs.length;
      console.log(`🚫 Filtered out ${ignoredCount} ignored PRs from previous sessions`);
    }
    
    return filteredPRs;
  }

  private loadIgnoredPRs(): void {
    try {
      if (fs.existsSync(this.ignoreListPath)) {
        const data = fs.readFileSync(this.ignoreListPath, 'utf8');
        const ignoredList = JSON.parse(data);
        this.ignoredPRs = new Set(ignoredList);
        console.log(`📝 Loaded ${this.ignoredPRs.size} ignored PRs from previous sessions`);
      }
    } catch (error) {
      console.warn('⚠️  Could not load ignored PRs list:', error);
      this.ignoredPRs = new Set<number>();
    }
  }

  private saveIgnoredPRs(): void {
    try {
      const ignoredList = Array.from(this.ignoredPRs);
      fs.writeFileSync(this.ignoreListPath, JSON.stringify(ignoredList, null, 2));
    } catch (error) {
      console.warn('⚠️  Could not save ignored PRs list:', error);
    }
  }

  private addIgnoredPR(prNumber: number): void {
    this.ignoredPRs.add(prNumber);
    this.saveIgnoredPRs();
  }

  private isPRIgnored(prNumber: number): boolean {
    return this.ignoredPRs.has(prNumber);
  }

  private async askUserAction(pr: PullRequest, dryRun: boolean): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
    const aiOption = this.aiReviewService ? ', AI Review (A)' : '';
    const prompt = `What do you want to do? Approve (a), Open (o), Skip (s), Ignore (i)${aiOption}: `;
      
      rl.question(prompt, (answer) => {
        const action = answer.trim();
        const validActions = ['a', 'o', 's', 'i'];
        if (this.aiReviewService) {
          validActions.push('A');
        }
        
        if (validActions.includes(action)) {
          rl.close();
          // Convert 'A' to 'ai' for AI review, others to lowercase
          if (action === 'A') {
            resolve('ai');
          } else {
            resolve(action.toLowerCase());
          }
        } else {
          console.log(`❌ Invalid choice. Please enter ${validActions.join(', ')}.`);
          rl.close();
          resolve(this.askUserAction(pr, dryRun));
        }
      });
    });
  }

  private async handleAIReview(pr: PullRequest, dryRun: boolean): Promise<void> {
    if (!this.aiReviewService) {
      console.log('❌ AI review not available');
      return;
    }

    console.log('🤖 Running AI review...');
    
    try {
      // Get PR diff
      const [owner, repo] = this.repository.split('/');
      const diff = await this.githubCLI.getPullRequestDiff(owner, repo, pr.number);
      
      // Run AI review
      const aiResult = await this.aiReviewService.reviewPR(pr.title, pr.body || '', diff);
      
      console.log(`\n🤖 AI Review Result: ${aiResult.action.toUpperCase()}`);
      
      if (aiResult.action === 'approve') {
        console.log('✅ AI recommends approval without comments');
        if (aiResult.approvalMessage) {
          console.log(`💬 Approval message: ${aiResult.approvalMessage}`);
        }
        
        const confirm = await this.askYesNo('Approve this PR? (y/n): ');
        if (confirm) {
          if (dryRun) {
            console.log('🔍 [DRY RUN] Would approve this PR');
          } else {
            try {
              const comment = aiResult.approvalMessage || 'LGTM! 👍';
              await this.githubCLI.approvePullRequest(
                pr.repository.owner.login,
                pr.repository.name,
                pr.number,
                comment
              );
              console.log('✅ Approved!');
            } catch (error) {
              console.error('❌ Failed to approve PR:', error);
            }
          }
        }
      } else if (aiResult.action === 'approve_with_comments') {
        console.log('✅ AI recommends approval with comments');
        if (aiResult.approvalMessage) {
          console.log(`💬 Approval message: ${aiResult.approvalMessage}`);
        }
        
        // Show comments first
        if (aiResult.comments.length > 0) {
          console.log('\n📝 AI Comments:');
          for (const comment of aiResult.comments) {
            await this.showAndPostComment(pr, comment, dryRun);
          }
        }
        
        const confirm = await this.askYesNo('Approve this PR with comments? (y/n): ');
        if (confirm) {
          if (dryRun) {
            console.log('🔍 [DRY RUN] Would approve this PR');
          } else {
            try {
              const comment = aiResult.approvalMessage || 'LGTM! 👍';
              await this.githubCLI.approvePullRequest(
                pr.repository.owner.login,
                pr.repository.name,
                pr.number,
                comment
              );
              console.log('✅ Approved!');
            } catch (error) {
              console.error('❌ Failed to approve PR:', error);
            }
          }
        }
      } else if (aiResult.action === 'comment_only') {
        console.log('⚠️  AI recommends comments only (no approval)');
        
        if (aiResult.comments.length > 0) {
          console.log('\n📝 AI Comments:');
          for (const comment of aiResult.comments) {
            await this.showAndPostComment(pr, comment, dryRun);
          }
        } else {
          console.log('🤔 AI found no specific issues to comment on');
        }
      }
      
    } catch (error) {
      console.error('❌ AI review failed:', error);
      console.log('🔄 Falling back to manual review');
    }
  }

  private async showAndPostComment(pr: PullRequest, comment: AIComment, dryRun: boolean): Promise<void> {
    console.log(`\n📁 File: ${comment.path}`);
    console.log(`📍 Line: ${comment.line}`);
    console.log(`💬 Comment: ${comment.content}`);
    console.log(`📄 Context:\n${comment.context}`);
    
    const shouldPost = await this.askYesNo('Post this comment? (y/n): ');
    if (shouldPost) {
      if (dryRun) {
        console.log('🔍 [DRY RUN] Would post comment');
      } else {
        try {
          // For now, we'll post as a general comment since GitHub CLI doesn't support line-specific comments easily
          const fullComment = `**${comment.path}:${comment.line}**\n\n${comment.content}\n\n\`\`\`\n${comment.context}\n\`\`\``;
          await this.githubCLI.postComment(pr.repository.owner.login, pr.repository.name, pr.number, fullComment);
          console.log('✅ Comment posted!');
        } catch (error) {
          console.error('❌ Failed to post comment:', error);
        }
      }
    }
  }

  private async askYesNo(question: string): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        const response = answer.toLowerCase().trim();
        rl.close();
        resolve(response === 'y' || response === 'yes');
      });
    });
  }

}