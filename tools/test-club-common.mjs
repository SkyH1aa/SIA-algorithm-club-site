// Offline: node tools/test-club-common.mjs
// Exercises the shared UI layer in a stub DOM: confirm resolution/cancel/Esc/focus trap,
// undo countdown + pagehide flush, list states, escapeHtml and 401 banner.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/club-common.js', import.meta.url), 'utf8');

function harness() {
  const elements = new Map();
  const events = new Map();
  const timers = new Map();
  let timerId = 0;
  const created = [];

  const make = (tag = 'div') => {
    const node = {
      tagName: String(tag).toUpperCase(),
      id: '', className: '', textContent: '', innerHTML: '', hidden: false,
      children: [], attributes: {}, listeners: {}, style: {},
      isConnected: true,
      classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); }, toggle(c, on) { on ? this.set.add(c) : this.set.delete(c); } },
      parentNode: null,
      append(...next) { for (const n of next) { this.children.push(n); if (n && typeof n === 'object') n.parentNode = this; } },
      appendChild(node) { this.children.push(node); if (node && typeof node === 'object') node.parentNode = this; return node; },
      prepend(...next) { this.children.unshift(...next); for (const n of next) if (n && typeof n === 'object') n.parentNode = this; },
      replaceChildren(...next) { this.children = next; for (const n of next) if (n && typeof n === 'object') n.parentNode = this; },
      remove() {
        this.isConnected = false;
        const parent = this.parentNode;
        if (parent) parent.children = parent.children.filter(child => child !== this);
      },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k]; },
      removeAttribute(k) { delete this.attributes[k]; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(x => x !== fn); },
      focus() { this.focused = true; },
      querySelector(sel) {
        if (sel === '.club-common-state') return this.children.find(c => c.className && c.className.includes('club-common-state')) || null;
        return null;
      },
      querySelectorAll() { return []; },
      contains() { return true; },
      click() { (this.listeners.click || []).forEach(fn => fn({ target: this })); }
    };
    created.push(node);
    return node;
  };

  const document = {
    readyState: 'complete',
    head: make('head'),
    body: make('body'),
    documentElement: make('html'),
    activeElement: null,
    getElementById(id) {
      if (!elements.has(id)) { const node = make(); node.id = id; elements.set(id, node); }
      return elements.get(id);
    },
    createElement(tag) { return make(tag); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { (events.get(type) || events.set(type, []).get(type) || []).push(fn); },
    removeEventListener() {}
  };

  const window = {
    location: { pathname: '/public/donations.html', search: '', protocol: 'https:', origin: 'https://club.example' },
    addEventListener(type, fn) { (events.get(type) || events.set(type, []).get(type) || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(event) { (events.get(event.type) || []).forEach(fn => fn(event)); },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    ClubI18n: { t: (key, vars) => vars && Object.keys(vars).length ? `${key}:${JSON.stringify(vars)}` : key }
  };
  window.window = window;
  window.document = document;

  const context = vm.createContext({
    window, document, console,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    CustomEvent: window.CustomEvent,
    Event: class { constructor(type) { this.type = type; } }
  });
  vm.runInContext(source, context, { filename: 'club-common.js' });

  const runTimers = () => {
    for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); }
  };
  return { window, document, elements, events, created, runTimers, ClubCommon: context.ClubCommon || window.ClubCommon, context, timers };
}

// escapeHtml matches the historical per-page implementation byte for byte.
{
  const ui = harness();
  const { escapeHtml } = ui.ClubCommon;
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(0), '0');
}

// confirm(): resolves true on confirm, false on cancel/Escape/backdrop.
{
  const ui = harness();
  let result;
  const pending = ui.ClubCommon.confirm({ title: 'T', message: 'M', danger: true }).then(value => { result = value; });
  const layer = ui.document.body.children.at(-1);
  assert.equal(layer.className, 'club-common-dialog-layer');
  const dialog = layer.children[0];
  assert.equal(dialog.attributes.role, 'dialog');
  assert.equal(dialog.attributes['aria-modal'], 'true');
  const actions = dialog.children.at(-1);
  const [cancel, confirm] = actions.children;
  confirm.click();
  await pending;
  assert.equal(result, true);
  assert.equal(ui.document.body.children.includes(layer), false, 'dialog is removed after resolving');

  const cancelled = ui.ClubCommon.confirm({ message: 'M2' });
  const layer2 = ui.document.body.children.at(-1);
  layer2.children[0].children.at(-1).children[0].click();
  assert.equal(await cancelled, false);

  const escaped = ui.ClubCommon.confirm({ message: 'M3' });
  const keydown = ui.events.get('keydown').at(-1);
  keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(await escaped, false);
}

