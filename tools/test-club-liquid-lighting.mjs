// Offline deterministic lifecycle coverage against the real standalone controller.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/club-liquid-lighting.js', import.meta.url), 'utf8');

function harness({ fine = true, reduced = false, transparent = false, legacy = false, missing = false, brokenObserver = false, loading = false } = {}) {
  let document;
  let scans = 0;
  let requests = 0;
  let nextFrame = 0;
  const frames = new Map();
  const observers = [];
  class Events {
    listeners = new Map();
    addEventListener(type, fn, options) {
      const entries = this.listeners.get(type) || [];
      if (!entries.some(entry => entry.fn === fn)) entries.push({ fn, options });
      this.listeners.set(type, entries);
    }
    removeEventListener(type, fn) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.fn !== fn));
    }
    emit(type, event = {}) {
      event.type = type;
      event.preventDefault ||= () => { event.defaultPrevented = true; };
      for (const entry of [...(this.listeners.get(type) || [])]) {
        entry.fn(event);
        if (entry.options?.once) this.removeEventListener(type, entry.fn);
      }
      return event;
    }
    count(type) { return (this.listeners.get(type) || []).length; }
  }
  class Element extends Events {
    constructor(tag = 'div', classes = '') {
      super();
      this.nodeType = 1;
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.parentElement = null;
      this.attributes = new Map();
      const names = new Set(classes.split(/\s+/).filter(Boolean));
      this.classList = {
        contains: name => names.has(name),
        add: name => names.add(name),
        remove: name => names.delete(name)
      };
      this.props = new Map();
      this.style = { setProperty: (name, value) => this.props.set(name, value) };
      this.reads = 0;
      this.rect = { left: 20, top: 30, width: 200, height: 100 };
    }
    append(node) {
      node.remove();
      this.children.push(node);
      node.parentElement = this;
      return node;
    }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
    }
    get isConnected() {
      let root = this;
      while (root.parentElement) root = root.parentElement;
      return root === document;
    }
    get disabled() { return this.attributes.has('disabled'); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value = '') { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    matches(selectors) {
      return selectors.split(',').some(selector => {
        const child = selector.trim().match(/^(.*?)\s*>\s*([^>]+)$/);
        if (child) return this.matches(child[2]) && Boolean(this.parentElement?.matches(child[1]));
        const parts = selector.trim().split(/\s+/);
        const simple = parts.pop();
        const tag = /^[a-z][\w-]*/i.exec(simple)?.[0];
        if (tag && tag.toUpperCase() !== this.tagName) return false;
        const id = /#([\w-]+)/.exec(simple)?.[1];
        if (id && this.getAttribute('id') !== id) return false;
        for (const [, name] of simple.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(name)) return false;
        for (const [, key, value] of simple.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
          if (!this.attributes.has(key) || (value !== undefined && this.getAttribute(key) !== value)) return false;
        }
        return !parts.length || Boolean(this.parentElement?.closest(parts.join(' ')));
      });
    }
    closest(selectors) {
      for (let node = this; node; node = node.parentElement) if (node.matches(selectors)) return node;
      return null;
    }
    querySelectorAll(selectors) {
      scans += 1;
      const result = [];
      function visit(node) {
        for (const child of node.children) {
          if (child.matches(selectors)) result.push(child);
          visit(child);
        }
      }
      visit(this);
      return result;
    }
    getBoundingClientRect() { this.reads += 1; return this.rect; }
  }
  document = new Element('document');
  document.body = document.append(new Element('body'));
  document.visibilityState = 'visible';
  document.readyState = loading ? 'loading' : 'complete';
  const card = document.body.append(new Element('article', 'card'));
  const label = card.append(new Element('span'));
  const button = card.append(new Element('button', 'btn'));
  const icon = button.append(new Element('svg'));
  const nested = card.append(new Element('section', 'resource-card'));
  const second = document.body.append(new Element('article', 'premium-entry'));
  const heading = document.body.append(new Element('h2', 'section-heading'));
  const board = document.body.append(new Element('div', 'board'));
  const boardButton = board.append(new Element('button', 'btn'));
  const contextual = document.body.append(new Element('button', 'game-reset'));
  const authGate = document.body.append(new Element('section', 'club-auth-gate'));
  const auth = authGate.append(new Element('div', 'club-auth-shell'));
  const window = new Events();
  const media = [fine, reduced, transparent].map(matches => {
    const item = new Events();
    item.matches = matches;
    if (legacy) {
      item.addListener = fn => Events.prototype.addEventListener.call(item, 'change', fn);
      item.addEventListener = undefined;
    }
    return item;
  });
  Object.assign(window, {
    PointerEvent: missing ? undefined : function PointerEvent() {},
    matchMedia: missing ? undefined : query => media[query.includes('pointer: fine') ? 0 : query.includes('reduced-motion') ? 1 : 2],
    requestAnimationFrame: missing ? undefined : fn => { requests += 1; frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: missing ? undefined : id => frames.delete(id),
    MutationObserver: missing ? undefined : class {
      constructor(callback) { if (brokenObserver) throw new Error('blocked observer'); this.callback = callback; observers.push(this); }
      observe(target, options) { this.target = target; this.options = options; this.connected = true; }
      disconnect() { this.connected = false; }
    }
  });
  const context = vm.createContext({ window, document, console });
  const run = () => vm.runInContext(source, context, { filename: 'club-liquid-lighting.js' });
  run();
  return {
    window, document, card, label, button, icon, nested, second, heading, boardButton, contextual, authGate, auth, media, observers, frames, run,
    node: (tag, classes, parent = document.body) => parent.append(new Element(tag, classes)),
    pointer: (type, target, extra = {}) => document.emit(type, { target, clientX: 60, clientY: 80, pointerType: 'mouse', ...extra }),
    mutate(records) { for (const observer of observers.filter(item => item.connected)) observer.callback(records); },
    flush() { const work = [...frames.values()]; frames.clear(); work.forEach(fn => fn()); },
    get scans() { return scans; },
    get requests() { return requests; }
  };
}
const marked = (node, type = 'surface') => node.classList.contains('club-liquid-' + type);
const active = node => node.props.get('--club-pointer-active');

