// Exercises the actual IndexedDB implementation in an isolated local Chrome/Edge profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .filter(Boolean).find(candidate => fs.existsSync(candidate));
assert.ok(executable, 'Chrome or Edge is required; set CHROME_PATH');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-image-idb-'));
const server = http.createServer((req, res) => {
  if (req.url === '/chat-images-store.js') {
    res.writeHead(200, {'Content-Type': 'text/javascript'});
    fs.createReadStream(path.join(root, 'public/chat-images-store.js')).pipe(res);
  } else res.writeHead(200, {'Content-Type': 'text/html'}).end('<!doctype html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, origin], {stdio: 'ignore'});
let socket;
try {
  let port;
  for (let i = 0; i < 200; i++) {
    try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); if (port) break; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(port, 'browser DevTools did not start');
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
  const page = targets.find(t => t.type === 'page');
  assert.ok(page, 'browser page missing');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (!pending.has(message.id)) return;
    const {resolve, reject} = pending.get(message.id); pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
  });
  const call = (method, params) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params})); });
  // Navigate explicitly so module loading and IndexedDB use a non-opaque origin.
  await call('Page.navigate', {url: origin});
  await new Promise(resolve => setTimeout(resolve, 300));
  const result = await call('Runtime.evaluate', {awaitPromise: true, returnByValue: true, expression: `(${async function () {
    const {createImageStore, imageStore} = await import('/chat-images-store.js');
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const eq = (actual, expected, message) => check(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`);
    check(imageStore && typeof imageStore.save === 'function', 'default export instance');
    const name = `image-test-${Date.now()}`;
    const store = createImageStore(name);
    const blob = text => new Blob([text], {type: 'image/png'});
    const base = (userId, id, createdAt, pending = false) => ({userId, id, createdAt, archivePending: pending, prompt: id, model: 'test', options: {nested: {attachment: blob('not metadata')}}, references: [], images: []});
    const record = {...base('alice', 'a', 100, true), references: [{name: 'ref', blob: blob('reference')}], images: [{slot: 4, blob: blob('image')}, {slot: 5, assetId: 'custom', blob: blob('custom')}]};
    const saved = await store.save(record);
    eq(saved.references[0].assetId, 'reference-0', 'reference id');
    eq(saved.images.map(x => x.assetId), ['image-4', 'custom'], 'image ids');
    check(!('blob' in saved.references[0]) && !('blob' in saved.images[0]) && !('attachment' in saved.options.nested), 'saved metadata strips blobs');
    check(record.references[0].blob instanceof Blob && !record.references[0].assetId, 'input not mutated');
    eq(await (await store.getAsset('alice', 'a', 'reference-0')).text(), 'reference', 'reference bytes');
    eq(await (await store.getAsset('alice', 'a', 'image-4')).text(), 'image', 'image bytes');
    eq(await store.getAsset('bob', 'a', 'image-4'), null, 'asset isolation');
    const updated = {...saved, prompt: 'updated'};
    await store.save(updated);
    eq(await (await store.getAsset('alice', 'a', 'image-4')).text(), 'image', 'metadata-only save preserves assets');
    eq((await store.get('alice', 'a')).prompt, 'updated', 'get');
    eq(await store.get('bob', 'a'), null, 'get isolation');
    await store.save({...base('bob', 'a', 100, true), images: [{blob: blob('bob')}]});
    for (const [id, time, queued] of [['b', 100, true], ['c', 101, false], ['d', 101, true], ['e', 102, true]]) await store.save(base('alice', id, time, queued));
    let page = await store.list('alice', {limit: 2});
    eq(page.records.map(r => r.id), ['e', 'd'], 'first page descending including ties');
    eq(page.total, 5, 'total per user');
    eq(page.nextCursor, {createdAt: 101, id: 'd'}, 'first cursor');
    page = await store.list('alice', {before: page.nextCursor, limit: 2});
    eq(page.records.map(r => r.id), ['c', 'b'], 'second page');
    page = await store.list('alice', {before: page.nextCursor, limit: 2});
    eq(page.records.map(r => r.id), ['a'], 'last page');
    eq(page.nextCursor, null, 'end cursor');
    eq((await store.list('bob')).records.map(r => r.id), ['a'], 'list isolation');
    eq((await store.pending('alice', {limit: 2})).map(r => r.id), ['a', 'b'], 'bounded pending oldest first');
    await store.save({...await store.get('alice', 'a'), archivePending: false});
    eq((await store.pending('alice')).map(r => r.id), ['b', 'd', 'e'], 'pending index updates');
    // A clone failure after an asset put must abort the entire transaction.
    let failed = false;
    try { await store.save({...base('alice', 'broken', 500), options: {invalid: () => {}}, images: [{blob: blob('partial')}]}); } catch (error) { failed = /storage/i.test(error.message); }
    check(failed, 'clone error surfaced as storage error');
    eq(await store.get('alice', 'broken'), null, 'failed metadata not committed');
    eq(await store.getAsset('alice', 'broken', 'image-0'), null, 'failed asset not committed');
    await store.delete('alice', 'a');
    eq(await store.get('alice', 'a'), null, 'delete record');
    eq(await store.getAsset('alice', 'a', 'image-4'), null, 'delete assets');
    eq(await (await store.getAsset('bob', 'a', 'image-0')).text(), 'bob', 'delete isolated');
    for (const id of ['batch-1', 'batch-2']) {
      await store.save({...base('alice', id, 150), images: [{blob: blob(id)}]});
      await store.save({...base('bob', id, 150), images: [{blob: blob(`bob-${id}`)}]});
    }
    await store.deleteMany('alice', []);
    let invalidBatch = false;
    try { await store.deleteMany('alice', ['batch-1', '']); } catch (error) { invalidBatch = error instanceof TypeError; }
    check(invalidBatch, 'invalid batch rejected before transaction');
    check(await store.get('alice', 'batch-1'), 'invalid batch does not delete earlier ids');
    invalidBatch = false;
    try { await store.deleteMany('alice', 'batch-1'); } catch (error) { invalidBatch = error instanceof TypeError; }
    check(invalidBatch, 'non-array batch rejected');
    // Inject a synchronous failure after the first record delete is queued.
    // The real IndexedDB transaction must roll back all queued operations.
    const originalDelete = IDBObjectStore.prototype.delete;
    let recordDeletes = 0;
    IDBObjectStore.prototype.delete = function (key) {
      if (this.name === 'records' && ++recordDeletes === 2) throw new Error('injected batch failure');
      return originalDelete.call(this, key);
    };
    let batchFailed = false;
    try { await store.deleteMany('alice', ['batch-1', 'batch-2']); }
    catch (error) { batchFailed = /storage.*injected batch failure/i.test(error.message); }
    finally { IDBObjectStore.prototype.delete = originalDelete; }
    check(batchFailed, 'batch transaction failure surfaced');
    for (const id of ['batch-1', 'batch-2']) {
      check(await store.get('alice', id), 'failed batch preserves metadata');
      eq(await (await store.getAsset('alice', id, 'image-0')).text(), id, 'failed batch preserves blob');
    }
    await store.deleteMany('alice', ['batch-1', 'batch-2', 'batch-1', 'missing']);
    for (const id of ['batch-1', 'batch-2']) {
      eq(await store.get('alice', id), null, 'batch deletes metadata');
      eq(await store.getAsset('alice', id, 'image-0'), null, 'batch deletes blobs');
      check(await store.get('bob', id), 'batch isolates other user metadata');
      eq(await (await store.getAsset('bob', id, 'image-0')).text(), `bob-${id}`, 'batch isolates other user blobs');
    }
    await store.save({...base('alice', 'clear-me', 200), images: [{blob: blob('remove')} ]});
    await store.clear('alice');
    eq(await store.getAsset('alice', 'clear-me', 'image-0'), null, 'clear assets');
    eq((await store.list('alice')).total, 0, 'clear records');
    eq((await store.pending('alice')).length, 0, 'clear queue');
    eq((await store.list('bob')).total, 3, 'clear isolated records');
    eq(await (await store.getAsset('bob', 'a', 'image-0')).text(), 'bob', 'clear isolated assets');
    // An upgrade triggers versionchange and closes the cached connection.
    const upgrade = indexedDB.open(name, 2);
    await new Promise((resolve, reject) => { upgrade.onsuccess = resolve; upgrade.onerror = () => reject(upgrade.error); upgrade.onblocked = () => reject(new Error('versionchange did not close connection')); });
    upgrade.result.close();
    let versionFailed = false;
    try { await store.get('bob', 'a'); } catch (error) { versionFailed = /storage/i.test(error.message); }
    check(versionFailed, 'opening newer database rejects with storage error');
    return 'PASS real browser IndexedDB image store';
  }.toString()})()`});
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  console.log(result.result.value);
} finally {
  socket?.close();
  chrome.kill();
  server.close();
  // Windows may release browser profile files after process exit.
  await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else { chrome.once('exit', resolve); setTimeout(resolve, 3000); } });
  try { fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}); } catch { /* browser may still be shutting down */ }
}