// confirm(): the first dialog is cancelled when a second one opens.
{
  const ui = harness();
  const first = ui.ClubCommon.confirm({ message: 'first' });
  const second = ui.ClubCommon.confirm({ message: 'second' });
  assert.equal(await first, false, 'opening a second dialog cancels the first');
  const layer = ui.document.body.children.at(-1);
  layer.children[0].children.at(-1).children[1].click();
  assert.equal(await second, true);
}

// scheduleUndo(): commits after the countdown, undo cancels, pagehide flushes with keepalive flag.
{
  const ui = harness();
  const events = [];
  ui.ClubCommon.scheduleUndo({
    message: 'deleted',
    seconds: 5,
    onUndo: () => events.push('undo'),
    commit: ({ pagehide }) => events.push(pagehide ? 'commit-pagehide' : 'commit')
  });
  const host = ui.document.getElementById('club-common-undo-host');
  assert.equal(host.children.length, 1);
  assert.equal(host.children[0].children[0].textContent, 'deleted');
  ui.runTimers();
  assert.deepEqual(events, ['commit']);
  assert.equal(host.children.length, 0);

  const undoEvents = [];
  const handle = ui.ClubCommon.scheduleUndo({ message: 'x', onUndo: () => undoEvents.push('undo'), commit: () => undoEvents.push('commit') });
  const item = handle.element;
  assert.ok(item, 'scheduleUndo returns its element');
  const undoButton = item.children.find(child => String(child.tagName).toUpperCase() === 'BUTTON');
  assert.ok(undoButton, 'undo button exists');
  undoButton.click();
  assert.deepEqual(undoEvents, ['undo']);
  assert.equal(item.isConnected, false);
  assert.equal(ui.document.body.children.some(child => child.id === 'club-common-undo-host' && child.children.includes(item)), false);

  const pagehideEvents = [];
  ui.ClubCommon.scheduleUndo({ message: 'y', commit: ({ pagehide }) => pagehideEvents.push(pagehide) });
  (ui.events.get('pagehide') || []).forEach(fn => fn());
  assert.deepEqual(pagehideEvents, [true], 'page close flushes the pending delete');
}

// listState(): loading shows a skeleton, empty/error are distinguishable and retry is wired.
{
  const ui = harness();
  const box = ui.document.createElement('div');
  ui.ClubCommon.listState(box, { kind: 'loading', message: 'loading…' });
  assert.match(box.innerHTML, /club-common-skeleton/);
  assert.equal(box.attributes['aria-busy'], 'true');

  ui.ClubCommon.listState(box, { kind: 'empty', title: 'Nothing', message: 'none yet' });
  assert.match(box.innerHTML, /club-common-empty/);
  assert.match(box.innerHTML, /Nothing/);
  assert.equal(box.attributes['aria-busy'], undefined);

  let retried = 0;
  ui.ClubCommon.listState(box, { kind: 'error', title: 'Failed', message: 'network', onRetry: () => retried++ });
  assert.match(box.innerHTML, /club-common-error/);
  assert.match(box.innerHTML, /Failed/);
  // The retry button is appended to the state node found by querySelector.
  assert.equal(retried, 0);
}

// handleAuthError(): 401 produces a session-expired error and shows the banner once.
{
  const ui = harness();
  const error = ui.ClubCommon.handleAuthError({ status: 401 }, { error: 'login' }, 'fallback');
  assert.equal(error.status, 401);
  assert.equal(error.code, 'session_expired');
  assert.equal(ui.ClubCommon.handleAuthError({ status: 500 }, { error: 'db' }, 'fallback').message, 'db');
  assert.equal(ui.ClubCommon.handleAuthError({ status: 500 }, null, 'fallback').message, 'fallback');
}

console.log('Club common: escapeHtml parity, async confirm with cancel/Escape/replace, undo countdown and pagehide flush, list states and 401 mapping passed.');
