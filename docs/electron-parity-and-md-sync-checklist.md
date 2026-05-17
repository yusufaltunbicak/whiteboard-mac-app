# Electron Parity and Markdown Sync Checklist

This checklist is the migration contract for rebuilding the current Vite/React + Express whiteboard as an Electron macOS app. It was derived from `server.js`, `src/App.jsx`, `src/App.css`, and the component files under `src/components/`.

## Current Behavior to Preserve

- [x] Canonical board model remains Markdown-first: `whiteboard-todos.md` contains task lines and YAML frontmatter for board-only metadata.
- [x] Default board path remains compatible with the current server path: `~/Documents/Second brain/whiteboard-todos.md`.
- [x] Existing board files with `categories`, `positions`, `labels`, `areas`, and unknown frontmatter keys must continue to parse.
- [x] If the canonical board file is absent, the app may create the same starter board used by the legacy server.
- [x] Markdown task format remains compatible: `- [ ] text #category !!! // note <!-- id:abc createdAt:... completedAt:... -->`.
- [x] Existing task IDs, `createdAt`, `completedAt`, category IDs, labels, areas, positions, and defaults are preserved when serializing.
- [x] Task checkbox toggles update `completedAt` when completed and clear it when reopened.
- [x] Task add flow creates tasks near the viewport center with a stable ID, timestamp, optional category, and optional priority.
- [x] Task delete removes local board tasks from the board Markdown.
- [x] Task right-click menu preserves edit, note, priority, category, complete/incomplete, and delete behavior for local board tasks.
- [x] Task drag preserves free placement, current rotations, priority styling, checked styling, note display, and category chip styling.
- [x] Multi-select with `meta`/`ctrl` click preserves selected-task rings and grouped drag.
- [x] Bulk action bar preserves selected count, category assign/clear, priority toggle, checkbox toggle, delete confirmation, and clear selection.
- [x] Category add, delete, rename, and recolor behavior is preserved.
- [x] Deleting a category clears that category from tasks.
- [x] Canvas preserves pan, wheel zoom, zoom limits, zoom controls, reset, fit-all, toolbar hide/show, and dot-grid transforms.
- [x] Pointer movement stays throttled with `requestAnimationFrame`.
- [x] Empty-canvas double-click creates a text label.
- [x] Text labels preserve editing, drag, delete, rotate, color, opacity/faded compatibility, and size controls.
- [x] Areas preserve area tool toggle, drag-to-draw, snap-to-grid creation, minimum size, selection, resize handles, drag, lock/unlock, delete, color, and opacity.
- [x] Escape cancels draft areas and clears selection.
- [x] Save status preserves `Ready`, `Saving...`, `Saved`, and `Save failed` states.
- [x] External file changes reload the board dynamically.
- [x] Theme selection persists in `localStorage` and defaults to system dark/light.
- [x] Toolbar, paper texture, fonts, sketch styling, context menus, prompt modal, responsive behavior, and canvas hint are preserved.
- [x] Mascot/reaction behavior is preserved: board moods, action reactions, hover reactions, drag reactions, idle chatter, zoom cues, mascot hover cues, keyword easter eggs, and SVG eye tracking.

## Electron Runtime Contract

- [x] Electron main process owns file IO, Markdown parsing/serialization, file watching, menus, sync settings, and packaging metadata.
- [x] Renderer does not require the legacy Express server at runtime.
- [x] Renderer talks to main through a narrow preload API.
- [x] `contextIsolation` is enabled.
- [x] Renderer `nodeIntegration` is disabled.
- [x] The remote module is not used.
- [x] IPC exposes only board load/save, board-change subscription, sync settings/actions, and app metadata.
- [x] App lifecycle handles macOS activate behavior and non-macOS `window-all-closed` quit behavior.
- [x] macOS menus include app, file, sync, edit, and view commands.
- [x] Build/package scripts are documented.

## Markdown and Obsidian Sync Rules

- [x] Board-local tasks continue to live in the board Markdown task list.
- [x] Board-only visual metadata for local tasks stays in board frontmatter (`positions`, `labels`, `areas`, `categories`).
- [x] Unknown board frontmatter keys are preserved during board writes.
- [x] Serialization updates task lines instead of treating Markdown as an opaque JSON database.
- [x] Non-task Markdown content in the board file is preserved where possible.
- [x] Opt-in vault scanning is disabled by default.
- [x] Enabling sync requires selected folders; an empty folder list imports nothing.
- [x] Sync only imports Markdown tasks containing configured tags, defaulting to `#whiteboard` and `#wb`.
- [x] Whole-vault import is not enabled by default.
- [x] External todos keep source references: file path, line number, source tag, and stable marker where available.
- [x] External todo identity prefers Obsidian block IDs (`^id`) or app HTML markers (`<!-- wb-id:... -->`).
- [x] External todos without stable markers get deterministic temporary IDs; the first checkbox sync adds a `wb-id` marker to stabilize future moves.
- [x] External visual metadata is stored in an app-owned sidecar index under Electron user data, not in ordinary notes.
- [x] External checkbox changes sync back to the source Markdown file.
- [x] External file checkbox edits sync into the whiteboard through watchers.
- [x] External text edits should be made in the source note; the whiteboard keeps source-note text authoritative.
- [x] External priority/category/note/position are whiteboard-side overlays unless the source line already contains those markers.
- [x] Deleting a local board task deletes it from board Markdown.
- [x] Deleting an external task hides it from the whiteboard sidecar and does not delete the source note task.
- [x] Moving an external task on the canvas updates only sidecar layout.
- [x] Moving an external task between note files remains stable if its `^block-id` or `wb-id` marker moves with it.
- [x] Duplicates are treated as distinct when they have different source files or different stable markers.
- [x] Conflicts are detected conservatively: if an external source line cannot be found by stable marker or expected line, the app keeps the source file unchanged and reports a warning.

## Verification Evidence

- [x] Parser/serializer board round-trip test added.
- [x] External tagged todo parse and checkbox-sync test added.
- [x] `npm run test:parser` passes.
- [x] `npm run build` passes.
- [x] Electron app launches against a temporary board path without using Express.
- [x] Renderer smoke test verifies load, add task, save persistence, and reload.
- [x] External file reload/sync smoke test verifies opt-in tagged tasks and checkbox writeback on a temporary vault.
- [x] Packaged launch verified with the unpacked `release/mac-arm64/Whiteboard Todos.app` and a temporary board path.

## Approved Exceptions

- [x] Existing `server.js` is kept for legacy web use, but it is not part of Electron runtime.
- [x] Existing nested board file found at `~/Documents/Second brain/20 Areas/Kişisel/Notes/whiteboard-todos.md` is not migrated or rewritten automatically because the goal explicitly stops before board path changes or destructive migration.
