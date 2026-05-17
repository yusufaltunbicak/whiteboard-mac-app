import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BoardStore } from '../electron/boardStore.js';
import {
  parseBoardMarkdown,
  parseExternalTaskLine,
  serializeBoardMarkdown,
  updateExternalCheckboxLine,
} from '../electron/markdown.js';

test('board markdown round trips existing frontmatter and task metadata', () => {
  const input = `---
summary: keep me
categories:
  - id: work
    name: work
    color: '#4A90D9'
positions:
  abc123:
    - 10
    - 20
labels:
  - id: lbl-one
    text: HELLO
    x: 4
    y: 8
areas: []
---

# Whiteboard Todos

Keep this paragraph.

- [ ] Draft task #work !!! // note here <!-- id:abc123 createdAt:2026-01-01T00:00:00.000Z -->
`;

  const board = parseBoardMarkdown(input, '/tmp/whiteboard-todos.md');
  assert.equal(board.tasks.length, 1);
  assert.equal(board.tasks[0].id, 'abc123');
  assert.equal(board.tasks[0].priority, true);
  assert.equal(board.tasks[0].note, 'note here');
  assert.equal(board.tasks[0].x, 10);
  assert.equal(board.frontmatter.summary, 'keep me');

  const output = serializeBoardMarkdown({
    ...board,
    tasks: [{ ...board.tasks[0], checked: true, completedAt: '2026-01-02T00:00:00.000Z', x: 15, y: 25 }],
  }, input);

  assert.match(output, /summary: keep me/);
  assert.match(output, /Keep this paragraph\./);
  assert.match(output, /- \[x\] Draft task #work !!! \/\/ note here <!-- id:abc123 createdAt:2026-01-01T00:00:00.000Z completedAt:2026-01-02T00:00:00.000Z -->/);
  assert.match(output, /abc123:\n\s+- 15\n\s+- 25/);
});

test('external tagged todos parse with source refs and checkbox updates preserve note text', () => {
  const line = '- [ ] Follow up with partner #whiteboard // from meeting ^partner-follow';
  const parsed = parseExternalTaskLine(line, {
    filePath: '/tmp/vault/Partner.md',
    lineNumber: 12,
    syncTags: ['#whiteboard', '#wb'],
  });

  assert.ok(parsed);
  assert.equal(parsed.external, true);
  assert.equal(parsed.checked, false);
  assert.equal(parsed.text, 'Follow up with partner');
  assert.equal(parsed.note, 'from meeting');
  assert.equal(parsed.source.filePath, '/tmp/vault/Partner.md');
  assert.equal(parsed.source.lineNumber, 12);
  assert.equal(parsed.source.blockId, 'partner-follow');

  const updated = updateExternalCheckboxLine(line, true, parsed.source.stableMarker);
  assert.equal(updated.line, '- [x] Follow up with partner #whiteboard // from meeting ^partner-follow');
  assert.equal(updated.markerAdded, false);
});

test('external todos without block ids get wb-id marker on checkbox sync', () => {
  const line = '- [ ] Ship the thing #wb';
  const parsed = parseExternalTaskLine(line, {
    filePath: '/tmp/vault/Inbox.md',
    lineNumber: 3,
    syncTags: ['#whiteboard', '#wb'],
  });

  assert.equal(parsed.source.needsStableMarker, true);
  const updated = updateExternalCheckboxLine(line, true, parsed.source.stableMarker);
  assert.match(updated.line, /^- \[x\] Ship the thing #wb <!-- wb-id:wb-[a-f0-9]{10} -->$/);
  assert.equal(updated.markerAdded, true);
});

test('board store scans opt-in folders and syncs external checkbox without touching real vault', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-store-'));
  const userDataPath = path.join(root, 'user-data');
  const boardPath = path.join(root, 'whiteboard-todos.md');
  const vaultFolder = path.join(root, 'vault', 'Projects');
  const notePath = path.join(vaultFolder, 'Project.md');

  fs.mkdirSync(vaultFolder, { recursive: true });
  fs.writeFileSync(boardPath, `---
categories: []
positions:
  local01:
    - 10
    - 10
labels: []
areas: []
---

# Whiteboard Todos

- [ ] Local task <!-- id:local01 -->
`, 'utf-8');
  fs.writeFileSync(notePath, '- [ ] External task #wb\n- [ ] Other task\n', 'utf-8');

  const store = new BoardStore({ userDataPath, boardPath });
  store.updateSyncSettings({ enabled: true, folders: [vaultFolder], tags: ['#wb'] });

  const board = store.readBoard();
  const external = board.tasks.find(task => task.external);
  assert.ok(external);
  assert.equal(external.text, 'External task');
  assert.equal(board.tasks.some(task => task.text === 'Other task'), false);

  const movedAndChecked = {
    ...board,
    tasks: board.tasks.map(task => (
      task.id === external.id
        ? { ...task, checked: true, x: 500, y: 600, note: 'sidecar note' }
        : task
    )),
  };
  store.writeBoard(movedAndChecked);

  const noteAfterSync = fs.readFileSync(notePath, 'utf-8');
  assert.match(noteAfterSync, /^- \[x\] External task #wb <!-- wb-id:wb-[a-f0-9]{10} -->/);
  assert.match(noteAfterSync, /- \[ \] Other task/);

  const index = JSON.parse(fs.readFileSync(path.join(userDataPath, 'whiteboard-index.json'), 'utf-8'));
  assert.equal(index.externalLayouts[external.id].x, 500);
  assert.equal(index.externalLayouts[external.id].y, 600);
  assert.equal(index.externalLayouts[external.id].note, 'sidecar note');

  const withoutExternal = {
    ...store.readBoard(),
    tasks: store.readBoard().tasks.filter(task => task.id !== external.id),
  };
  store.writeBoard(withoutExternal);
  assert.equal(store.readBoard().tasks.some(task => task.id === external.id), false);

  store.close();
});
