# GitHub Plugin

The GitHub plugin owns every interaction with github.com in Symphonee: pull requests, reviews, repo discovery, cloning, and the git log sidebar.

## Routes

The HTTP handlers live in this plugin's `routes.js`. The manifest keeps the legacy absolute paths under `/api/github/*` and `/api/pull-request` so existing UI, scripts, and AI routes keep working while ownership is plugin-based.

| Surface              | Current path                          | Purpose                                    |
|----------------------|---------------------------------------|--------------------------------------------|
| List PRs             | `GET /api/github/pulls`               | Used by the PR center tab                  |
| PR detail            | `GET /api/github/pulls/detail`        | Header + body of a single PR               |
| PR files             | `GET /api/github/pulls/files`         | Changed files with patches                 |
| PR comments          | `GET /api/github/pulls/comments`      | Issue + review comments merged             |
| PR timeline          | `GET /api/github/pulls/timeline`      | Events, reviews, commits                   |
| Add comment          | `POST /api/github/pulls/comment`      | Write a comment (gated)                    |
| Submit review        | `POST /api/github/pulls/review`       | APPROVE / CHANGES_REQUESTED / COMMENT      |
| Create PR            | `POST /api/pull-request`              | Open a PR; same permission gate            |
| Image proxy          | `GET /api/github/image`               | Proxies private repo image attachments     |
| User repos           | `GET /api/github/user-repos`          | Repos modal "Clone from GitHub"            |
| Clone                | `POST /api/github/clone`              | Clones into a local folder                 |
| Repo info            | `GET /api/github/repo-info`           | Parses origin remote for owner/repo        |

## Contributions

- `prProvider` describes the full PR surface so the generic Backlog/PR tab can render GitHub PRs without hard-coding the routes.
- `repoSources` adds the "Clone from GitHub" entry in the repos modal.
- `commitLinkers` turns `#123` in commit messages into a link to `pull/123`.
- `configKeys` and `sensitiveKeys` declare this plugin's config ownership and secret scrubbing.

## Configuration

Reads `GitHubPAT`. This key is persisted in `dashboard/plugins/github/config.json` and merged into `/api/config` for backward compatibility.

## Workflow rules (owned by this plugin)

### Creating pull requests

Use the built-in script to create PRs on GitHub. NEVER use the `gh` CLI.

```bash
# Bash: push + create PR in one shot (auto-detects branch, generates title)
powershell.exe -ExecutionPolicy Bypass -NoProfile -Command "./dashboard/plugins/github/scripts/Push-AndPR.ps1 -Repo 'MyRepo'"

# With a custom title and target branch
powershell.exe -ExecutionPolicy Bypass -NoProfile -Command "./dashboard/plugins/github/scripts/Push-AndPR.ps1 -Repo 'MyRepo' -Title 'Add feature X' -Description 'Details' -TargetBranch 'develop'"
```

`New-PullRequest.ps1` gives finer-grained control over title, description, and target branch.

If the Azure DevOps plugin is also installed, `AB#<id>` references in commit messages and branch names auto-link the PR to the matching work item -- that crosswalk is documented in the Azure DevOps plugin.

### Plugin scripts

Under `./dashboard/plugins/github/scripts/`:

| Script | Purpose |
|---|---|
| `Push-AndPR.ps1 -Repo '<name>'` | Push + open a PR in one shot |
| `New-PullRequest.ps1 -Repo '<name>' -Title '...' -Description '...'` | PR with custom body |

Call with `powershell.exe -ExecutionPolicy Bypass -NoProfile -File "./dashboard/plugins/github/scripts/<Name>.ps1"` from bash.
