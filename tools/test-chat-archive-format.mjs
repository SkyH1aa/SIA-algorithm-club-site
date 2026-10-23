// Offline: node tools/test-chat-archive-format.mjs
// 两个约定：
// 1) 归档到云盘的 JSON 用 2 空格缩进，人能直接读；
// 2) 删除会话/清除本地数据必须先确认上传成功，再动本地存储。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');

const core = await read('public/chat-core.js');
const chat = await read('public/chat.js');
const fn = await read('supabase/functions/club-drive/index.ts');

// --- 1) 缩进格式 ---
assert.match(core, /export function archiveJsonText\(value\) \{ return JSON\.stringify\(value, null, 2\); \}/,
  'core exposes a pretty printer');
assert.match(fn, /JSON\.stringify\(snapshot, null, 2\)/, 'backend writes indented JSON');
// 分片上限必须为缩进留出余量，且远低于服务端 24 MiB 接收上限。
const partMatch = /export const CHAT_ARCHIVE_PART_BYTES = (\d+) \* 1024 \* 1024;/.exec(core);
assert.ok(partMatch, 'part size is declared');
const partMiB = Number(partMatch[1]);
assert.ok(partMiB <= 3, `part size must leave room for indentation, saw ${partMiB} MiB`);
const maxMatch = /const CHAT_ARCHIVE_MAX_BYTES = (\d+) \* 1024 \* 1024;/.exec(fn);
assert.ok(maxMatch, 'server receive limit is declared');
assert.ok(partMiB * 2 < Number(maxMatch[1]), 'indented payload stays well under the server limit');

// The produced text really is indented and still round-trips.
const { buildChatArchive, archiveJsonText } = await import('../public/chat-core.js');
const snapshot = {
  userId: 'u1', source: 'chat', trigger: 'reply',
  conversations: [{
    id: 'c1', title: 'T', updatedAt: Date.now(),
    turns: [{ id: 't1', prompt: 'hi', response: 'hello', createdAt: Date.now() }]
  }]
};
const parts = buildChatArchive(snapshot);
assert.ok(Array.isArray(parts) && parts.length >= 1, 'archive builds at least one part');
const text = archiveJsonText(parts[0]);
assert.match(text, /\n {2}"schema"/, 'output is indented with two spaces');
assert.match(text, /\n {2}"conversations"/, 'conversations is a top-level indented field');
assert.match(text, /\n {6}"id"/, 'deeply nested fields are indented further');
assert.deepEqual(JSON.parse(text), parts[0], 'indented output round-trips');
assert.ok(text.split('\n').length > 20, 'output is multi-line, not one long line');

// --- 2) 删除顺序：先移除、确认归档、再删本地 ---
function blockAfter(source, needle, size = 1200) {
  const start = source.indexOf(needle);
  assert.ok(start > 0, `${needle} exists`);
  return source.slice(start, start + size);
}

// archiveSnapshot must report success so callers can gate on it.
const archiveFn = blockAfter(chat, 'async function archiveSnapshot', 3000);
assert.match(archiveFn, /return true;/, 'archiveSnapshot reports success');
assert.match(archiveFn, /if \(!response\.ok\) return false;/, 'a failed part aborts and reports failure');

// scheduleChatArchive returns the queue so it can be awaited.
const scheduleFn = blockAfter(chat, 'function scheduleChatArchive', 1100);
assert.match(scheduleFn, /return archiveQueue;/, 'scheduleChatArchive is awaitable');

const deleteBlock = blockAfter(chat, "$('delete').onclick", 1600);
// 1) list removal happens before any await on archiving
const removeIndex = deleteBlock.indexOf('chats = chats.filter');
const archiveIndex = deleteBlock.indexOf('scheduleChatArchive');
assert.ok(removeIndex > 0 && archiveIndex > removeIndex, 'the chat is removed from the list first');
// 2) archive must be awaited and checked
assert.match(deleteBlock, /await scheduleChatArchive/, 'delete awaits the archive');
assert.match(deleteBlock, /if \(!archived\) throw new Error\('archive'\)/, 'delete fails when the archive fails');
// 3) local deletion only after the archive barrier
const localDelete = deleteBlock.indexOf('workspaceStore.delete');
assert.ok(localDelete > archiveIndex, 'local storage is only touched after archiving');
// 4) rollback on failure
assert.match(deleteBlock, /chats\.splice\(/, 'the chat is restored if archiving fails');
assert.match(deleteBlock, /archiveFailed/, 'the user is told the upload failed');
// 5) the archive must include the chat being deleted
assert.match(deleteBlock, /archiveSnapshotList/, 'archive uses the pre-delete snapshot');

const clearBlock = blockAfter(chat, "$('clear').onclick", 1600);
const clearRemove = clearBlock.indexOf('chats = []');
const clearArchive = clearBlock.indexOf('scheduleChatArchive');
assert.ok(clearRemove > 0 && clearArchive > clearRemove, 'clear empties the list first');
assert.match(clearBlock, /await scheduleChatArchive/, 'clear awaits the archive');
assert.match(clearBlock, /if \(!archived\) throw new Error\('archive'\)/, 'clear fails when the archive fails');
const clearLocal = clearBlock.indexOf('workspaceStore.clear');
assert.ok(clearLocal > clearArchive, 'local clear happens after archiving');
assert.match(clearBlock, /chats = snapshot/, 'clear restores the list if archiving fails');
// The snapshot must be the pre-clear list, otherwise memory-only chats are lost.
assert.match(clearBlock, /scheduleChatArchive\('reply', \[\], snapshot\)/, 'clear archives the pre-clear snapshot');

// --- 3) i18n for the new states ---
const i18n = await read('public/chat-i18n.js');
for (const key of ['archiving', 'archiveFailed']) {
  const hits = [...i18n.matchAll(new RegExp(`${key}:`, 'g'))];
  assert.equal(hits.length, 2, `${key} exists in both languages`);
}
assert.match(chat, /'archiveFailed'\]/, 'archiveFailed renders as an error status');

console.log(`Chat archive: indented JSON (${partMiB} MiB parts, round-trips), remove-then-archive-then-delete with rollback, ${2} status messages in both languages.`);
