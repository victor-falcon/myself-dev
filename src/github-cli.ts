import { execSync } from 'child_process';
import { PullRequest, User, Team } from './types';

export class GitHubCLI {
  private username: string | null = null;

  constructor() {
    this.checkGitHubCLI();
  }

  private checkGitHubCLI(): void {
    try {
      execSync('gh --version', { stdio: 'ignore' });
    } catch (error) {
      throw new Error('GitHub CLI (gh) is not installed. Please install it from https://cli.github.com/');
    }
  }

  private async executeCommand(command: string): Promise<any> {
    try {
      const result = execSync(command, { 
        encoding: 'utf8',
        stdio: 'pipe'
      });
      return JSON.parse(result);
    } catch (error) {
      console.warn(`Command failed: ${command}`, error);
      return null;
    }
  }

  async getCurrentUser(): Promise<User> {
    if (!this.username) {
      const user = await this.executeCommand('gh api user');
      if (!user) {
        throw new Error('Failed to get current user. Make sure you are authenticated with GitHub CLI.');
      }
      this.username = user.login;
    }
    return {
      login: this.username!,
      id: this.username!, // GitHub CLI doesn't provide numeric ID easily
    };
  }

  async getPullRequestsForRepository(owner: string, repo: string): Promise<PullRequest[]> {
    console.log(`🔍 Fetching all open PRs from ${owner}/${repo}...`);
    
    const prs = await this.executeCommand(`gh pr list --repo ${owner}/${repo} --state open --json number,title,body,url,author,createdAt,updatedAt,additions,deletions,changedFiles,isDraft,state,headRefName,baseRefName,headRepository,headRepositoryOwner`);
    
    if (!prs || !Array.isArray(prs)) {
      console.log(`📊 Found 0 open PRs in ${owner}/${repo}`);
      return [];
    }

    console.log(`📊 Found ${prs.length} open PRs in ${owner}/${repo}`);

    const pullRequests: PullRequest[] = prs.map(pr => ({
      id: pr.number, // Use PR number as ID since GitHub CLI doesn't provide numeric ID
      number: pr.number,
      title: pr.title,
      body: pr.body || '',
      html_url: pr.url,
      user: {
        login: pr.author?.login || 'unknown',
      },
      created_at: pr.createdAt,
      updated_at: pr.updatedAt,
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
      changed_files: pr.changedFiles || 0,
      draft: pr.isDraft || false,
      state: pr.state.toLowerCase() as 'open' | 'closed',
      head: {
        ref: pr.headRefName,
      },
      base: {
        ref: pr.baseRefName,
      },
      repository: {
        name: pr.headRepository?.name || repo,
        full_name: pr.headRepository?.nameWithOwner || `${owner}/${repo}`,
        owner: {
          login: pr.headRepositoryOwner?.login || owner,
        },
      },
    }));

    return pullRequests;
  }

  async getPullRequestsForReview(username: string, owner: string, repo: string): Promise<PullRequest[]> {
    // Use gh pr list with search filter for review requests
    const searchQuery = `is:open is:pr review-requested:${username}`;
    
    const searchResults = await this.executeCommand(`gh pr list --repo ${owner}/${repo} --search "${searchQuery}" --json number,title,body,url,author,createdAt,updatedAt,additions,deletions,changedFiles,isDraft,state,headRefName,baseRefName,headRepository,headRepositoryOwner`);
    
    if (!searchResults || !Array.isArray(searchResults)) {
      return [];
    }

    const pullRequests: PullRequest[] = searchResults.map(pr => ({
      id: pr.number,
      number: pr.number,
      title: pr.title,
      body: pr.body || '',
      html_url: pr.url,
      user: {
        login: pr.author?.login || 'unknown',
      },
      created_at: pr.createdAt,
      updated_at: pr.updatedAt,
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
      changed_files: pr.changedFiles || 0,
      draft: pr.isDraft || false,
      state: pr.state.toLowerCase() as 'open' | 'closed',
      head: {
        ref: pr.headRefName,
      },
      base: {
        ref: pr.baseRefName,
      },
      repository: {
        name: pr.headRepository?.name || 'unknown',
        full_name: pr.headRepository?.nameWithOwner || 'unknown/unknown',
        owner: {
          login: pr.headRepositoryOwner?.login || 'unknown',
        },
      },
    }));

    return pullRequests;
  }