{
  const ui = harness();
  assert.ok(marked(ui.card));
  assert.ok(marked(ui.second));
  assert.ok(marked(ui.auth));
  assert.ok(marked(ui.button, 'control'));
  assert.equal(marked(ui.authGate), false, 'outer auth gate remains plain');
  assert.equal(marked(ui.nested), false, 'nested eligible panels do not stack glass');
  assert.equal(marked(ui.heading), false);
  assert.equal(marked(ui.contextual, 'control'), false, 'contextual game buttons are not broadened to all buttons');
  assert.equal(marked(ui.boardButton, 'control'), false);
  assert.equal(ui.requests, 0, 'boot and idle schedule no animation work');
  assert.equal(ui.observers.filter(item => item.connected).length, 1);
  assert.equal(ui.document.count('pointermove'), 1);
  assert.equal(ui.button.count('pointermove'), 0, 'listeners are delegated, never per target');
  assert.equal(ui.document.listeners.get('pointermove')[0].options.passive, true);
  const scanCount = ui.scans;
  ui.pointer('pointerover', ui.label);
  for (let i = 0; i < 25; i += 1) ui.pointer('pointermove', ui.label, { clientX: 90 + i, clientY: 90 });
  assert.equal(ui.frames.size, 1, 'a burst has only one pending frame');
  assert.equal(ui.requests, 1);
  assert.equal(ui.card.reads, 0, 'layout waits until the coalesced render');
  ui.flush();
  assert.equal(ui.card.reads, 1, 'one bounding rect per render');
  assert.equal(ui.card.props.get('--club-pointer-x'), '94px');
  assert.equal(ui.card.props.get('--club-pointer-y'), '60px');
  assert.equal(active(ui.card), '1');
  assert.equal(ui.frames.size, 0, 'render never queues an idle successor');
  assert.equal(ui.scans, scanCount, 'pointer events do no document-wide scans');
  ui.pointer('pointerout', ui.label, { relatedTarget: ui.nested });
  assert.equal(active(ui.card), '1', 'moving between descendants preserves the same surface');
  ui.pointer('pointerover', ui.icon);
  assert.equal(active(ui.card), '0', 'control wins over its parent surface');
  ui.flush();
  assert.equal(active(ui.button), '1', 'SVG button icons still resolve to their control');
  ui.pointer('pointerout', ui.icon, { relatedTarget: ui.second });
  assert.equal(active(ui.button), '0');
  ui.pointer('pointermove', ui.second, { clientX: 500, clientY: -100 });
  ui.flush();
  assert.equal(ui.second.props.get('--club-pointer-x'), '200px');
  assert.equal(ui.second.props.get('--club-pointer-y'), '0px');
  ui.pointer('pointermove', ui.second, { pointerType: 'touch' });
  assert.equal(active(ui.second), '0', 'hybrid-device touch never tracks');
  ui.pointer('pointermove', ui.card, { clientX: NaN });
  assert.equal(ui.frames.size, 0);
  ui.pointer('pointermove', ui.card);
  ui.pointer('pointercancel', ui.card);
  assert.equal(ui.frames.size, 0, 'cancel clears pending work');
  assert.equal(ui.document.count('click'), 0, 'no interception of business clicks');
  assert.equal(ui.pointer('click', ui.button).defaultPrevented, undefined);
  ui.run();
  ui.window.ClubLiquidLighting.start();
  assert.equal(ui.document.count('pointermove'), 1, 'duplicate script and start remain idempotent');
  assert.equal(ui.window.count('pageshow'), 1);
  assert.equal(ui.media[0].count('change'), 1);
}

