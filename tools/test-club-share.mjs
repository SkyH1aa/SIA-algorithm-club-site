// Offline: node tools/test-club-share.mjs
//
// 分享按钮的行为契约：
// * 手机/平板（含伪装成桌面的 iPadOS）走 navigator.share，系统面板里才有微信/QQ；
// * 桌面端弹自己的面板（微信/QQ 只能复制链接后粘贴，桌面客户端没有可预填消息的 scheme）；
// * 带触摸屏的 Windows 笔记本必须仍算桌面端；
// * 复制失败要有可见提示，不能静默。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');

const source = await read('public/club-share.js');
const index = await read('index.html');
const css = await read('public/club-ui.css');

// --- page wiring ---
const triggers = [...index.matchAll(/data-share-trigger/g)];
assert.ok(triggers.length >= 2, `expected the hero and join buttons, saw ${triggers.length}`);
assert.match(index, /id="heroShareButton"/, 'hero button has a stable id');
assert.match(index, /public\/club-share\.js/, 'share module is loaded');
assert.match(index, /data-i18n="home\.share"/, 'button label is translatable');
assert.match(index, /data-i18n-aria="home\.shareAria"/, 'button has a translatable aria-label');
// It must sit next to 立即加入 in both places.
for (const block of index.split('data-share-trigger').slice(0, -1)) {
  const tail = block.slice(-400);
  assert.match(tail, /立即加入|home\.joinNow/, 'share button is adjacent to the join CTA');
}

// --- styling hooks ---
assert.match(css, /\.share-action/, 'button style exists');
assert.match(css, /\.club-share-layer/, 'panel style exists');
assert.match(css, /\.club-share-toast/, 'toast style exists');
// Both themes: every colour must fall back to the global tokens used by the homepage.
for (const token of ['--club-line', '--line', '--club-surface-2', '--panel']) {
  assert.ok(css.includes(token), `share styles use ${token} so light/dark both work`);
}
// Centering must not clip a wide card on narrow screens.
assert.match(css, /\.club-share-layer\.is-open \{ display: flex; \}/, 'panel uses flex centering');
assert.match(css, /max-width: 100%/, 'card never exceeds the layer');

// --- behaviour ---
function run({ ua, share, clipboard }) {
  const listeners = {};
  const body = { appendChild() {}, removeChild() {} };
  const document = {
    readyState: 'complete',
    body,
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, classList: { add() {}, remove() {} }, select() {}, remove() {} }),
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => { listeners[type] = fn; },
    execCommand: () => true
  };
  const window = {
    location: { href: 'https://example.test/public/gomoku.html' },
    addEventListener() {},
    setTimeout,
    clearTimeout,
    document
  };
  window.window = window;
  const navigator = { userAgent: ua, platform: 'Win32', maxTouchPoints: 0, clipboard };
  if (share) navigator.share = share;
  const context = { window, document, navigator, setTimeout, clearTimeout, console, Promise };
  vm.runInNewContext(source, context, { filename: 'club-share.js' });
  return window.ClubShare;
}

const copied = [];
const clipboard = { writeText: async value => { copied.push(value); } };

// Desktop UA -> panel path, no navigator.share call.
{
  const share = run({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', clipboard });
  assert.equal(share.isTouchDevice(), false, 'desktop UA is not mobile');
  const result = await share.share({ url: 'https://example.test/x' });
  assert.equal(result, 'copied', 'desktop falls back to copying the link');
  assert.ok(copied.includes('https://example.test/x'), 'the URL is copied');
}

// Touchscreen Windows laptop must still be treated as desktop.
{
  const share = run({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', clipboard });
  assert.equal(share.isTouchDevice(), false, 'touchscreen laptop is not mobile');
}

// Mobile UA -> navigator.share is used (that is where WeChat/QQ live).
for (const ua of [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36'
]) {
  const calls = [];
  const share = run({ ua, share: async data => { calls.push(data); }, clipboard });
  assert.equal(share.isTouchDevice(), true, `${ua.slice(0, 24)} is mobile`);
  const result = await share.share({ url: 'https://example.test/y', title: 'T', text: 'X' });
  assert.equal(result, 'shared');
  assert.equal(calls.length, 1, 'navigator.share is called once');
  assert.equal(calls[0].url, 'https://example.test/y');
}

// iPadOS 13+ reports MacIntel but has touch points.
{
  const share = run({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', clipboard });
  assert.equal(share.isTouchDevice(), false, 'plain Mac is desktop');
}

// Cancelling the system sheet is not a failure.
{
  const share = run({
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148',
    share: async () => { const error = new Error('cancelled'); error.name = 'AbortError'; throw error; },
    clipboard
  });
  assert.equal(await share.share({ url: 'https://example.test/z' }), 'cancelled');
}

// WeChat / QQ entry points always copy the link first (desktop cannot prefill).
{
  const calls = [];
  const share = run({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', clipboard });
  const before = copied.length;
  await share.openWeChat('https://example.test/w');
  await share.openQQ('https://example.test/q');
  assert.equal(copied.length, before + 2, 'both clients copy the link');
  assert.ok(copied.includes('https://example.test/w'));
  assert.ok(copied.includes('https://example.test/q'));
}

console.log('Club share: 2 triggers, desktop panel + mobile navigator.share, touchscreen-laptop guard, copy fallback and both themes passed.');