  async getPullRequestsForTeamReview(org: string, teamName: string, repo: string): Promise<PullRequest[]> {
    // Use gh pr list with search filter for team review requests
    const searchQuery = `is:open is:pr team-review-requested:${org}/${teamName}`;
    
    const searchResults = await this.executeCommand(`gh pr list --repo ${org}/${repo} --search "${searchQuery}" --json number,title,body,url,author,createdAt,updatedAt,additions,deletions,changedFiles,isDraft,state,headRefName,baseRefName,headRepository,headRepositoryOwner`);
    
    if (!searchResults || !Array.isArray(searchResults)) {
      return [];
    }

    const pullRequests: PullRequest[] = searchResults.map(pr => ({
      id: pr.number,
      number: pr.number,
      title: pr.title,
      body: pr.body || '',
      html_url: pr.url,
      user: {
        login: pr.author?.login || 'unknown',
      },
      created_at: pr.createdAt,
      updated_at: pr.updatedAt,
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
      changed_files: pr.changedFiles || 0,
      draft: pr.isDraft || false,
      state: pr.state.toLowerCase() as 'open' | 'closed',
      head: {
        ref: pr.headRefName,
      },
      base: {
        ref: pr.baseRefName,
      },
      repository: {
        name: pr.headRepository?.name || 'unknown',
        full_name: pr.headRepository?.nameWithOwner || 'unknown/unknown',
        owner: {
          login: pr.headRepositoryOwner?.login || 'unknown',
        },
      },
    }));

    return pullRequests;
  }

  async approvePullRequest(owner: string, repo: string, prNumber: number, comment?: string): Promise<void> {
    const command = comment 
      ? `gh pr review ${prNumber} --repo ${owner}/${repo} --approve --body "${comment}"`
      : `gh pr review ${prNumber} --repo ${owner}/${repo} --approve --body "LGTM! 👍"`;
    
    try {
      execSync(command, { stdio: 'pipe' });
    } catch (error) {
      throw new Error(`Failed to approve PR #${prNumber}: ${error}`);
    }
  }

  async getTeamMembers(org: string, teamSlug: string): Promise<string[]> {
    const members = await this.executeCommand(`gh api orgs/${org}/teams/${teamSlug}/members --jq '.[].login'`);
    
    if (!members || !Array.isArray(members)) {
      return [];
    }
    
    return members;
  }

  async getPullRequestReviewRequests(owner: string, repo: string, prNumber: number): Promise<{
    users: string[];
    teams: string[];
  }> {
    const reviewRequests = await this.executeCommand(`gh api repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`);
    
    if (!reviewRequests) {
      return { users: [], teams: [] };
    }

    const users = reviewRequests.users?.map((user: any) => user.login) || [];
    const teams = reviewRequests.teams?.map((team: any) => team.slug) || [];

    return { users, teams };
  }

  async isUserInTeam(org: string, teamSlug: string, username: string): Promise<boolean> {
    try {
      const members = await this.getTeamMembers(org, teamSlug);
      return members.includes(username);
    } catch (error) {
      console.warn(`Could not check if ${username} is in team ${org}/${teamSlug}:`, error);
      return false;
    }
  }

  async getPullRequestDiff(owner: string, repo: string, prNumber: number): Promise<string> {
    try {
      // Use execSync directly for diff since it's not JSON
      const { execSync } = require('child_process');
      const diff = execSync(`gh pr diff --repo ${owner}/${repo} ${prNumber}`, { 
        encoding: 'utf8',
        stdio: 'pipe'
      });
      return diff;
    } catch (error) {
      console.error(`❌ Failed to get diff for PR #${prNumber}:`, error);
      throw error;
    }
  }

  async getPullRequestLatestCommit(owner: string, repo: string, prNumber: number): Promise<string> {
    try {
      const pr = await this.executeCommand(`gh pr view ${prNumber} --repo ${owner}/${repo} --json headRefOid`);
      if (!pr || !pr.headRefOid) {
        throw new Error('Could not get commit SHA from PR');
      }
      return pr.headRefOid;
    } catch (error) {
      console.error(`❌ Failed to get latest commit for PR #${prNumber}:`, error);
      throw error;
    }
  }

  async postComment(owner: string, repo: string, prNumber: number, comment: string): Promise<void> {
    try {
      // Escape the comment for shell execution
      const escapedComment = comment.replace(/"/g, '\\"');
      execSync(`gh pr comment ${prNumber} --repo ${owner}/${repo} --body "${escapedComment}"`, { 
        encoding: 'utf8',
        stdio: 'pipe'
      });
    } catch (error) {
      console.error(`❌ Failed to post comment on PR #${prNumber}:`, error);
      throw error;
    }
  }

  async postLineComment(owner: string, repo: string, prNumber: number, filePath: string, line: number, comment: string, commitSha: string): Promise<void> {
    try {
      // Escape the comment for JSON
      const escapedComment = comment.replace(/\"/g, '\\"');
      
      const command = `gh api --method POST -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" /repos/${owner}/${repo}/pulls/${prNumber}/comments -f body="${escapedComment}" -f commit_id="${commitSha}" -f path="${filePath}" -f line=${line} -f side="RIGHT"`;
      
      execSync(command, { 
        encoding: 'utf8',
        stdio: 'pipe'
      });
    } catch (error) {
      console.error(`❌ Failed to post line comment on PR #${prNumber}:`, error);
      throw error;
    }
  }
}