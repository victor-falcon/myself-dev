import { PullRequest, ReviewCriteria } from './types';

export class PRReviewer {
  private criteria: ReviewCriteria;

  constructor(criteria?: Partial<ReviewCriteria>) {
    this.criteria = {
      maxAdditions: 50,
      maxDeletions: 50,
      maxChangedFiles: 5,
      maxLinesChanged: 100,
      ...criteria,
    };
  }

  isSimplePR(pr: PullRequest): boolean {
    const totalChanges = pr.additions + pr.deletions;
    
    return (
      pr.additions <= this.criteria.maxAdditions &&
      pr.deletions <= this.criteria.maxDeletions &&
      pr.changed_files <= this.criteria.maxChangedFiles &&
      totalChanges <= this.criteria.maxLinesChanged &&
      !pr.draft
    );
  }

  getPRSummary(pr: PullRequest): string {
    const totalChanges = pr.additions + pr.deletions;
    return `PR #${pr.number}: "${pr.title}" - ${pr.additions} additions, ${pr.deletions} deletions, ${pr.changed_files} files changed (${totalChanges} total lines) - Author: @${pr.user.login}`;
  }

  getApprovalComment(pr: PullRequest): string {
    const totalChanges = pr.additions + pr.deletions;
    return `✅ Approved! Small change: ${pr.additions} additions, ${pr.deletions} deletions across ${pr.changed_files} files.`;
  }
}