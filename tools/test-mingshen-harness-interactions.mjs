// Run real Harness interactions with production club-shell.setupTabs in a deterministic DOM.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/mingshen-harness-interactions.js', import.meta.url), 'utf8');
const shell = await readFile(new URL('../public/club-shell.js', import.meta.url), 'utf8');
const stylesheet = await readFile(new URL('../public/mingshen-harness.css', import.meta.url), 'utf8');
const anchorRule = stylesheet.match(/:is\(#collaboration, #craft, #models, #download\)\s*\{[^}]*scroll-margin-top:\s*([\d.]+)px/);
assert.ok(anchorRule, 'actual chapter CSS must declare a native anchor margin');
const authoredAnchorOffset = Number(anchorRule[1]);

function harness(options = {}) {
  const frames = new Map();
  const intersections = [];
  const resizes = [];
  let nextFrame = 0;
  let requests = 0;
  let queries = 0;
  let document;
  class Events {
    listeners = new Map();
    addEventListener(type, fn, config) {
      const listeners = this.listeners.get(type) || [];
      if (!listeners.some(item => item.fn === fn)) listeners.push({ fn, config });
      this.listeners.set(type, listeners);
    }
    removeEventListener(type, fn) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.fn !== fn));
    }
    dispatchEvent(event) {
      event.target ||= this;
      event.preventDefault ||= function () { this.defaultPrevented = true; };
      for (const item of [...(this.listeners.get(event.type) || [])]) {
        item.fn(event);
        if (item.config?.once) this.removeEventListener(event.type, item.fn);
      }
      if (event.bubbles && this.parentElement) this.parentElement.dispatchEvent(event);
      return !event.defaultPrevented;
    }
    emit(type, extra = {}) { const event = { type, ...extra }; this.dispatchEvent(event); return event; }
    count(type) { return (this.listeners.get(type) || []).length; }
  }
  function matches(node, selectors) {
    return selectors.split(',').some(selector => {
      const simple = selector.trim();
      const tag = /^[a-z][\w-]*/i.exec(simple)?.[0];
      if (tag && node.tagName !== tag.toUpperCase()) return false;
      for (const [, cls] of simple.matchAll(/\.([\w-]+)/g)) if (!node.classList.contains(cls)) return false;
      for (const [, key, value] of simple.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (!node.hasAttribute(key) || (value !== undefined && node.getAttribute(key) !== value)) return false;
      }
      return true;
    });
  }
  class Element extends Events {
    attributes = new Map();
    children = [];
    parentElement = null;
    hidden = false;
    props = new Map();
    reads = 0;
    clientLeft = 1;
    clientTop = 1;
    scrollLeft = 0;
    scrollTop = 0;
    rect = { left: 100, top: 100, width: 600, height: 60 };
    constructor(tag = 'div', attributes = {}) {
      super();
      this.tagName = tag.toUpperCase();
      Object.entries(attributes).forEach(([key, value]) => this.setAttribute(key, value));
      this.dataset = new Proxy({}, {
        get: (_, key) => this.getAttribute('data-' + key.replace(/[A-Z]/g, char => '-' + char.toLowerCase())) ?? undefined,
        set: (_, key, value) => { this.setAttribute('data-' + key.replace(/[A-Z]/g, char => '-' + char.toLowerCase()), value); return true; }
      });
      this.classList = { contains: name => (this.getAttribute('class') || '').split(/\s+/).includes(name) };
      this.style = { setProperty: (name, value) => this.props.set(name, value) };
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return name === 'hidden' ? this.hidden : this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    append(node) { this.children.push(node); node.parentElement = this; return node; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (matches(node, selector)) return node; return null; }
    querySelectorAll(selector) {
      queries += 1;
      const result = [];
      const walk = node => node.children.forEach(child => { if (matches(child, selector)) result.push(child); walk(child); });
      walk(this);
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getClientRects() { return this.closest('[hidden]') || this.noLayout ? [] : [this.rect]; }
    getBoundingClientRect() {
      this.reads += 1;
      if (this.closest('[hidden]')) throw new Error('Must not measure hidden geometry');
      if (options.brokenGeometry) throw new Error('Geometry unavailable');
      return this.rect;
    }
    focus() { document.activeElement = this; }
    click() { return this.emit('click', { bubbles: true }); }
  }
  document = new Element('document');
  document.documentElement = document.append(new Element('html'));
  document.documentElement.scrollHeight = 6000;
  document.documentElement.scrollTop = 0;
  const body = document.documentElement.append(new Element('body', { class: options.otherPage ? 'other-page' : 'harness-page' }));
  document.body = options.noBody ? null : body;
  document.activeElement = body;
  document.getElementById = id => {
    const find = node => node.getAttribute('id') === id ? node : node.children.map(find).find(Boolean);
    return find(document) || null;
  };
  const topbar = body.append(new Element('header', { class: 'topbar' }));
  topbar.rect.height = 62;
  const nav = body.append(new Element('nav', { 'data-harness-chapters': '' }));
  nav.rect.height = 48;
  const progress = nav.append(new Element('span', { 'data-harness-progress': '', 'aria-hidden': 'true' }));
  const chapters = ['collaboration', 'craft', 'models', 'download'].map((id, index) => {
    const link = nav.append(new Element('a', { href: '#' + id }));
    const section = body.append(new Element('section', { id }));
    section.rect = { top: 1000 + index * 1000, left: 40, width: 1000, height: 800 };
    return { link, section };
  });
  const outsideLink = nav.append(new Element('a', { href: 'https://example.test/' }));
  const groups = [
    { name: 'views', states: ['overview', 'projects', 'input'] },
    { name: 'flow', states: ['plan', 'work', 'review'] },
    { name: 'code', states: ['context', 'diff', 'restore'] },
    { name: 'docs', states: ['read', 'compose', 'export'] }
  ].map(({ name, states }) => {
    const explorer = body.append(new Element('div', name === 'views' ? {} : {
      'data-harness-explorer': name, 'data-harness-active': states[0]
    }));
    const list = explorer.append(new Element('div', { role: 'tablist', 'data-club-tabs': '', 'data-harness-tabs': '' }));
    const indicator = options.noIndicator ? null : list.append(new Element('span', { class: 'harness-tab-indicator', 'aria-hidden': 'true' }));
    const panels = [];
    const buttons = states.map((state, index) => {
      const id = name + state;
      const button = list.append(new Element('button', {
        role: 'tab', 'aria-selected': index === 0 ? 'true' : 'false', 'aria-controls': id, 'data-tab-target': id
      }));
      button.rect = { left: 105 + index * 120, top: 105, width: 110, height: 44 };
      const panel = explorer.append(new Element('div', { id, 'data-harness-state': state }));
      panel.hidden = index !== 0;
      panels.push(panel);
      return button;
    });
    return { name, states, explorer, list, indicator, buttons, panels };
  });
  const window = new Events();
  Object.assign(window, {
    innerHeight: 900, scrollY: 0,
    getComputedStyle: options.noComputedStyle ? undefined : node => {
      if (options.brokenComputedStyle) throw new Error('computed style unavailable');
      return { scrollMarginTop: `${options.anchorOffset || 0}px` };
    },
    requestAnimationFrame: options.noRAF ? undefined : fn => {
      requests += 1;
      if (options.brokenRAF) throw new Error('RAF unavailable');
      frames.set(++nextFrame, fn); return nextFrame;
    },
    cancelAnimationFrame: options.noCancelRAF ? undefined : id => frames.delete(id),
    IntersectionObserver: options.noIO ? undefined : class {
      targets = new Set();
      disconnected = false;
      constructor(callback, config) {
        if (options.brokenIO) throw new Error('IO unavailable');
        this.callback = callback; this.config = config; intersections.push(this);
      }
      observe(node) { if (options.brokenObserve) throw new Error('observe unavailable'); this.targets.add(node); }
      disconnect() { this.disconnected = true; this.targets.clear(); }
    },
    ResizeObserver: options.noRO ? undefined : class {
      targets = new Set();
      disconnected = false;
      constructor(callback) {
        if (options.brokenRO) throw new Error('RO unavailable');
        this.callback = callback; resizes.push(this);
      }
      observe(node) { if (options.brokenObserve) throw new Error('observe unavailable'); this.targets.add(node); }
      disconnect() { this.disconnected = true; this.targets.clear(); }
    }
  });
  const forbidden = name => () => { throw new Error(`Interactions must not use ${name}`); };
  const context = vm.createContext({ window, document, console,
    CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    setTimeout: forbidden('timers'), setInterval: forbidden('intervals'), fetch: forbidden('network'),
    MutationObserver: forbidden('generic DOM observers')
  });
  for (const name of ['location', 'localStorage', 'sessionStorage', 'fetch', 'matchMedia']) {
    Object.defineProperty(window, name, { get: forbidden(name) });
  }
  document.fonts = options.noFonts ? null : new Events();
  // Load the complete shell, then invoke its public production tab setup without
  // booting unrelated launcher/network/chrome features in this focused fixture.
  document.readyState = 'loading';
  vm.runInContext(shell, context, { filename: 'club-shell.js', timeout: 1000 });
  window.ClubShell.setupTabs(document);
  document.readyState = options.loading ? 'loading' : 'complete';
  // Keep only the Harness boot listener when testing DOMContentLoaded timing.
  document.listeners.delete('DOMContentLoaded');
  if (options.noHooks) {
    groups.forEach(group => group.list.removeAttribute('data-harness-tabs'));
    nav.removeAttribute('data-harness-chapters');
  }
  document.hidden = Boolean(options.hidden);
  document.visibilityState = options.hidden ? 'hidden' : 'visible';
  const shellState = () => JSON.stringify(groups.map(group => ({
    selected: group.buttons.map(button => [button.getAttribute('aria-selected'), button.tabIndex]),
    panels: group.panels.map(panel => panel.hidden)
  })));
  const before = shellState();
  vm.runInContext(source, context, { filename: 'mingshen-harness-interactions.js', timeout: 1000 });
  return {
    window, document, body, nav, progress, topbar, chapters, groups, outsideLink, frames, intersections, resizes,
    get requests() { return requests; }, get queries() { return queries; },
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
    scroll(y) {
      const delta = window.scrollY - y;
      chapters.forEach(chapter => { chapter.section.rect.top += delta; });
      window.scrollY = y; window.emit('scroll');
    },
    visible(value) { document.hidden = !value; document.visibilityState = value ? 'visible' : 'hidden'; document.emit('visibilitychange'); },
    unchanged() { assert.equal(shellState(), before, 'enhancement must not mutate shell tab state'); },
    activeIO: () => intersections.findLast(item => !item.disconnected),
    activeRO: () => resizes.findLast(item => !item.disconnected)
  };
}
function fraction(ui) {
  const value = Number(ui.nav.props.get('--harness-progress'));
  assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  assert.equal(ui.progress.props.get('--harness-progress'), ui.nav.props.get('--harness-progress'));
  return value;
}
function current(ui, index) {
  ui.chapters.forEach((chapter, position) => assert.equal(chapter.link.getAttribute('aria-current'), position === index ? 'location' : null));
}

const ui = harness();
assert.equal(ui.frames.size, 1, 'initial layout is deferred and batched');
assert.equal(ui.window.count('scroll'), 1);
assert.equal(ui.window.listeners.get('scroll')[0].config.passive, true);
assert.equal(ui.body.count('click'), 0);
assert.equal(ui.body.count('keydown'), 0);
ui.unchanged();
ui.flush();
current(ui, 0);
assert.equal(fraction(ui), 0);
assert.equal(ui.frames.size, 0, 'no idle work');
for (const group of ui.groups) {
  assert.equal(group.list.getAttribute('data-harness-indicator-ready'), 'true');
  assert.equal(group.list.props.get('--harness-tab-x'), '4.00px');
  assert.equal(group.list.props.get('--harness-tab-y'), '4.00px');
  assert.equal(group.list.props.get('--harness-tab-width'), '110.00px');
  assert.equal(group.list.props.get('--harness-tab-height'), '44.00px');
  assert.equal(group.buttons[1].reads, 0, 'unselected tab geometry is never sampled');
}
const flow = ui.groups[1];
const code = ui.groups[2];
const docs = ui.groups[3];
flow.buttons[1].click();
assert.equal(flow.explorer.dataset.harnessActive, 'work', 'production shell click publishes visual state synchronously');
assert.equal(flow.panels[1].hidden, false);
assert.equal(flow.buttons[1].getAttribute('aria-selected'), 'true');
assert.equal(ui.document.activeElement, ui.body, 'pointer click does not steal keyboard focus');
for (let index = 0; index < 25; index += 1) flow.buttons[index % 3].click();
assert.equal(ui.frames.size, 1, 'rapid selection batches underline measurement');
flow.buttons[2].click();
code.buttons[1].click();
ui.flush();
assert.equal(flow.list.props.get('--harness-tab-x'), '244.00px');
assert.equal(flow.explorer.dataset.harnessActive, 'review');
assert.equal(code.explorer.dataset.harnessActive, 'diff');
assert.equal(docs.explorer.dataset.harnessActive, 'read');
const key = docs.buttons[0].emit('keydown', { key: 'End', bubbles: true });
assert.equal(key.defaultPrevented, true);
assert.equal(ui.document.activeElement, docs.buttons[2]);
assert.equal(docs.explorer.dataset.harnessActive, 'export', 'production shell End key activates the final panel');
ui.flush();
const reads = docs.buttons[2].reads;
docs.buttons[2].rect.width = 145;
ui.window.emit('club:langchange');
ui.window.emit('resize');
ui.document.fonts.emit('loadingdone');
ui.activeRO().callback([]);
assert.equal(ui.frames.size, 1);
ui.flush();
assert.equal(docs.buttons[2].reads, reads + 1);
assert.equal(docs.list.props.get('--harness-tab-width'), '145.00px');
flow.explorer.hidden = true;
const hiddenReads = flow.list.reads;
ui.window.emit('resize'); ui.flush();
assert.equal(flow.list.reads, hiddenReads, 'hidden tablists are never measured');
assert.equal(flow.list.getAttribute('data-harness-indicator-ready'), null);
flow.explorer.hidden = false;
flow.list.scrollLeft = 20;
flow.list.scrollTop = 5;
ui.window.emit('resize'); ui.flush();
assert.equal(flow.list.props.get('--harness-tab-x'), '264.00px');
assert.equal(flow.list.props.get('--harness-tab-y'), '9.00px');
flow.buttons[2].rect.width = 0;
ui.window.emit('resize'); ui.flush();
assert.equal(flow.list.getAttribute('data-harness-indicator-ready'), null, 'invalid layout falls back to selected-button styling');
flow.buttons[2].rect.width = 110;
ui.window.emit('resize'); ui.flush();
assert.equal(flow.list.getAttribute('data-harness-indicator-ready'), 'true');

const idleQueries = ui.queries;
const oldReads = ui.chapters[0].section.reads;
for (let index = 0; index < 100; index += 1) ui.scroll(2200);
assert.equal(ui.frames.size, 1);
assert.equal(ui.chapters[0].section.reads, oldReads, 'scroll handlers do not read layout');
ui.flush();
current(ui, 1);
assert.ok(fraction(ui) > 0 && fraction(ui) < 1);
assert.equal(ui.queries, idleQueries, 'reading progress never rescans the DOM');
assert.equal(ui.frames.size, 0);
ui.scroll(-1000); ui.flush(); current(ui, 0); assert.equal(fraction(ui), 0);
ui.scroll(10000); ui.flush(); current(ui, 3); assert.equal(fraction(ui), 1);
ui.scroll(5100); ui.flush(); current(ui, 3); assert.equal(fraction(ui), 1);
ui.scroll(3000); ui.flush(); current(ui, 2);
// Header+chapter dimensions establish the threshold (62 + 48 = 110), not a fixed desktop offset.
ui.scroll(1891); ui.flush(); current(ui, 1);
ui.scroll(1888); ui.flush(); current(ui, 0);
ui.topbar.hidden = true;
ui.window.emit('resize'); ui.flush(); current(ui, 1); // fallback is 150px
ui.topbar.hidden = false;
const anchorEvent = ui.chapters[2].link.click();
assert.equal(anchorEvent.defaultPrevented, undefined, 'chapter anchors retain native navigation');
assert.equal(ui.chapters[2].link.getAttribute('href'), '#models');
assert.equal(ui.outsideLink.getAttribute('aria-current'), null);
ui.activeIO().callback([{ target: ui.chapters[2].section, isIntersecting: true }]);
assert.equal(ui.frames.size, 1);
ui.flush();

// Lifecycle cancellation rejects stale IO/RO/RAF callbacks and restores one listener.
ui.scroll(2400);
const staleFrame = [...ui.frames.values()][0];
const staleIO = ui.activeIO();
const staleRO = ui.activeRO();
ui.window.emit('pagehide');
assert.equal(ui.frames.size, 0);
assert.equal(ui.window.count('scroll'), 0);
staleFrame(); staleIO.callback([]); staleRO.callback([]);
assert.equal(ui.frames.size, 0);
ui.visible(true);
assert.equal(ui.window.count('scroll'), 0, 'visibility cannot undo pagehide suspension');
ui.window.emit('pageshow', { persisted: true });
assert.equal(ui.window.count('scroll'), 1);
assert.equal(ui.frames.size, 1);
ui.flush();
ui.window.emit('pageshow', { persisted: true });
assert.equal(ui.window.count('scroll'), 1);
assert.equal(ui.frames.size, 0);
ui.visible(false);
assert.equal(ui.window.count('scroll'), 0);
ui.window.emit('resize'); ui.window.emit('club:langchange');
assert.equal(ui.frames.size, 0);
ui.visible(true); ui.flush();
assert.equal(ui.window.count('scroll'), 1);
ui.window.emit('hashchange'); ui.flush();
assert.equal(ui.frames.size, 0);

for (const options of [{ noRAF: true }, { noCancelRAF: true }, { brokenRAF: true }, { noIO: true }, { brokenIO: true },
  { noRO: true }, { brokenRO: true }, { brokenObserve: true }, { noFonts: true }, { noIndicator: true },
  { noComputedStyle: true }, { brokenComputedStyle: true }]) {
  const fallback = harness(options);
  fallback.flush();
  fallback.groups[1].buttons[2].click();
  fallback.scroll(3000);
  fallback.flush();
  assert.equal(fallback.groups[1].explorer.dataset.harnessActive, 'review');
  current(fallback, 2);
  fraction(fallback);
  fallback.window.emit('pagehide');
  assert.equal(fallback.frames.size, 0);
  fallback.window.emit('pageshow'); fallback.flush();
  assert.equal(fallback.frames.size, 0);
}
const invalid = harness({ brokenGeometry: true });
invalid.flush();
assert.equal(invalid.groups[0].list.getAttribute('data-harness-indicator-ready'), null);
invalid.groups[3].buttons[1].click(); invalid.flush();
assert.equal(invalid.groups[3].explorer.dataset.harnessActive, 'compose');
assert.equal(fraction(invalid), 0);
const malformed = harness(); malformed.flush();
const initial = malformed.groups[1].explorer.dataset.harnessActive;
malformed.body.emit('club:tabchange', { detail: { target: 'flowreview' } });
malformed.body.emit('club:tabchange', { detail: { target: {} } });
malformed.body.emit('club:tabchange');
assert.equal(malformed.groups[1].explorer.dataset.harnessActive, initial, 'ignore hidden/nonselected/malformed target events');
assert.equal(malformed.frames.size, 0);
for (const options of [{ otherPage: true }, { noBody: true }]) {
  const untouched = harness(options);
  assert.equal(untouched.requests, 0);
  assert.equal(untouched.window.count('scroll'), 0);
  assert.equal(untouched.window.count('pagehide'), 0);
}
const hidden = harness({ hidden: true });
assert.equal(hidden.requests, 0);
hidden.visible(true); hidden.flush(); current(hidden, 0);
const loading = harness({ loading: true });
assert.equal(loading.requests, 0);
loading.document.emit('DOMContentLoaded'); loading.flush();
const bootRequests = loading.requests;
loading.document.emit('DOMContentLoaded');
assert.equal(loading.requests, bootRequests, 'boot runs once');
const short = harness();
short.chapters.forEach((chapter, index) => { chapter.section.rect.top = index * 20; chapter.section.rect.height = 20; });
short.document.documentElement.scrollHeight = 900;
short.flush();
assert.equal(fraction(short), 1, 'short content never divides by zero');
// Regress native anchor landing using the CURRENT production CSS margin, not a
// duplicated 146px fixture. Browser rounding of a fractional scroll is tolerated.
const anchored = harness({ anchorOffset: authoredAnchorOffset });
anchored.flush();
for (let index = 0; index < anchored.chapters.length; index += 1) {
  const event = anchored.chapters[index].link.click();
  assert.equal(event.defaultPrevented, undefined);
  anchored.scroll(1000 + index * 1000 - authoredAnchorOffset);
  anchored.window.emit('hashchange');
  anchored.flush();
  assert.equal(anchored.chapters[index].section.rect.top, authoredAnchorOffset);
  current(anchored, index);
  fraction(anchored);
}
anchored.scroll(3000 - authoredAnchorOffset - 0.5); anchored.flush(); current(anchored, 2);
assert.equal(anchored.frames.size, 0);
const empty = harness({ noHooks: true });
empty.flush();
assert.equal(empty.window.count('scroll'), 0);
assert.equal(empty.frames.size, 0);
console.log('PASS harness interactions: production shell click/keyboard ownership, all explorers, rapid underline layout, hidden/invalid geometry, resize/lang/font, chapter thresholds/bounds/native anchors, passive batched scroll, no idle work, lifecycle/stale callbacks and missing APIs.');