{
  const ui = harness();
  const wrapper = ui.node('div', 'resource-card');
  const child = ui.node('div', 'card', wrapper);
  const dynamicButton = ui.node('button', 'primary-action', child);
  ui.mutate([{ type: 'childList', addedNodes: [wrapper] }]);
  assert.ok(marked(wrapper));
  assert.equal(marked(child), false);
  assert.ok(marked(dynamicButton, 'control'));
  ui.pointer('pointermove', dynamicButton);
  ui.flush();
  assert.equal(active(dynamicButton), '1', 'late content inherits delegated behavior');
  dynamicButton.remove();
  ui.mutate([{ type: 'childList', addedNodes: [], removedNodes: [dynamicButton] }]);
  assert.equal(active(dynamicButton), '0', 'removal clears a formerly active control');
  const outer = ui.node('div', 'card');
  outer.append(wrapper);
  ui.mutate([{ type: 'childList', addedNodes: [outer] }]);
  assert.ok(marked(outer));
  assert.equal(marked(wrapper), false, 'reparenting a marked subtree removes nested glass');
  outer.classList.remove('card');
  ui.mutate([{ type: 'attributes', target: outer }]);
  assert.equal(marked(outer), false);
  assert.ok(marked(wrapper), 'changing eligibility repairs descendants');
  ui.pointer('pointermove', wrapper);
  wrapper.setAttribute('hidden');
  ui.mutate([{ type: 'attributes', target: wrapper }]);
  assert.equal(ui.frames.size, 0, 'hidden target cancels queued work');
  wrapper.removeAttribute('hidden');
  ui.pointer('pointermove', wrapper);
  ui.flush();
  ui.window.emit('blur');
  assert.equal(active(wrapper), '0');
  ui.button.setAttribute('disabled');
  ui.pointer('pointermove', ui.button);
  assert.equal(ui.frames.size, 0);
  ui.button.removeAttribute('disabled');
  ui.button.setAttribute('aria-disabled', 'true');
  ui.pointer('pointermove', ui.button);
  assert.equal(ui.frames.size, 0);
  const zero = ui.node('div', 'card');
  zero.rect.width = 0;
  ui.mutate([{ type: 'childList', addedNodes: [zero] }]);
  ui.pointer('pointermove', zero);
  ui.flush();
  assert.notEqual(active(zero), '1', 'zero-size targets never retain active light');
}

