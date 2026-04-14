# GitHub Plugin for DevOps Pilot

Integrates GitHub into DevOps Pilot: pull requests, reviews, cloning, and the git log sidebar.

## Installation

1. Clone into your DevOps Pilot plugins folder:
   ```
   git clone https://github.com/M8N-MatanDessaur/devops-pilot-plugin-github.git dashboard/plugins/github
   ```
2. Restart DevOps Pilot.
3. Open **Settings -> Plugins -> GitHub** and paste your Personal Access Token (classic, `repo` scope).

## What it contributes

- `prProvider` -- powers the Pull Requests center tab.
- `repoSources` -- adds "Clone from GitHub" to the repos modal.
- `commitLinkers` -- turns `#123` in commit messages into a link to the PR.
- `centerTabs: Pull Requests` and `rightTabs: Git Log`.
- `nativeSettings` -- claims the GitHub PAT field so it lives under this plugin.

## Routes

During the Phase 2 extraction the HTTP handlers still live in core DevOps Pilot under `/api/github/*` and `/api/pull-request`. The manifest points at those absolute paths. A future release will move the handlers into this plugin's `routes.js`.

## Uninstall

Delete the `dashboard/plugins/github/` folder and restart.
