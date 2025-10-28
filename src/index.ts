#!/usr/bin/env node

import { Command } from 'commander';
import { ReviewService } from './review-service';

const program = new Command();

program
  .name('review-pr')
  .description('Automatically review GitHub pull requests')
  .version('1.0.0')
  .requiredOption('-r, --repo <repo>', 'Repository to check (format: owner/repo, e.g., factorialco/factorial)')
  .option('-d, --dry', 'Dry run mode - show what would be done without making changes')
  .option('-t, --teams <teams>', 'Comma-separated list of teams to filter by (e.g., "finance,expenses")', 'finance,expenses')
  .option('-u, --users <users>', 'Comma-separated list of users to filter by (e.g., "user1,user2")')
  .option('--max-additions <number>', 'Maximum additions for auto-approval', '50')
  .option('--max-deletions <number>', 'Maximum deletions for auto-approval', '50')
  .option('--max-files <number>', 'Maximum changed files for auto-approval', '5')
  .option('--max-lines <number>', 'Maximum total lines changed for auto-approval', '100')
  .parse();

const options = program.opts();

async function main() {
  const criteria = {
    maxAdditions: parseInt(options.maxAdditions),
    maxDeletions: parseInt(options.maxDeletions),
    maxChangedFiles: parseInt(options.maxFiles),
    maxLinesChanged: parseInt(options.maxLines),
  };

  const teams = options.teams ? options.teams.split(',').map((t: string) => t.trim()) : [];
  const users = options.users ? options.users.split(',').map((u: string) => u.trim()) : [];
  const [repoOwner, repoName] = options.repo.split('/');

  if (!repoOwner || !repoName) {
    console.error('❌ Error: Repository must be in format owner/repo (e.g., factorialco/factorial)');
    process.exit(1);
  }

  console.log('🚀 Starting PR review process...');
  if (options.dry) {
    console.log('🔍 Running in DRY RUN mode - no changes will be made');
  }
  console.log(`📦 Repository: ${options.repo}`);
  console.log(`📏 Review criteria: ${criteria.maxAdditions} additions, ${criteria.maxDeletions} deletions, ${criteria.maxChangedFiles} files, ${criteria.maxLinesChanged} total lines`);
  console.log(`👥 Teams to filter by: ${teams.length > 0 ? teams.join(', ') : 'none'}`);
  console.log(`👤 Users to filter by: ${users.length > 0 ? users.join(', ') : 'none'}\n`);

  try {
    const reviewService = new ReviewService(options.repo, teams, users, criteria);
    await reviewService.initialize();
    await reviewService.reviewPendingPRs(options.dry);
  } catch (error) {
    console.error('❌ Error during review process:', error);
    process.exit(1);
  }
}

main().catch(console.error);