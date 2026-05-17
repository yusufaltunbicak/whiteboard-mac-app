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
npm run test:e2e     # production Electron E2E smoke against temp board/vault
```

Legacy web scripts remain available:

```bash
npm run web:dev
npm run web:start
```

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

## License

MIT