{
  const ui = harness();
  ui.document.body.classList.add('club-page');
  const panel = ui.node('section', 'panel');
  const panelChild = ui.node('div', 'panel', panel);
  const action = ui.node('a', 'button', panel);
  const chip = ui.node('span', 'chip', panel);
  const chipButton = ui.node('button', 'chip', panel);
  const share = ui.node('button', 'share-action', panel);
  const header = ui.node('header', 'panel premium-head');
  const headerCard = ui.node('section', 'panel', header);
  const gate = ui.node('section', 'panel auth-view');
  const gateInner = ui.node('div', 'club-auth-shell', gate);
  const form = ui.node('form', 'panel');
  const release = ui.node('article', 'card release-card');
  const releaseAction = ui.node('button', 'button', release);
  const table = ui.node('table', 'card');
  const dataCard = ui.node('div', 'card', table);
  ui.mutate([{ type: 'attributes', target: ui.document.body }]);
  assert.ok(marked(panel));
  assert.equal(marked(panelChild), false);
  assert.ok(marked(action, 'control'));
  assert.ok(marked(chipButton, 'control'));
  assert.ok(marked(share, 'control'));
  assert.equal(marked(chip, 'control'), false, 'display chips remain plain');
  assert.equal(marked(header), false, 'section heading is not a glass candidate');
  assert.ok(marked(headerCard), 'plain headings do not block actual nested panel surfaces');
  assert.equal(marked(gate), false);
  assert.ok(marked(gateInner), 'outer auth view never swallows inner auth shell');
  assert.equal(marked(form), false);
  assert.equal(marked(release), false, 'existing appmonitor release lighting is excluded');
  assert.equal(marked(releaseAction, 'control'), false);
  assert.equal(marked(table), false);
  assert.equal(marked(dataCard), false);
  ui.pointer('pointermove', panel);
  ui.flush();
  assert.equal(active(panel), '1');
  assert.equal(active(action), '0', 'nested control owns inactive value instead of inheriting its parent glow');
  ui.document.body.classList.add('chat-page');
  const sidebar = ui.node('aside', 'chat-sidebar');
  const suggestion = ui.node('button', 'chat-suggestion');
  const composer = ui.node('div', 'chat-composer-box');
  const send = ui.node('button', 'chat-send-button', composer);
  const assistant = ui.node('div', '');
  assistant.setAttribute('id', 'club-assistant');
  const assistantHead = ui.node('div', 'club-assistant-head', assistant);
  const assistantBall = ui.node('button', 'club-assistant-ball', assistant);
  ui.mutate([{ type: 'attributes', target: ui.document.body }]);
  for (const node of [sidebar, suggestion, composer, assistantHead]) assert.ok(marked(node), 'island surface marked');
  for (const node of [send, assistantBall]) assert.ok(marked(node, 'control'), 'island control marked');
  assert.equal(sidebar.count('pointermove'), 0);
  ui.document.body.classList.add('legacy-premium');
  const legacyPanel = ui.node('section', 'panel');
  const legacyControls = ui.node('div', 'controls');
  const legacyButton = ui.node('button', '', legacyControls);
  ui.mutate([{ type: 'attributes', target: ui.document.body }]);
  assert.ok(marked(legacyPanel));
  assert.ok(marked(legacyButton, 'control'));
}

