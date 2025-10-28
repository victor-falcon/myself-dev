# Review PR Script

A TypeScript script that automatically reviews GitHub pull requests in a specific repository. It can filter PRs by team or user assignments and auto-approve simple/small PRs while providing URLs for complex ones that need manual review.

## Features

- 📦 Works with a specific repository (no more searching across all repos)
- 🔍 Filters PRs by team assignments or specific users
- ✅ Auto-approves simple/small PRs with a comment
- 🔗 Provides URLs for complex PRs that need manual review
- 🔍 Dry-run mode to preview actions without making changes
- ⚙️ Configurable criteria for what constitutes a "simple" PR
- 👥 Support for team-based PR filtering (finance, expenses, etc.)
- 👤 Support for user-based PR filtering

## Setup

1. **Install GitHub CLI:**
   - Follow the installation guide at https://cli.github.com/
   - For macOS: `brew install gh`
   - For other platforms, see the official installation guide

2. **Authenticate with GitHub CLI:**
   ```bash
   gh auth login
   ```
   - Choose GitHub.com
   - Choose HTTPS
   - Choose "Login with a web browser"
   - Follow the prompts to complete authentication

3. **Install dependencies:**
   ```bash
   bun install
   ```

## Usage

### Basic Usage

```bash
# Dry run (preview what would be done)
bun run dev -- --repo factorialco/factorial --dry

# Review PRs where you're assigned (directly or via teams)
bun run dev -- --repo factorialco/factorial

# Filter by specific teams
bun run dev -- --repo factorialco/factorial --teams "finance,expenses"

# Filter by specific users
bun run dev -- --repo factorialco/factorial --users "john,mary"

# Filter by both teams and users
bun run dev -- --repo factorialco/factorial --teams "finance" --users "john"

# Build and run
bun run review -- --repo factorialco/factorial
```

### Advanced Usage

```bash
# Custom criteria for what's considered "simple"
bun run dev -- --repo factorialco/factorial --max-additions 30 --max-deletions 30 --max-files 3 --max-lines 60

# Dry run with custom criteria and specific teams
bun run dev -- --repo factorialco/factorial --dry --teams "finance,expenses" --max-additions 100 --max-deletions 100

# Check only direct assignments (no teams or users)
bun run dev -- --repo factorialco/factorial --teams "" --users ""
```

### Command Line Options

- `--repo <repo>` - **Required**: Repository to check (format: owner/repo, e.g., factorialco/factorial)
- `--dry` - Dry run mode (shows what would be done without making changes)
- `--teams <teams>` - Comma-separated list of teams to filter by (default: "finance,expenses")
- `--users <users>` - Comma-separated list of users to filter by
- `--max-additions <number>` - Maximum additions for auto-approval (default: 50)
- `--max-deletions <number>` - Maximum deletions for auto-approval (default: 50)
- `--max-files <number>` - Maximum changed files for auto-approval (default: 5)
- `--max-lines <number>` - Maximum total lines changed for auto-approval (default: 100)

## How It Works

1. **Fetches PRs**: Gets all open PRs from the specified repository
2. **Filters by Assignments**: Filters PRs based on:
   - Direct user assignments (you or specified users)
   - Team assignments (teams you belong to or specified teams)
3. **Evaluates Complexity**: Checks each filtered PR against configurable criteria:
   - Number of additions
   - Number of deletions
   - Number of changed files
   - Total lines changed
   - Not a draft PR
4. **Auto-Approval**: For simple PRs, automatically approves with a comment
5. **Manual Review**: For complex PRs, prints the URL for manual review

## Example Output

```
🚀 Starting PR review process...
🔍 Running in DRY RUN mode - no changes will be made
📦 Repository: factorialco/factorial
📏 Review criteria: 50 additions, 50 deletions, 5 files, 100 total lines
👥 Teams to filter by: finance, expenses
👤 Users to filter by: none

Initialized for user: yourusername
🔍 Fetching PRs from repository...

📊 Found 15 open PRs in factorialco/factorial
✅ PR #123 included: assigned via team finance
⏭️  PR #124 skipped: no matching assignments
✅ PR #125 included: directly assigned as reviewer
⏭️  PR #126 skipped: no matching assignments
✅ PR #127 included: assigned via team expenses
🔍 Filtered to 3 PRs matching your criteria

📋 PR #123: "Fix typo in README" - 2 additions, 0 deletions, 1 files changed (2 total lines)
🔗 https://github.com/factorialco/factorial/pull/123
✅ This PR looks simple enough for auto-approval
🔍 [DRY RUN] Would approve this PR

📋 PR #125: "Update dependencies" - 5 additions, 3 deletions, 2 files changed (8 total lines)
🔗 https://github.com/factorialco/factorial/pull/125
✅ This PR looks simple enough for auto-approval
🔍 [DRY RUN] Would approve this PR

📋 PR #127: "Refactor authentication system" - 150 additions, 80 deletions, 12 files changed (230 total lines)
🔗 https://github.com/factorialco/factorial/pull/127
⚠️  This PR needs manual review (too large or complex)
🔗 Open in browser: https://github.com/factorialco/factorial/pull/127

📊 Summary:
✅ Auto-approved: 0
⚠️  Manual review needed: 1
```

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Build the project
bun run build

# Run the built version
bun run start
```

## Requirements

- Bun (latest version)
- GitHub CLI (gh) - authenticated with your GitHub account
- TypeScript (for development)