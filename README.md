# GitHub Plugin for Symphonee

Integrates GitHub into Symphonee: pull requests, reviews, cloning, and the git log sidebar.

## Installation

1. Clone into your Symphonee plugins folder:
   ```
   git clone https://github.com/M8N-MatanDessaur/symphonee-plugin-github.git dashboard/plugins/github
   ```
2. Restart Symphonee.
3. Open **Settings -> Plugins -> GitHub** and paste your Personal Access Token (classic, `repo` scope).

## What it contributes

- `prProvider` -- powers the Pull Requests center tab.
- `repoSources` -- adds "Clone from GitHub" to the repos modal.
- `commitLinkers` -- turns `#123` in commit messages into a link to the PR.
- `centerTabs: Pull Requests` and `rightTabs: Git Log`.
- `configKeys` / `sensitiveKeys` -- keep GitHub config in this plugin's `config.json` and scrub PATs from exports.

## Routes

The HTTP handlers live in this plugin's `routes.js`. Legacy `/api/github/*` and `/api/pull-request` paths are still registered so older UI code and scripts keep working.

## Uninstall

Delete the `dashboard/plugins/github/` folder and restart.