{
  const ui = harness();
  ui.document.body.classList.add('chat-admin-page');
  const adminSurfaces = ['chat-admin-header', 'chat-admin-tabs', 'chat-admin-status-card', 'chat-admin-stat', 'chat-admin-gate'].map(name => ui.node('section', name));
  const adminButton = ui.node('button', 'chat-admin-button');
  const tabButton = ui.node('button', '', adminSurfaces[1]);
  const shell = ui.node('main', 'shell');
  const header = ui.node('header', '', shell);
  const headerLink = ui.node('a', '', header);
  const gameSurfaces = ['auth-gate', 'password-panel', 'pk-panel', 'leaderboard-panel', 'game-admin-panel', 'touch-controls', 'game-announcement-card'].map(name => ui.node('section', name, shell));
  const gameButton = ui.node('button', 'button', gameSurfaces[0]);
  const section = ui.node('section', '', shell);
  const nestedHeader = ui.node('header', '', section);
  const gameBoard = ui.node('div', 'board card', shell);
  const boardButton = ui.node('button', 'button', gameBoard);
  ui.document.body.classList.add('chat-page');
  const picker = ui.node('div', 'chat-model-picker');
  const menu = ui.node('div', 'chat-model-menu card', picker);
  const option = ui.node('button', 'btn', menu);
  const assistant = ui.node('div', 'card');
  assistant.setAttribute('id', 'club-assistant');
  const assistantPanel = ui.node('section', 'club-assistant-panel card', assistant);
  const assistantHead = ui.node('header', 'club-assistant-head', assistantPanel);
  const assistantFrame = ui.node('iframe', 'club-assistant-frame card', assistantPanel);
  ui.mutate([{ type: 'attributes', target: ui.document.body }]);
  for (const node of [...adminSurfaces, header, ...gameSurfaces, assistantHead]) assert.ok(marked(node), 'exact admin/platformer/island surface marked');
  for (const node of [adminButton, tabButton, headerLink, gameButton, picker]) assert.ok(marked(node, 'control'));
  for (const node of [nestedHeader, gameBoard, menu, assistant, assistantPanel, assistantFrame]) assert.equal(marked(node), false, 'excluded container or non-direct game header remains plain');
  for (const node of [boardButton, option]) assert.equal(marked(node, 'control'), false);
  ui.pointer('pointermove', option);
  assert.equal(ui.frames.size, 0, 'model menu does not light its parent picker');
  ui.pointer('pointermove', assistantHead);
  ui.flush();
  assert.equal(active(assistantHead), '1', 'excluding assistant panel still permits its header');
}

{
  const ui = harness();
  const layer = ui.node('div', 'club-common-dialog-layer');
  const dialog = ui.node('section', 'club-common-dialog', layer);
  const actions = ui.node('div', 'club-common-dialog-actions', dialog);
  const confirm = ui.node('button', '', actions);
  const undo = ui.node('div', 'club-common-undo');
  const undoButton = ui.node('button', '', undo);
  const toast = ui.node('div', 'club-common-toast');
  const shareLayer = ui.node('div', 'club-share-layer');
  const shareCard = ui.node('div', 'club-share-card', shareLayer);
  const shareOption = ui.node('button', 'club-share-option', shareCard);
  const shareCancel = ui.node('button', 'club-share-cancel', shareCard);
  const shareToast = ui.node('div', 'club-share-toast');
  const pill = ui.node('div', '');
  pill.setAttribute('id', 'club-service-live-pill');
  const overlay = ui.node('div', '');
  overlay.setAttribute('id', 'club-service-overlay');
  const serviceCard = ui.node('div', 'service-modal-box', overlay);
  const tools = ui.node('div', 'service-tools', serviceCard);
  const serviceButton = ui.node('button', '', tools);
  const serviceLink = ui.node('a', '', tools);
  const serviceClose = ui.node('button', 'service-close', serviceCard);
  const report = ui.node('section', 'club-service-report');
  const session = ui.node('div', 'club-common-session');
  const unrelatedClose = ui.node('button', 'service-close');
  ui.document.body.classList.add('premium-error');
  const errorActions = ui.node('div', 'actions');
  const errorControl = ui.node('span', 'button', errorActions);
  ui.mutate([{ type: 'childList', addedNodes: [layer, undo, toast, shareLayer, shareToast, pill, overlay, report, session, errorActions] }]);
  for (const node of [dialog, undo, toast, shareCard, shareToast, pill, serviceCard]) assert.ok(marked(node), 'late runtime surface marked');
  for (const node of [confirm, undoButton, shareOption, shareCancel, serviceButton, serviceLink, serviceClose, errorControl]) assert.ok(marked(node, 'control'), 'late runtime action marked');
  for (const node of [layer, shareLayer, overlay, report, session]) assert.equal(marked(node), false, 'scrim/report/session banner stays plain');
  assert.equal(marked(unrelatedClose, 'control'), false, 'service controls stay scoped to overlay');
  ui.pointer('pointermove', shareOption);
  ui.flush();
  assert.equal(active(shareOption), '1');
  assert.equal(ui.document.count('click'), 0);
}

