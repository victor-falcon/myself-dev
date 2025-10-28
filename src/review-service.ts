import { GitHubCLI } from './github-cli';
import { PRReviewer } from './pr-reviewer';
import { PullRequest, ReviewCriteria } from './types';

export class ReviewService {
  private githubCLI: GitHubCLI;
  private prReviewer: PRReviewer;
  private username: string = '';
  private repository: string;
  private teamNames: string[];
  private userNames: string[];

  constructor(repository: string, teamNames: string[] = [], userNames: string[] = [], criteria?: Partial<ReviewCriteria>) {
    this.githubCLI = new GitHubCLI();
    this.prReviewer = new PRReviewer(criteria);
    this.repository = repository;
    this.teamNames = teamNames;
    this.userNames = userNames;
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
    let manualReviewCount = 0;

    for (const pr of filteredPRs) {
      console.log(`\n📋 ${this.prReviewer.getPRSummary(pr)}`);
      console.log(`🔗 ${pr.html_url}`);

      if (this.prReviewer.isSimplePR(pr)) {
        console.log('✅ This PR looks simple enough for auto-approval');
        
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
            approvedCount++;
          } catch (error) {
            console.error('❌ Failed to approve PR:', error);
          }
        }
      } else {
        console.log('⚠️  This PR needs manual review (too large or complex)');
        console.log(`🔗 Open in browser: ${pr.html_url}`);
        manualReviewCount++;
      }
    }

    console.log('\n📊 Summary:');
    console.log(`✅ Auto-approved: ${approvedCount}`);
    console.log(`⚠️  Manual review needed: ${manualReviewCount}`);
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

    return allPRs;
  }

}