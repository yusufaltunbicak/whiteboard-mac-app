# Whiteboard Todos

Markdown-backed macOS whiteboard for todos. The app keeps the board human-editable in Markdown and uses Electron for desktop file IO, watching, menus, packaging, and auto-updates.

## Download and Install

Stable releases are published as notarized macOS DMGs on GitHub Releases:

```text
https://github.com/yusufaltunbicak/whiteboard-mac-app/releases
```

Open the DMG, drag `Whiteboard Todos.app` into `Applications`, then launch it from Applications or Spotlight.

Beta builds are packaged separately as `Whiteboard Todos Beta.app` with a separate bundle ID and user data folder, so stable and beta can be installed side by side.

## Board Files

Stable default board:

```text
~/Documents/Second brain/whiteboard-todos.md
```

Beta default board:

```text
~/Documents/Second brain/whiteboard-todos-beta.md
```

For smoke tests or one-off safe runs, override the paths:

```bash
WHITEBOARD_USER_DATA_PATH=/tmp/whiteboard-user-data \
WHITEBOARD_TODOS_PATH=/tmp/whiteboard-todos.md \
npm run run
```

The board file stores local tasks as Markdown task lines and whiteboard-only metadata in frontmatter:

```markdown
- [ ] Task text #work !!! // note <!-- id:abc123 createdAt:2026-01-01T00:00:00.000Z -->
```

## Development

```bash
npm ci
npm run dev          # Vite dev server + Electron shell
npm run build        # renderer production build
npm run run          # build then launch Electron from dist
npm run test:parser  # Markdown parser/serializer tests
npm run test:voice   # voice board-action/context tests
npm run test:e2e     # production Electron E2E smoke against temp board/vault
```

Legacy web scripts remain available:

```bash
npm run web:dev
npm run web:start
```

## Development & Release Flow

Branch model:

- `feature/*`: local development, PR checks, parser tests, release config checks, and renderer build only. No GitHub Release is created and no update metadata is published.
- `staging`: beta app. A push or merge to `staging` runs the Beta Release workflow, builds `Whiteboard Todos Beta.app`, publishes a GitHub prerelease, and writes update metadata to the `beta` channel.
- `main`: stable source branch. A push or merge to `main` runs CI only. It does not publish a public stable update by itself.
- `vX.Y.Z` tag or the Stable Release manual workflow: stable app. This publishes `Whiteboard Todos.app` as a stable GitHub Release and writes update metadata to the `latest` channel.

Feature branch local loop:

```bash
npm ci
npm run test:parser
npm run test:voice
npm run test:release-config
npm run build
npm run test:e2e
```

Beta release loop:

```bash
git checkout staging
git merge feature/my-change
git push origin staging
```

The workflow computes `BETA_VERSION` as:

```text
<package.json version>-beta.<GITHUB_RUN_NUMBER>
```

For example, package version `1.1.0` and run number `42` becomes `1.1.0-beta.42`. GitHub run numbers are monotonically increasing per workflow, so each beta prerelease is a higher semver than the previous beta build. This matters because `electron-updater` only offers an update when the published version is newer than the installed version.

If the next stable version is not yet in `package.json`, run the Beta Release workflow manually and set `base_version` to the next stable base, for example `1.1.0`. Do not reuse or lower the beta base once users have installed a higher beta version.

Stable release loop:

```bash
git checkout main
git merge staging
git tag v1.1.0
git push origin main
git push origin v1.1.0
```

Pushing `main` alone only runs CI. The stable update is published only by pushing a stable `vX.Y.Z` tag or by running the Stable Release workflow manually with a stable semver version.

Release isolation:

```text
Stable app: Whiteboard Todos.app
Stable bundle id: com.yusufaltunbicak.whiteboardtodos
Stable update channel: latest
Stable userData: ~/Library/Application Support/Whiteboard Todos
Stable board: ~/Documents/Second brain/whiteboard-todos.md

Beta app: Whiteboard Todos Beta.app
Beta bundle id: com.yusufaltunbicak.whiteboardtodos.beta
Beta update channel: beta
Beta userData: ~/Library/Application Support/Whiteboard Todos Beta
Beta board: ~/Documents/Second brain/whiteboard-todos-beta.md
```

There is no remote production database in this repo. Data separation is therefore handled by separate bundle IDs, app names, update channels, Electron userData paths, and default board paths.

GitHub Actions release secrets:

```text
MAC_CERTIFICATE              Base64-encoded Developer ID Application certificate, or another electron-builder-compatible CSC_LINK value.
MAC_CERTIFICATE_PASSWORD     Password for MAC_CERTIFICATE.
APPLE_API_KEY_B64            Base64-encoded App Store Connect API key .p8 file.
APPLE_API_KEY_ID             App Store Connect API key ID.
APPLE_API_ISSUER             App Store Connect issuer UUID.
APPLE_TEAM_ID                Apple Developer Team ID.
```

The workflows use the built-in `GITHUB_TOKEN` for GitHub Release upload. If these signing or notarization secrets are missing, release workflows fail before publishing.

## Packaging

Stable:

```bash
npm run dist
```

Beta:

```bash
npm run dist:beta
```

Notarized builds require Apple notary credentials and the existing Developer ID signing identity:

```bash
NOTARIZE=true \
APPLE_KEYCHAIN_PROFILE=notarytool-profile-name \
npm run dist
```

Or with an App Store Connect API key:

```bash
NOTARIZE=true \
APPLE_API_KEY=~/.private_keys/AuthKey_KEYID.p8 \
APPLE_API_ISSUER=issuer-uuid \
npm run dist
```

The packaging config produces DMG + ZIP artifacts for macOS arm64. The ZIP and generated update metadata are used by `electron-updater`; the DMG is the user-facing download.

## Updates

The app uses `electron-updater` with GitHub Releases:

- Stable uses the `latest` channel.
- Beta uses the `beta` channel and prerelease releases.
- Auto-update checks run only in packaged builds.

## Opt-In Obsidian Sync

Vault sync is off by default. Use the app's Sync menu or the sync button in the lower-right controls to select folders. Only tasks containing configured tags are surfaced, defaulting to:

```text
#whiteboard
#wb
```

External note tasks are not imported into the board Markdown. Their source note remains authoritative for task text, and checkbox changes can sync both ways. Whiteboard placement/category/priority/note overlays for external tasks are stored in Electron user data.

## Voice Assistant

The Electron app includes an opt-in Realtime voice assistant for local board operations:

- Model defaults to `gpt-realtime-2` with `reasoning.effort` set to `low` and voice `marin`.
- OpenAI API keys are stored in Electron main process storage via `safeStorage` when available. The renderer only requests Realtime sessions and never receives the standard API key.
- The default shortcut is `Alt+Space`. Electron registers it as a global tap-to-talk toggle; if another app owns it, the voice panel reports the shortcut as unavailable.
- Voice actions use a shared board-action reducer and are written as undoable transactions in app user data.
- The assistant can create, update, move, complete, prioritize, categorize, and delete board tasks; manage labels, areas, and categories; refresh sync; search allowed local context; and propose memory entries.
- Synced external note text remains source-owned in v1. Voice may change board overlays and checkbox state, but it does not rewrite source note task text.

Voice context is local-first. The assistant searches the board file, selected sync folders, and any folders explicitly granted through the voice folder picker. It sends only small matching snippets to Realtime, not the full vault.

Voice memory files live in app user data:

```text
assistant-memory.md
assistant-voice.md
```

Memory entries are proposed first and appended only after approval.

## License

MIT