{
  const ui = harness();
  ui.pointer('pointermove', ui.card);
  ui.document.visibilityState = 'hidden';
  ui.document.emit('visibilitychange');
  assert.equal(ui.frames.size, 0);
  assert.equal(ui.document.count('pointermove'), 0);
  assert.equal(ui.observers.filter(item => item.connected).length, 0);
  ui.document.visibilityState = 'visible';
  ui.document.emit('visibilitychange');
  ui.pointer('pointermove', ui.card);
  ui.flush();
  assert.equal(active(ui.card), '1');
  ui.window.emit('pagehide');
  assert.equal(active(ui.card), '0');
  assert.equal(ui.document.count('pointermove'), 0);
  ui.media[1].emit('change');
  assert.equal(ui.document.count('pointermove'), 0, 'media events do not restart a suspended page');
  ui.window.emit('pageshow', { persisted: true });
  ui.window.emit('pageshow', { persisted: true });
  assert.equal(ui.document.count('pointermove'), 1, 'bfcache restores one set of listeners');
  assert.equal(ui.observers.filter(item => item.connected).length, 1);
  assert.equal(ui.frames.size, 0, 'restoring never starts an idle frame');
  for (const [index, off] of [[0, false], [1, true], [2, true]]) {
    ui.pointer('pointermove', ui.card);
    ui.flush();
    ui.media[index].matches = off;
    ui.media[index].emit('change');
    assert.equal(active(ui.card), '0');
    assert.equal(ui.document.count('pointermove'), 0, 'live media preference stops tracking');
    ui.media[index].matches = !off;
    ui.media[index].emit('change');
    assert.equal(ui.document.count('pointermove'), 1);
  }
}

for (const options of [{ fine: false }, { reduced: true }, { transparent: true }, { missing: true }]) {
  const ui = harness(options);
  assert.ok(marked(ui.card), 'static material markers survive enhancement opt-out');
  assert.ok(marked(ui.button, 'control'));
  assert.equal(ui.document.count('pointermove'), 0);
  ui.pointer('pointermove', ui.card);
  assert.equal(ui.requests, 0, 'no-capability/reduced/coarse mode has no tracking or RAF');
}
{
  const ui = harness({ legacy: true });
  ui.media[2].matches = true;
  ui.media[2].emit('change');
  assert.equal(ui.document.count('pointermove'), 0, 'legacy MediaQueryList listeners work');
}
{
  const ui = harness({ brokenObserver: true });
  assert.ok(marked(ui.card));
  ui.pointer('pointermove', ui.card);
  ui.flush();
  assert.equal(active(ui.card), '1', 'observer failure preserves existing content');
}
{
  const ui = harness({ loading: true });
  assert.equal(marked(ui.card), false);
  ui.run();
  ui.document.emit('DOMContentLoaded');
  assert.ok(marked(ui.card));
  assert.equal(ui.document.count('pointermove'), 1, 'deferred duplicate loads still boot once');
}

console.log('PASS liquid lighting: real standalone boot, explicit markers, delegated/coalesced local reads, idle zero RAF, dynamic/reparented content, cancellation, hidden/pagehide/bfcache, media changes, reduced/coarse and missing-capability fallback; business clicks untouched.');
