import { GitHubCLI } from './github-cli';
import { PRReviewer } from './pr-reviewer';
import { PullRequest, ReviewCriteria } from './types';
import { AIReviewService, AIReviewResult, AIComment } from './ai-review-service';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

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

  async reviewSpecificPR(prNumber: number, dryRun: boolean = false): Promise<void> {
    console.log(`🔍 Fetching PR #${prNumber} from repository...\n`);

    const [owner, repo] = this.repository.split('/');
    
    const pr = await this.githubCLI.getPullRequestByNumber(owner, repo, prNumber);
    
    if (!pr) {
      console.error(`❌ PR #${prNumber} not found in ${this.repository}`);
      return;
    }

    if (pr.state !== 'open') {
      console.log(`⚠️  PR #${prNumber} is ${pr.state}, not open`);
      return;
    }

    console.log(`📋 ${this.prReviewer.getPRSummary(pr)}`);
    console.log(`🔗 ${pr.html_url}`);

    const isSimple = this.prReviewer.isSimplePR(pr);
    if (isSimple) {
      console.log('✅ This PR looks simple');
    } else {
      console.log('⚠️  This PR is large or complex');
    }

    if (this.aiReviewService) {
      console.log('🤖 Auto-triggering AI review...\n');
      await this.handleAIReview(pr, dryRun);
    } else {
      console.log('⚠️  AI review not available - GEMINI_API_KEY not found');
      console.log('📝 Falling back to manual review options\n');
      
      let actionComplete = false;
      
      while (!actionComplete) {
        const action = await this.askUserAction(pr, dryRun);
        
        switch (action) {
          case 'a':
            const approvalComment = this.prReviewer.getApprovalComment(pr);
            console.log(`💬 Approval comment: ${approvalComment}`);
            
            const approvalAction = await this.askApprovalAction();
            
            if (approvalAction === 'edit') {
              const editedApproval = await this.editApprovalCommentInNvim(approvalComment);
              if (editedApproval) {
                console.log(`💬 Edited approval comment: ${editedApproval}`);
                const confirmApproval = await this.askYesNo('Approve with this edited comment? (y/n): ');
                if (!confirmApproval) {
                  break;
                }
                
                if (dryRun) {
                  console.log('🔍 [DRY RUN] Would approve this PR');
                } else {
                  try {
                    await this.githubCLI.approvePullRequest(
                      pr.repository.owner.login,
                      pr.repository.name,
                      pr.number,
                      editedApproval
                    );
                    console.log('✅ Approved!');
                  } catch (error) {
                    console.error('❌ Failed to approve PR:', error);
                  }
                }
              } else {
                console.log('❌ Approval comment editing cancelled');
                break;
              }
            } else if (approvalAction === 'approve') {
              if (dryRun) {
                console.log('🔍 [DRY RUN] Would approve this PR');
              } else {
                try {
                  await this.githubCLI.approvePullRequest(
                    pr.repository.owner.login,
                    pr.repository.name,
                    pr.number,
                    approvalComment
                  );
                  console.log('✅ Approved!');
                } catch (error) {
                  console.error('❌ Failed to approve PR:', error);
                }
              }
            } else {
              console.log('⏭️  Skipped approval');
              break;
            }
            actionComplete = true;
            break;
          case 'o':
            console.log(`🔗 Opening ${pr.html_url} in browser...`);
            if (!dryRun) {
              const { exec } = require('child_process');
              exec(`open "${pr.html_url}"`);
            } else {
              console.log('🔍 [DRY RUN] Would open browser');
            }
            break;
          case 's':
            console.log('⏭️  Skipped');
            actionComplete = true;
            break;
          case 'i':
            console.log('🚫 Ignored (will not be shown again)');
            this.addIgnoredPR(pr.number);
            actionComplete = true;
            break;
        }
      }
    }
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

      let actionComplete = false;
      
      while (!actionComplete) {
        const action = await this.askUserAction(pr, dryRun);
        
        // Handle AI review if requested
        if (action === 'ai' && this.aiReviewService) {
          await this.handleAIReview(pr, dryRun);
          actionComplete = true;
          continue;
        }
        
        switch (action) {
          case 'a':
            const approvalComment = this.prReviewer.getApprovalComment(pr);
            console.log(`💬 Approval comment: ${approvalComment}`);
            
            const approvalAction = await this.askApprovalAction();
            
            if (approvalAction === 'edit') {
              const editedApproval = await this.editApprovalCommentInNvim(approvalComment);
              if (editedApproval) {
                console.log(`💬 Edited approval comment: ${editedApproval}`);
                const confirmApproval = await this.askYesNo('Approve with this edited comment? (y/n): ');
                if (!confirmApproval) {
                  break;
                }
                
                if (dryRun) {
                  console.log('🔍 [DRY RUN] Would approve this PR');
                } else {
                  try {
                    await this.githubCLI.approvePullRequest(
                      pr.repository.owner.login,
                      pr.repository.name,
                      pr.number,
                      editedApproval
                    );
                    console.log('✅ Approved!');
                  } catch (error) {
                    console.error('❌ Failed to approve PR:', error);
                  }
                }
              } else {
                console.log('❌ Approval comment editing cancelled');
                break;
              }
            } else if (approvalAction === 'approve') {
              if (dryRun) {
                console.log('🔍 [DRY RUN] Would approve this PR');
              } else {
                try {
                  await this.githubCLI.approvePullRequest(
                    pr.repository.owner.login,
                    pr.repository.name,
                    pr.number,
                    approvalComment
                  );
                  console.log('✅ Approved!');
                } catch (error) {
                  console.error('❌ Failed to approve PR:', error);
                }
              }
            } else {
              console.log('⏭️  Skipped approval');
              break;
            }
            approvedCount++;
            actionComplete = true;
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
            actionComplete = true;
            break;
          case 'i':
            console.log('🚫 Ignored (will not be shown again)');
            this.addIgnoredPR(pr.number);
            ignoredCount++;
            actionComplete = true;
            break;
        }
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
        // Clean the input by removing terminal escape sequences and non-printable characters
        const cleanAnswer = answer
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // Remove ANSI escape sequences
          .replace(/[^\x20-\x7E]/g, '') // Remove non-printable characters
          .trim();
        
        // Debug: log the original and cleaned input
        if (answer !== cleanAnswer) {
          console.log(`🔧 Input cleaned: "${answer}" -> "${cleanAnswer}"`);
        }
        
        const validActions = ['a', 'o', 's', 'i'];
        if (this.aiReviewService) {
          validActions.push('A');
        }
        
        if (validActions.includes(cleanAnswer)) {
          rl.close();
          // Convert 'A' to 'ai' for AI review, others to lowercase
          if (cleanAnswer === 'A') {
            resolve('ai');
          } else {
            resolve(cleanAnswer.toLowerCase());
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
        const approvalMessage = aiResult.approvalMessage || 'LGTM! 👍';
        console.log(`💬 Approval message: ${approvalMessage}`);
        
        const approvalAction = await this.askApprovalAction();
        
        if (approvalAction === 'edit') {
          const editedApproval = await this.editApprovalCommentInNvim(approvalMessage);
          if (editedApproval) {
            console.log(`💬 Edited approval message: ${editedApproval}`);
            const confirmApproval = await this.askYesNo('Approve with this edited message? (y/n): ');
            if (confirmApproval) {
              if (dryRun) {
                console.log('🔍 [DRY RUN] Would approve this PR');
              } else {
                try {
                  await this.githubCLI.approvePullRequest(
                    pr.repository.owner.login,
                    pr.repository.name,
                    pr.number,
                    editedApproval
                  );
                  console.log('✅ Approved!');
                } catch (error) {
                  console.error('❌ Failed to approve PR:', error);
                }
              }
            }
          } else {
            console.log('❌ Approval message editing cancelled');
          }
        } else if (approvalAction === 'approve') {
          if (dryRun) {
            console.log('🔍 [DRY RUN] Would approve this PR');
          } else {
            try {
              await this.githubCLI.approvePullRequest(
                pr.repository.owner.login,
                pr.repository.name,
                pr.number,
                approvalMessage
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
        
        // Determine if comments are file-specific or just a single PR-level comment
        const hasFileComments = (aiResult.comments || []).some(c => c.path && c.path !== 'unknown' && c.line && c.line > 0);
        const isSinglePRLevelComment = (aiResult.comments || []).length === 1 && (!aiResult.comments[0].path || aiResult.comments[0].path === 'unknown' || !aiResult.comments[0].line || aiResult.comments[0].line === 0);

        if (hasFileComments && !isSinglePRLevelComment) {
          // Print all comments grouped by file with context, then offer (o)pen, (a)pprove, (s)kip
          this.printCommentsGroupedByFile(aiResult.comments);

          const action = await this.askOpenApproveSkip();
          if (action === 'open') {
            console.log(`🔗 Opening ${pr.html_url} in browser...`);
            if (!dryRun) {
              const { exec } = require('child_process');
              exec(`open "${pr.html_url}"`);
            } else {
              console.log('🔍 [DRY RUN] Would open browser');
            }
          } else if (action === 'approve') {
            const approvalMessage = aiResult.approvalMessage || 'LGTM! 👍';
            const approvalAction = await this.askApprovalAction();
            if (approvalAction === 'edit') {
              const editedApproval = await this.editApprovalCommentInNvim(approvalMessage);
              if (editedApproval) {
                const confirmApproval = await this.askYesNo('Approve with this edited message? (y/n): ');
                if (confirmApproval) {
                  if (dryRun) {
                    console.log('🔍 [DRY RUN] Would approve this PR');
                  } else {
                    try {
                      await this.githubCLI.approvePullRequest(
                        pr.repository.owner.login,
                        pr.repository.name,
                        pr.number,
                        editedApproval
                      );
                      console.log('✅ Approved!');
                    } catch (error) {
                      console.error('❌ Failed to approve PR:', error);
                    }
                  }
                }
              } else {
                console.log('❌ Approval message editing cancelled');
              }
            } else if (approvalAction === 'approve') {
              if (dryRun) {
                console.log('🔍 [DRY RUN] Would approve this PR');
              } else {
                try {
                  await this.githubCLI.approvePullRequest(
                    pr.repository.owner.login,
                    pr.repository.name,
                    pr.number,
                    approvalMessage
                  );
                  console.log('✅ Approved!');
                } catch (error) {
                  console.error('❌ Failed to approve PR:', error);
                }
              }
            }
          } else {
            console.log('⏭️  Skipped');
          }
        } else {
          // Keep existing behavior (single PR-level comment or no file comments)
          // Show comments first
          if (aiResult.comments.length > 0) {
            console.log('\n📝 AI Comments:');
            for (const comment of aiResult.comments) {
              await this.showAndPostComment(pr, comment, dryRun);
            }
          }
          const approvalMessage = aiResult.approvalMessage || 'LGTM! 👍';
          console.log(`💬 Approval message: ${approvalMessage}`);
          const approvalAction = await this.askApprovalAction();
          if (approvalAction === 'edit') {
            const editedApproval = await this.editApprovalCommentInNvim(approvalMessage);
            if (editedApproval) {
              console.log(`💬 Edited approval message: ${editedApproval}`);
              const confirmApproval = await this.askYesNo('Approve with this edited message? (y/n): ');
              if (confirmApproval) {
                if (dryRun) {
                  console.log('🔍 [DRY RUN] Would approve this PR');
                } else {
                  try {
                    await this.githubCLI.approvePullRequest(
                      pr.repository.owner.login,
                      pr.repository.name,
                      pr.number,
                      editedApproval
                    );
                    console.log('✅ Approved!');
                  } catch (error) {
                    console.error('❌ Failed to approve PR:', error);
                  }
                }
              }
            } else {
              console.log('❌ Approval message editing cancelled');
            }
          } else if (approvalAction === 'approve') {
            if (dryRun) {
              console.log('🔍 [DRY RUN] Would approve this PR');
            } else {
              try {
                await this.githubCLI.approvePullRequest(
                  pr.repository.owner.login,
                  pr.repository.name,
                  pr.number,
                  approvalMessage
                );
                console.log('✅ Approved!');
              } catch (error) {
                console.error('❌ Failed to approve PR:', error);
              }
            }
          }
        }
      } else if (aiResult.action === 'comment_only') {
        console.log('⚠️  AI recommends comments only (no approval)');
        
        const hasFileComments = (aiResult.comments || []).some(c => c.path && c.path !== 'unknown' && c.line && c.line > 0);
        if (hasFileComments) {
          this.printCommentsGroupedByFile(aiResult.comments);
          const action = await this.askOpenApproveSkip();
          if (action === 'open') {
            console.log(`🔗 Opening ${pr.html_url} in browser...`);
            if (!dryRun) {
              const { exec } = require('child_process');
              exec(`open "${pr.html_url}"`);
            } else {
              console.log('🔍 [DRY RUN] Would open browser');
            }
          } else if (action === 'approve') {
            const approvalMessage = 'LGTM! 👍';
            if (dryRun) {
              console.log('🔍 [DRY RUN] Would approve this PR');
            } else {
              try {
                await this.githubCLI.approvePullRequest(
                  pr.repository.owner.login,
                  pr.repository.name,
                  pr.number,
                  approvalMessage
                );
                console.log('✅ Approved!');
              } catch (error) {
                console.error('❌ Failed to approve PR:', error);
              }
            }
          } else {
            console.log('⏭️  Skipped');
          }
        } else if (aiResult.comments.length > 0) {
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

  private printCommentsGroupedByFile(comments: AIComment[]): void {
    const grouped: Record<string, AIComment[]> = {};
    for (const c of comments) {
      const key = c.path || 'unknown';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(c);
    }

    console.log('\n📝 AI Comments by file:');
    for (const [filePath, fileComments] of Object.entries(grouped)) {
      console.log(`\n📄 ${filePath}`);
      for (const c of fileComments) {
        console.log(`  ▶️  Line ${c.line}: ${c.content}`);
        if (c.context) {
          console.log('  Context:\n' + c.context.split('\n').map(l => '    ' + l).join('\n'));
        }
      }
    }
  }

  private async askOpenApproveSkip(): Promise<'open' | 'approve' | 'skip'> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question('What do you want to do? (o)pen, (a)pprove, (s)kip: ', (answer) => {
        const cleanAnswer = answer
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
          .replace(/[^\x20-\x7E]/g, '')
          .toLowerCase()
          .trim();

        rl.close();

        if (cleanAnswer === 'o' || cleanAnswer === 'open') {
          resolve('open');
        } else if (cleanAnswer === 'a' || cleanAnswer === 'approve') {
          resolve('approve');
        } else {
          resolve('skip');
        }
      });
    });
  }

  private async showAndPostComment(pr: PullRequest, comment: AIComment, dryRun: boolean): Promise<void> {
    console.log(`\\n?? File: ${comment.path}`);
    console.log(`?? Line: ${comment.line}`);
    console.log(`?? Comment: ${comment.content}`);
    console.log(`?? Context:\\n${comment.context}`);
    
    const action = await this.askCommentAction();
    
    if (action === 'edit') {
      const editedComment = await this.editCommentInNvim(comment);
      if (editedComment) {
        comment = editedComment;
        console.log(`\\n?? File: ${comment.path}`);
        console.log(`?? Line: ${comment.line}`);
        console.log(`?? Comment: ${comment.content}`);
        console.log(`?? Context:\\n${comment.context}`);
        
        const shouldPost = await this.askYesNo('Post this edited comment? (y/n): ');
        if (!shouldPost) {
          return;
        }
      } else {
        console.log('? Comment editing cancelled');
        return;
      }
    } else if (action === 'post') {
      // Continue with posting
    } else {
      // Skip posting
      return;
    }
    
    if (dryRun) {
      console.log('?? [DRY RUN] Would post line-specific comment');
    } else {
      try {
        // Get the latest commit SHA for the PR
        const [owner, repo] = this.repository.split('/');
        const commitSha = await this.githubCLI.getPullRequestLatestCommit(owner, repo, pr.number);
        
        // Post as a line-specific comment
        await this.githubCLI.postLineComment(
          pr.repository.owner.login, 
          pr.repository.name, 
          pr.number, 
          comment.path, 
          comment.line, 
          comment.content, 
          commitSha
        );
        console.log('? Line comment posted!');
      } catch (error) {
        console.error('? Failed to post line comment:', error);
        // Fallback to general comment if line comment fails
        try {
          const fullComment = `**${comment.path}:${comment.line}**\n\n${comment.content}\n\n\`\`\`\n${comment.context}\n\`\`\``;
          await this.githubCLI.postComment(pr.repository.owner.login, pr.repository.name, pr.number, fullComment);
          console.log('? Fallback comment posted!');
        } catch (fallbackError) {
          console.error('? Failed to post fallback comment:', fallbackError);
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
        // Clean the input by removing terminal escape sequences and non-printable characters
        const cleanAnswer = answer
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // Remove ANSI escape sequences
          .replace(/[^\x20-\x7E]/g, '') // Remove non-printable characters
          .toLowerCase()
          .trim();
        
        // Debug: log the original and cleaned input
        if (answer !== cleanAnswer) {
          console.log(`🔧 Input cleaned: "${answer}" -> "${cleanAnswer}"`);
        }
        
        rl.close();
        resolve(cleanAnswer === 'y' || cleanAnswer === 'yes');
      });
    });
  }

  private async askCommentAction(): Promise<'post' | 'edit' | 'skip'> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question('What would you like to do? (p)ost, (e)dit, (s)kip: ', (answer) => {
        // Clean the input by removing terminal escape sequences and non-printable characters
        const cleanAnswer = answer
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // Remove ANSI escape sequences
          .replace(/[^\x20-\x7E]/g, '') // Remove non-printable characters
          .toLowerCase()
          .trim();
        
        // Debug: log the original and cleaned input
        if (answer !== cleanAnswer) {
          console.log(`🔧 Input cleaned: "${answer}" -> "${cleanAnswer}"`);
        }
        
        rl.close();
        
        if (cleanAnswer === 'e' || cleanAnswer === 'edit') {
          resolve('edit');
        } else if (cleanAnswer === 'p' || cleanAnswer === 'post') {
          resolve('post');
        } else {
          resolve('skip');
        }
      });
    });
  }

  private async askApprovalAction(): Promise<'approve' | 'edit' | 'skip'> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question('What would you like to do? (a)pprove, (e)dit, (s)kip: ', (answer) => {
        // Clean the input by removing terminal escape sequences and non-printable characters
        const cleanAnswer = answer
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // Remove ANSI escape sequences
          .replace(/[^\x20-\x7E]/g, '') // Remove non-printable characters
          .toLowerCase()
          .trim();
        
        // Debug: log the original and cleaned input
        if (answer !== cleanAnswer) {
          console.log(`🔧 Input cleaned: "${answer}" -> "${cleanAnswer}"`);
        }
        
        rl.close();
        
        if (cleanAnswer === 'e' || cleanAnswer === 'edit') {
          resolve('edit');
        } else if (cleanAnswer === 'a' || cleanAnswer === 'approve') {
          resolve('approve');
        } else {
          resolve('skip');
        }
      });
    });
  }

  private async editCommentInNvim(comment: AIComment): Promise<AIComment | null> {
    const tempDir = path.join(process.cwd(), '.temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFile = path.join(tempDir, `comment_${Date.now()}.txt`);
    
    // Create the comment file with a specific format for editing
    const commentContent = `# Edit this comment
# Lines starting with # are comments and will be ignored
# The format is:
# FILE_PATH:LINE_NUMBER
# COMMENT_CONTENT
# CONTEXT

FILE_PATH:${comment.path}
LINE_NUMBER:${comment.line}

COMMENT_CONTENT:
${comment.content}

CONTEXT:
${comment.context}
`;

    try {
      fs.writeFileSync(tempFile, commentContent, 'utf8');
      
      // Launch nvim with proper terminal handling
      const nvimProcess = spawn('nvim', [tempFile], {
        stdio: ['inherit', 'inherit', 'inherit'],
        detached: false,
        shell: false
      });

      return new Promise((resolve) => {
        nvimProcess.on('close', (code) => {
          // Small delay to ensure terminal is properly restored
          setTimeout(() => {
            // Force terminal cleanup and restoration
            process.stdout.write('\x1b[?25h'); // Show cursor
            process.stdout.write('\x1b[0m'); // Reset terminal attributes
            
            if (code === 0) {
              // Read the edited file
              const editedContent = fs.readFileSync(tempFile, 'utf8');
              const parsedComment = this.parseEditedComment(editedContent);
              
              // Clean up temp file
              fs.unlinkSync(tempFile);
              
              if (parsedComment) {
                resolve(parsedComment);
              } else {
                console.log('❌ Failed to parse edited comment');
                resolve(null);
              }
            } else {
              console.log('❌ nvim exited with error');
              fs.unlinkSync(tempFile);
              resolve(null);
            }
          }, 100);
        });

        // Handle process errors
        nvimProcess.on('error', (error) => {
          console.error('❌ Failed to launch nvim:', error);
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
          resolve(null);
        });
      });
    } catch (error) {
      console.error('❌ Failed to edit comment:', error);
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      return null;
    }
  }

  private parseEditedComment(content: string): AIComment | null {
    const lines = content.split('\n');
    let filePath = '';
    let lineNumber = 0;
    let commentContent = '';
    let context = '';
    let inCommentSection = false;
    let inContextSection = false;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip comment lines
      if (trimmedLine.startsWith('#')) {
        continue;
      }
      
      if (trimmedLine.startsWith('FILE_PATH:')) {
        filePath = trimmedLine.substring('FILE_PATH:'.length).trim();
      } else if (trimmedLine.startsWith('LINE_NUMBER:')) {
        lineNumber = parseInt(trimmedLine.substring('LINE_NUMBER:'.length).trim(), 10);
      } else if (trimmedLine === 'COMMENT_CONTENT:') {
        inCommentSection = true;
        inContextSection = false;
      } else if (trimmedLine === 'CONTEXT:') {
        inCommentSection = false;
        inContextSection = true;
      } else if (inCommentSection && trimmedLine !== '') {
        commentContent += (commentContent ? '\n' : '') + line;
      } else if (inContextSection && trimmedLine !== '') {
        context += (context ? '\n' : '') + line;
      }
    }

    if (filePath && lineNumber && commentContent.trim()) {
      return {
        path: filePath,
        line: lineNumber,
        content: commentContent.trim(),
        context: context.trim()
      };
    }

    return null;
  }

  private async editApprovalCommentInNvim(approvalMessage: string): Promise<string | null> {
    const tempDir = path.join(process.cwd(), '.temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFile = path.join(tempDir, `approval_${Date.now()}.txt`);
    
    // Create the approval comment file with a specific format for editing
    const approvalContent = `# Edit this approval comment
# Lines starting with # are comments and will be ignored
# The format is:
# APPROVAL_MESSAGE: Your approval message here

APPROVAL_MESSAGE:
${approvalMessage}
`;

    try {
      fs.writeFileSync(tempFile, approvalContent, 'utf8');
      
      // Launch nvim with proper terminal handling
      const nvimProcess = spawn('nvim', [tempFile], {
        stdio: ['inherit', 'inherit', 'inherit'],
        detached: false,
        shell: false
      });

      return new Promise((resolve) => {
        nvimProcess.on('close', (code) => {
          // Small delay to ensure terminal is properly restored
          setTimeout(() => {
            // Force terminal cleanup and restoration
            process.stdout.write('\x1b[?25h'); // Show cursor
            process.stdout.write('\x1b[0m'); // Reset terminal attributes
            
            if (code === 0) {
              // Read the edited file
              const editedContent = fs.readFileSync(tempFile, 'utf8');
              const parsedApproval = this.parseEditedApprovalComment(editedContent);
              
              // Clean up temp file
              fs.unlinkSync(tempFile);
              
              if (parsedApproval) {
                resolve(parsedApproval);
              } else {
                console.log('❌ Failed to parse edited approval comment');
                resolve(null);
              }
            } else {
              console.log('❌ nvim exited with error');
              fs.unlinkSync(tempFile);
              resolve(null);
            }
          }, 100);
        });

        // Handle process errors
        nvimProcess.on('error', (error) => {
          console.error('❌ Failed to launch nvim:', error);
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
          resolve(null);
        });
      });
    } catch (error) {
      console.error('❌ Failed to edit approval comment:', error);
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      return null;
    }
  }

  private parseEditedApprovalComment(content: string): string | null {
    const lines = content.split('\n');
    let approvalMessage = '';
    let inApprovalSection = false;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip comment lines
      if (trimmedLine.startsWith('#')) {
        continue;
      }
      
      if (trimmedLine === 'APPROVAL_MESSAGE:') {
        inApprovalSection = true;
      } else if (inApprovalSection && trimmedLine !== '') {
        approvalMessage += (approvalMessage ? '\n' : '') + line;
      }
    }

    return approvalMessage.trim() || null;
  }

}