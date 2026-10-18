// Fully offline; no environment or network permissions required.
// deno run --no-remote tools/test-chat-body.ts
import { strict as assert } from 'node:assert';
import { ChatBodyError, readChatBody } from '../supabase/functions/_shared/chat-body.ts';

const encoder = new TextEncoder();
function request(body: ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer> | null, length?: string, signal?: AbortSignal): Request {
  return new Request('https://offline.invalid/chat', {
    method: 'POST', headers: length === undefined ? {} : { 'content-length': length }, body, signal
  });
}
function error(code: string, status: number) {
  return (value: unknown) => value instanceof ChatBodyError && value.code === code && value.status === status && value.message === code;
}
function fragments(bytes: Uint8Array, width: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({ pull(c) {
    if (offset === bytes.length) { c.close(); return; }
    c.enqueue(bytes.subarray(offset, offset = Math.min(bytes.length, offset + width)));
  } });
}
let groups = 0;
async function test(name: string, run: () => Promise<void>) {
  await run(); groups++; console.log(`PASS ${name}`);
}
await test('byte exact binary and UTF-8 across block boundaries, no header', async () => {
  const bytes = encoder.encode(' \r\n你好\u0000'.repeat(9000));
  const stream = fragments(bytes, 113);
  assert.deepEqual(await readChatBody(request(stream), { maxBytes: bytes.length }), bytes);
  assert.equal(stream.locked, false);
});
await test('many one-byte and zero-byte fragments stay byte exact', async () => {
  const bytes = new Uint8Array(70003);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  let offset = 0, empty = false;
  const stream = new ReadableStream<Uint8Array>({ pull(c) {
    if (offset === bytes.length) { c.close(); return; }
    empty = !empty;
    c.enqueue(empty ? new Uint8Array() : bytes.subarray(offset, ++offset));
  } });
  assert.deepEqual(await readChatBody(request(stream), { maxBytes: bytes.length }), bytes);
  assert.equal(stream.locked, false);
});
await test('each tiny read uses a fresh interruption promise, not accumulating abort reactions', async () => {
  const original = Promise.race;
  const seen = new WeakSet<object>(); let races = 0;
  Promise.race = ((values: Iterable<unknown>) => {
    const entries = Array.from(values);
    assert.equal(entries.length, 2);
    const interrupt = entries[1] as object;
    assert.equal(seen.has(interrupt), false, 'shared pending abort promises retain every prior race reaction');
    seen.add(interrupt); races++;
    return original.call(Promise, entries);
  }) as typeof Promise.race;
  try {
    const bytes = new Uint8Array(2048).fill(32);
    assert.deepEqual(await readChatBody(request(fragments(bytes, 1)), { maxBytes: bytes.length }), bytes);
    assert.equal(races, bytes.length + 1);
  } finally { Promise.race = original; }
});
await test('network backing views are copied, not retained or reused', async () => {
  const backing = new Uint8Array(1024 * 1024); let count = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(c) {
    if (count === 7) { c.close(); return; }
    backing[123] = ++count; c.enqueue(backing.subarray(123, 124));
  } }, { highWaterMark: 0 });
  assert.deepEqual(await readChatBody(request(stream), { maxBytes: 7 }), new Uint8Array([1,2,3,4,5,6,7]));
});
await test('empty and bodyless requests with zero or positive limits', async () => {
  for (const maxBytes of [0, 17]) {
    assert.deepEqual(await readChatBody(request(null), { maxBytes }), new Uint8Array());
    assert.deepEqual(await readChatBody(request(new Uint8Array(), '0'), { maxBytes }), new Uint8Array());
  }
});
await test('declared length is a ceiling check, not trusted for allocation or accounting', async () => {
  for (const length of ['0', '1', '4', '0004']) {
    assert.deepEqual(await readChatBody(request(encoder.encode('test'), length), { maxBytes: 4 }), encoder.encode('test'));
  }
  assert.deepEqual(await readChatBody(request(encoder.encode('a'), '4'), { maxBytes: 4 }), encoder.encode('a'));
});
await test('invalid and oversized Content-Length cancels without reading', async () => {
  for (const length of ['', '-1', '+1', '1.5', '1e2', '1, 1', 'NaN', '5', '99999999999999999999999999999999']) {
    let pulls = 0, cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull() { pulls++; }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    await assert.rejects(() => readChatBody(request(stream, length), { maxBytes: 4 }), error('request_too_large', 413));
    assert.equal(pulls, 0); assert.equal(cancelled, true); assert.equal(stream.locked, false);
  }
});
await test('actual overflow without header or with underreported length stops and cancels', async () => {
  for (const length of [undefined, '0', '1']) {
    let pulls = 0, cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulls++; c.enqueue(new Uint8Array(3)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    await assert.rejects(() => readChatBody(request(stream, length), { maxBytes: 4 }), error('request_too_large', 413));
    assert.equal(pulls, 2); assert.equal(cancelled, true); assert.equal(stream.locked, false);
  }
});
await test('a single oversized chunk and nonempty zero limit reject', async () => {
  for (const maxBytes of [0, 4]) {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    await assert.rejects(() => readChatBody(request(stream), { maxBytes }), error('request_too_large', 413));
    assert.equal(cancelled, true); assert.equal(stream.locked, false);
  }
});
await test('deadline bounds a stalled read and a never-settling cancel', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; return new Promise(() => {}); } });
  await assert.rejects(() => readChatBody(request(stream), { maxBytes: 4, timeoutMs: 15 }), error('timeout', 504));
  assert.equal(cancelled, true); assert.equal(stream.locked, false);
});
await test('total deadline is not reset after each incoming fragment', async () => {
  let cancelled = false, pulls = 0;
  const stream = new ReadableStream<Uint8Array>({ async pull(c) {
    pulls++; await new Promise(resolve => setTimeout(resolve, 10));
    if (!cancelled) c.enqueue(new Uint8Array([32]));
  }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  await assert.rejects(() => readChatBody(request(stream), { maxBytes: 1000, timeoutMs: 35 }), error('timeout', 504));
  assert.ok(pulls >= 1 && pulls < 1000); assert.equal(cancelled, true); assert.equal(stream.locked, false);
});
await test('pre-aborted request and external signals cancel before pulling', async () => {
  for (const external of [false, true]) {
    const abort = new AbortController(); abort.abort(); let cancelled = false, pulls = 0;
    const stream = new ReadableStream<Uint8Array>({ pull() { pulls++; }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    await assert.rejects(() => readChatBody(request(stream, undefined, external ? undefined : abort.signal), { maxBytes: 4, signal: external ? abort.signal : undefined }), error('timeout', 504));
    assert.equal(pulls, 0); assert.equal(cancelled, true); assert.equal(stream.locked, false);
  }
});
await test('request and external abort signals interrupt an outstanding read', async () => {
  for (const external of [false, true]) {
    const abort = new AbortController(); let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } });
    const result = readChatBody(request(stream, undefined, external ? undefined : abort.signal), { maxBytes: 4, signal: external ? abort.signal : undefined });
    abort.abort(); await assert.rejects(() => result, error('timeout', 504));
    assert.equal(cancelled, true); assert.equal(stream.locked, false);
  }
});
await test('source read errors propagate and release the lock', async () => {
  const failure = new Error('offline stream failure');
  const stream = new ReadableStream<Uint8Array>({ pull(c) { c.error(failure); } });
  await assert.rejects(() => readChatBody(request(stream), { maxBytes: 4 }), value => value === failure);
  assert.equal(stream.locked, false);
});
await test('success clears deadline and removes abort listeners', async () => {
  const abort = new AbortController(); let added = 0, removed = 0;
  const add = abort.signal.addEventListener.bind(abort.signal), remove = abort.signal.removeEventListener.bind(abort.signal);
  abort.signal.addEventListener = ((...args: Parameters<typeof add>) => { added++; return add(...args); }) as typeof add;
  abort.signal.removeEventListener = ((...args: Parameters<typeof remove>) => { removed++; return remove(...args); }) as typeof remove;
  const stream = fragments(encoder.encode('{}'), 1);
  assert.deepEqual(await readChatBody(request(stream), { maxBytes: 4, signal: abort.signal, timeoutMs: 10 }), encoder.encode('{}'));
  assert.equal(added, 1); assert.equal(removed, 1);
  await new Promise(resolve => setTimeout(resolve, 20)); abort.abort(); assert.equal(stream.locked, false);
});
await test('invalid internal limits fail early', async () => {
  for (const maxBytes of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(() => readChatBody(request(null), { maxBytes }), RangeError);
  for (const timeoutMs of [0, -1, 1.5, Infinity]) await assert.rejects(() => readChatBody(request(null), { maxBytes: 4, timeoutMs }), RangeError);
});
console.log(`${groups} bounded body groups passed; no network or credentials.`);
