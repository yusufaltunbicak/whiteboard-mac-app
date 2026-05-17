# AGENTS.md

This file is the operating guide for AI coding agents working on Whiteboard Todos.
Treat it as project policy unless the user explicitly gives a newer instruction in the current conversation.

## Project Summary

Whiteboard Todos is a macOS Electron application backed by Markdown files.
The renderer is a React + Vite app, while Electron handles desktop file IO, menus, update checks, packaging, and local board storage.

Core technologies:

- Electron main process: `electron/main.js`
- Local board storage and sync logic: `electron/boardStore.js`
- Markdown parser/serializer: `electron/markdown.js`
- Renderer app: `src/App.jsx`, `src/components/*`, `src/whiteboardApi.js`
- Packaging: `electron-builder.common.cjs`, `electron-builder.config.cjs`, `electron-builder.beta.config.cjs`
- macOS signing/notarization helper: `scripts/notarize.cjs`
- GitHub Actions: `.github/workflows/*`
- Tests: `tests/markdown.test.mjs`, `tests/e2e-electron.mjs`

There is no remote production database in this repository. Treat data separation as local app separation: bundle ID, app name, update channel, Electron `userData`, and default board path.

## Non-Negotiable Branch And Release Policy

For any meaningful or risky development work, always work on a new branch first.
Do not make large changes directly on `main` or `staging` unless the user explicitly asks for that exact action.

Default flow, when the user does not specify otherwise:

1. Create or use a `feature/*` branch for local development.
2. Validate locally on the feature branch.
3. Merge/push to `staging` for beta release and beta testers.
4. Merge to `main` only after staging is accepted.
5. Publish stable only from a stable `vX.Y.Z` tag or the manual Stable Release workflow.

Branch meanings:

- `feature/*`: local development and CI only. Never publish a GitHub Release, prerelease, update metadata, notarized app, or public artifact from feature branches.
- `staging`: beta app line. A push or merge to `staging` may publish `Whiteboard Todos Beta.app`, a GitHub prerelease, and `beta` update metadata.
- `main`: stable source line. A push or merge to `main` must not by itself send updates to stable users.
- `vX.Y.Z` tag or manual Stable Release workflow: stable publishing line. This is the only normal way to publish stable update metadata to the `latest` channel.

Important release safety rule:

- Merging to `main` is not a release.
- Stable users should receive updates only after a stable `vX.Y.Z` release is published.
- Never delete, overwrite, or mutate existing GitHub draft/release assets unless the user explicitly approves.
- Never perform Apple Developer account, legal agreement, certificate portal, or paid account operations for the user.

## App Lines And Isolation

Stable app:

- App name: `Whiteboard Todos`
- Bundle ID: `com.yusufaltunbicak.whiteboardtodos`
- Update channel: `latest`
- GitHub release type: stable release
- Output directory: `release/stable`
- Default `userData`: `~/Library/Application Support/Whiteboard Todos`
- Default board file: `~/Documents/Second brain/whiteboard-todos.md`
- Builder config: `electron-builder.config.cjs`

Beta app:

- App name: `Whiteboard Todos Beta`
- Bundle ID: `com.yusufaltunbicak.whiteboardtodos.beta`
- Update channel: `beta`
- GitHub release type: prerelease
- Output directory: `release/beta`
- Default `userData`: `~/Library/Application Support/Whiteboard Todos Beta`
- Default board file: `~/Documents/Second brain/whiteboard-todos-beta.md`
- Builder config: `electron-builder.beta.config.cjs`

Keep beta and stable installable side by side. Changes must not collapse bundle IDs, app names, `userData` paths, board paths, or update channels.

## Versioning Policy

Stable versions are final semver values:

```text
1.1.0
1.2.0
2.0.0
```

Beta versions must be unique, semver-compatible prerelease values and must increase on every beta release:

```text
1.1.0-beta.1
1.1.0-beta.2
1.1.0-beta.42
```

The staging workflow computes beta versions as:

```text
<base stable version>-beta.<GITHUB_RUN_NUMBER>
```

This is intentional. `electron-updater` only sees a beta build as an update if the published version is greater than the installed version. Do not replace this with a timestamp or non-semver string.

If preparing the next beta train before `package.json` has been bumped, use the Beta Release workflow's `base_version` input. Once beta users have installed a higher beta base, do not lower the base version.

## Development Commands

Install dependencies:

```bash
npm ci
```

Run the app in development:

```bash
npm run dev
```

Run the production-built Electron app locally:

```bash
npm run run
```

Build renderer:

```bash
npm run build
```

Run parser and serializer tests:

```bash
npm run test:parser
```

Verify release/app isolation config:

```bash
npm run test:release-config
```

Run Electron E2E smoke test:

```bash
npm run test:e2e
```

Local packaging without publish:

```bash
npm run dist
npm run dist:beta
```

Publishing scripts exist, but do not run them casually:

```bash
npm run publish:release
npm run publish:beta
```

Only use publish scripts inside the intended release workflow or after explicit user approval.

## Validation Expectations

For normal code changes, run at least:

```bash
npm run test:parser
npm run test:release-config
npm run build
```

For Electron runtime, storage, board sync, renderer interaction, or desktop behavior changes, also run:

```bash
npm run test:e2e
```

For release, packaging, update, app identity, signing, or CI workflow changes, also verify:

```bash
ruby -e 'require "yaml"; ARGV.each { |f| YAML.load_file(f); puts "ok #{f}" }' .github/workflows/*.yml
```

When changing release config, explicitly confirm these remain distinct:

- Stable app ID vs beta app ID
- Stable product name vs beta product name
- Stable `latest` channel vs beta `beta` channel
- Stable release output vs beta release output
- Stable `userData` path vs beta `userData` path
- Stable board path vs beta board path

## GitHub Actions Policy

The intended workflows are:

- `.github/workflows/ci.yml`: PR, `feature/*`, and `main` validation only. No publish.
- `.github/workflows/beta-release.yml`: `staging` push/manual beta prerelease publish.
- `.github/workflows/stable-release.yml`: stable tag/manual stable publish only.

Do not add a workflow that publishes stable releases on plain `main` push.
Do not add a workflow that publishes beta releases from `feature/*`.
Do not broaden workflow triggers without explaining the release impact.

Required release secrets:

```text
MAC_CERTIFICATE
MAC_CERTIFICATE_PASSWORD
APPLE_API_KEY_B64
APPLE_API_KEY_ID
APPLE_API_ISSUER
APPLE_TEAM_ID
```

Release workflows should fail before publishing if required signing/notarization secrets are missing.

## Storage And Data Safety

The app writes user data locally. Be careful with real board files and real vault folders.

Default stable board:

```text
~/Documents/Second brain/whiteboard-todos.md
```

Default beta board:

```text
~/Documents/Second brain/whiteboard-todos-beta.md
```

For tests, always use temporary paths or the existing E2E test harness. Safe manual override pattern:

```bash
WHITEBOARD_USER_DATA_PATH=/tmp/whiteboard-user-data \
WHITEBOARD_TODOS_PATH=/tmp/whiteboard-todos.md \
npm run run
```

Do not modify the user's real Second Brain vault, board file, or sync folders during tests unless the user explicitly asks.

## Code Style And Architecture Notes

- Keep the renderer browser-safe; desktop-only APIs belong behind the Electron preload bridge.
- Keep filesystem logic in Electron-side modules, not React components.
- Prefer extending `electron/boardStore.js` and `electron/markdown.js` for board persistence changes.
- Preserve Markdown round-trip behavior. Existing frontmatter, task IDs, positions, labels, areas, categories, and external task metadata matter.
- Do not break opt-in vault sync. External task source notes remain authoritative for task text.
- Keep beta/stable identity logic centralized and testable.
- Avoid broad refactors while fixing release, updater, or storage bugs.

## UI And Product Expectations

This is a productivity tool, not a marketing site.

- Keep the UI quiet, fast, and usable for repeated work.
- Avoid landing-page patterns inside the app.
- Preserve dense but readable task-board behavior.
- Verify interaction changes in a real browser/Electron session when practical.
- Do not add visible instructional copy unless the workflow truly needs it.

## Release And Update Guardrails

`electron-updater` behavior is channel-sensitive and semver-sensitive.

- Stable must use `latest`.
- Beta must use `beta`.
- Beta can allow prerelease updates.
- Stable must not see beta prereleases.
- Beta should not accidentally move to stable releases through the stable channel.
- New beta builds must have increasing prerelease semver.

Before changing updater code, inspect:

- `electron/main.js`
- `electron-builder.common.cjs`
- `electron-builder.config.cjs`
- `electron-builder.beta.config.cjs`
- `.github/workflows/beta-release.yml`
- `.github/workflows/stable-release.yml`

## Agent Working Rules

- Start by checking `git status --short --branch`.
- Preserve user changes. Never revert unrelated edits.
- Use a new `feature/*` branch for large changes unless the user explicitly says otherwise.
- Keep changes scoped to the user's request.
- Prefer `rg` and `rg --files` for repo exploration.
- Use `apply_patch` for manual edits.
- Do not run destructive git commands like `git reset --hard` or `git checkout --` unless explicitly instructed.
- Do not publish releases, push tags, or mutate GitHub Releases without explicit user approval.
- After work, summarize changed files, validation commands, and any release-impacting behavior.

## Quick Start Checklist For Large Changes

1. Check branch and dirty state.
2. Create a `feature/*` branch if the work is non-trivial.
3. Inspect the relevant existing code and workflows.
4. Make the smallest coherent change.
5. Run the relevant validation commands.
6. Keep beta/stable release isolation intact.
7. Report what changed and how to move feature -> staging -> main.
