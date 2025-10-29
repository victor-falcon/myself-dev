# Review PR Script

A TypeScript script that helps you review GitHub pull requests in a specific repository. It filters PRs by team or user assignments and provides an interactive interface to approve, open, skip, or ignore each PR.

## Features

- 📦 Works with a specific repository (no more searching across all repos)
- 🔍 Filters PRs by team assignments or specific users
- 🎯 Interactive review process - you decide what to do with each PR
- 🤖 AI-powered review using Gemini for intelligent code analysis
- ✅ Approve PRs with a single command
- 🔗 Open PRs in browser for manual review
- ⏭️ Skip PRs you don't want to review right now
- 🚫 Ignore PRs you don't want to review at all (permanently hidden from future runs)
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

3. **Set up AI Review (Optional):**
   - Get a Gemini API key from https://makersuite.google.com/app/apikey
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Add your Gemini API key to `.env`:
     ```
     GEMINI_API_KEY=your_gemini_api_key_here
     ```

4. **Install dependencies:**
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
- `--max-additions <number>` - Maximum additions for simple PR detection (default: 50)
- `--max-deletions <number>` - Maximum deletions for simple PR detection (default: 50)
- `--max-files <number>` - Maximum changed files for simple PR detection (default: 5)
- `--max-lines <number>` - Maximum total lines changed for simple PR detection (default: 100)

## Ignore List

The script maintains a persistent ignore list in `.ignored-prs.json` file. When you choose to ignore a PR, its ID is saved to this file and the PR will never be shown again in future executions. This helps you focus on PRs that actually need your attention.

To reset the ignore list, simply delete the `.ignored-prs.json` file.

## AI Review

The script includes AI-powered code review using Google's Gemini API. When you choose "AI Review (ai)", the script will:

1. **Fetch PR Details**: Gets the PR title, description, and complete diff
2. **AI Analysis**: Sends the code to Gemini for intelligent analysis
3. **Review Decision**: AI determines one of three actions:
   - **Approve**: Simple changes that are ready to merge
   - **Approve with Comments**: Good changes with minor improvements needed
   - **Comment Only**: Changes that need fixes before approval
4. **Interactive Feedback**: Shows AI comments and asks if you want to post them
5. **Comment Editing**: Edit AI comments in nvim before posting them
6. **Approval Editing**: Edit approval messages in nvim before posting them
7. **Smart Comments**: AI focuses on bugs, typos, security issues, and code quality

### AI Review Features:
- Analyzes the complete PR diff for comprehensive review
- Provides specific file and line number feedback
- Focuses on actionable improvements rather than style preferences
- Shows code context for each comment
- Asks for confirmation before posting comments
- Allows editing comments in nvim before posting
- Allows editing approval messages in nvim before posting
- Falls back gracefully if AI review fails

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
4. **Interactive Review**: For each PR, asks what you want to do:
   - **Approve (a)**: Approve the PR with a comment
   - **Open (o)**: Open the PR in your browser for manual review
   - **Skip (s)**: Skip this PR for now
   - **Ignore (i)**: Ignore this PR completely (will never be shown again)
   - **AI Review (ai)**: Use AI to analyze the PR and provide intelligent feedback

## Example Output

```
🚀 Starting PR review process...
🔍 Running in DRY RUN mode - no changes will be made
📦 Repository: factorialco/factorial
📏 Review criteria: 50 additions, 50 deletions, 5 files, 100 total lines
👥 Teams to filter by: finance, expenses
👤 Users to filter by: none

Initialized for user: yourusername
🤖 AI review enabled with Gemini
🔍 Fetching PRs from repository...

📝 Loaded 2 ignored PRs from previous sessions
🚫 Filtered out 2 ignored PRs from previous sessions
🔍 Found 3 PRs matching your criteria

📋 PR #123: "Fix typo in README" - 2 additions, 0 deletions, 1 files changed (2 total lines)
🔗 https://github.com/factorialco/factorial/pull/123
✅ This PR looks simple
What do you want to do? Approve (a), Open (o), Skip (s), Ignore (i), AI Review (ai): a
💬 Approval comment: ✅ Approved! Small change: 2 additions, 0 deletions across 1 files.
What would you like to do? (a)pprove, (e)dit, (s)kip: e
📝 Opening nvim to edit approval message...
# Edit this approval comment
# Lines starting with # are comments and will be ignored
# The format is:
# APPROVAL_MESSAGE: Your approval message here

APPROVAL_MESSAGE:
✅ Approved! Small change: 2 additions, 0 deletions across 1 files.

💬 Edited approval comment: Perfect! This typo fix is exactly what we needed.
Approve with this edited comment? (y/n): y
🔍 [DRY RUN] Would approve this PR

📋 PR #125: "Update dependencies" - 5 additions, 3 deletions, 2 files changed (8 total lines)
🔗 https://github.com/factorialco/factorial/pull/125
✅ This PR looks simple
What do you want to do? Approve (a), Open (o), Skip (s), Ignore (i), AI Review (ai): ai
🤖 Running AI review...

🤖 AI Review Result: APPROVE
✅ AI recommends approval without comments
💬 Approval message: LGTM! Simple typo fix.
What would you like to do? (a)pprove, (e)dit, (s)kip: e
📝 Opening nvim to edit approval message...
# Edit this approval comment
# Lines starting with # are comments and will be ignored
# The format is:
# APPROVAL_MESSAGE: Your approval message here

APPROVAL_MESSAGE:
LGTM! Simple typo fix.

💬 Edited approval message: Great fix! This typo was causing confusion.
Approve with this edited message? (y/n): y
🔍 [DRY RUN] Would approve this PR

📋 PR #125: "Update dependencies" - 5 additions, 3 deletions, 2 files changed (8 total lines)
🔗 https://github.com/factorialco/factorial/pull/125
✅ This PR looks simple
What do you want to do? Approve (a), Open (o), Skip (s), Ignore (i), AI Review (ai): ai
🤖 Running AI review...

🤖 AI Review Result: APPROVE_WITH_COMMENTS
✅ AI recommends approval with comments
💬 Approval message: Good dependency updates!

📝 AI Comments:

📁 File: package.json
📍 Line: 15
💬 Comment: Consider pinning the version to avoid breaking changes
📄 Context:
  "dependencies": {
    "react": "^18.2.0",
    "lodash": "^4.17.21"
  }
What would you like to do? (p)ost, (e)dit, (s)kip: e
📝 Opening nvim to edit comment...
# Edit this comment
# Lines starting with # are comments and will be ignored
# The format is:
# FILE_PATH:LINE_NUMBER
# COMMENT_CONTENT
# CONTEXT

FILE_PATH:package.json
LINE_NUMBER:15

COMMENT_CONTENT:
Consider pinning the version to avoid breaking changes

CONTEXT:
  "dependencies": {
    "react": "^18.2.0",
    "lodash": "^4.17.21"
  }

📁 File: package.json
📍 Line: 15
💬 Comment: Consider pinning the version to avoid breaking changes
📄 Context:
  "dependencies": {
    "react": "^18.2.0",
    "lodash": "^4.17.21"
  }
Post this edited comment? (y/n): y
🔍 [DRY RUN] Would post comment
Approve this PR with comments? (y/n): y
🔍 [DRY RUN] Would approve this PR

📋 PR #127: "Refactor authentication system" - 150 additions, 80 deletions, 12 files changed (230 total lines)
🔗 https://github.com/factorialco/factorial/pull/127
⚠️  This PR is large or complex
What do you want to do? Approve (a), Open (o), Skip (s), Ignore (i), AI Review (ai): i
🚫 Ignored (will not be shown again)

📊 Summary:
✅ Approved: 2
🔗 Opened: 0
⏭️  Skipped: 0
🚫 Ignored: 1
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