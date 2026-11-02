// Offline: node tools/test-club-shell-interactions.mjs
// Execute the real shell/events scripts in a small DOM, with deterministic timers.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const shell = await readFile(new URL('../public/club-shell.js', import.meta.url), 'utf8');
const eventsHTML = await readFile(new URL('../public/events.html', import.meta.url), 'utf8');

function harness({ route = 'events.html', reduced = false, events = false, notifications = false } = {}) {
  const timers = new Map();
  let timerId = 0;
  let language = 'zh';
  let document;
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.attributes = {};
      this.dataset = {};
      this.children = [];
      this.listeners = {};
      this.hidden = false;
      this.disabled = false;
      this.value = '';
      this._html = '';
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
        toggle: (name, on) => { (on ?? !this.classList.contains(name)) ? this.classList.add(name) : this.classList.remove(name); }
      };
    }
    get className() { return this.attributes.class || ''; }
    set className(value) { this.attributes.class = value; }
    get id() { return this.attributes.id || ''; }
    set id(value) { this.attributes.id = value; }
    get parentElement() { return this.parentNode; }
    get tabIndex() { return this.attributes.tabindex === undefined ? (/^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(this.tagName) || this.attributes.href !== undefined ? 0 : -1) : Number(this.attributes.tabindex); }
    set tabIndex(value) { this.attributes.tabindex = String(value); }
    get isConnected() { return document.contains(this); }
    setAttribute(key, value) {
      this.attributes[key] = String(value);
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
      if (key === 'hidden') this.hidden = true;
    }
    getAttribute(key) { return this.attributes[key] ?? null; }
    hasAttribute(key) { return key in this.attributes; }
    removeAttribute(key) { delete this.attributes[key]; }
    appendChild(node) { node.remove(); this.children.push(node); node.parentNode = this; return node; }
    insertBefore(node, before) {
      if (!before) return this.appendChild(node);
      node.remove(); this.children.splice(this.children.indexOf(before), 0, node); node.parentNode = this; return node;
    }
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this);
      this.parentNode = null;
    }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    addEventListener(type, fn, capture = false) { (this.listeners[type] ||= []).push({ fn, capture: capture === true }); }
    dispatchEvent(event) {
      event.target ||= this;
      event.preventDefault ||= function () { this.defaultPrevented = true; };
      event.stopPropagation ||= function () { this.stopped = true; };
      const ancestors = [];
      for (let node = this; node; node = node.parentNode) ancestors.unshift(node);
      for (const node of ancestors) for (const listener of node.listeners[event.type] || []) if (listener.capture) listener.fn(event);
      for (const node of ancestors.reverse()) {
        for (const listener of node.listeners[event.type] || []) if (!listener.capture) listener.fn(event);
        if (event.stopped || event.bubbles === false) break;
      }
      return !event.defaultPrevented;
    }
    focus() {
      if (!this.isConnected || this.disabled || this.closest('[hidden], [inert]')) return;
      document.activeElement = this;
      this.dispatchEvent({ type: 'focusin' });
    }
    blur() { document.activeElement = document.body; }
    click() { if (!this.disabled) this.dispatchEvent({ type: 'click' }); }
    setSelectionRange() {}
    scrollIntoView(options) { this.lastScroll = options; }
    getClientRects() { return this.closest('[hidden]') ? [] : [{}]; }
    closest(selector) { for (let node = this; node; node = node.parentNode) if (matches(node, selector)) return node; return null; }
    querySelectorAll(selector) {
      const result = [];
      const visit = node => { for (const child of node.children) { if (matches(child, selector)) result.push(child); visit(child); } };
      visit(this);
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    set innerHTML(html) {
      for (const child of this.children) child.parentNode = null;
      this.children = [];
      this._html = html;
      const stack = [this];
      for (const token of html.matchAll(/<\/?[a-z][^>]*>/gi)) {
        if (token[0].startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
        const [, tag, attrs] = /^<([a-z][\w-]*)([\s\S]*?)\/?\s*>$/i.exec(token[0]);
        const child = new Node(tag);
        for (const attr of attrs.matchAll(/([\w:-]+)(?:="([^"]*)"|'([^']*)'|=([^\s>]+))?/g)) child.setAttribute(attr[1], attr[2] ?? attr[3] ?? attr[4] ?? '');
        stack.at(-1).appendChild(child);
        if (!/^(input|meta|link|br|hr|img|path|circle)$/i.test(tag)) stack.push(child);
      }
    }
    get innerHTML() { return this._html; }
  }
  function matches(node, selectors) {
    return selectors.split(',').some(selector => {
      const parts = selector.trim().split(/\s+(?![^\[]*\])/);
      const simple = parts.pop();
      if (!simple || simple.startsWith(':') || simple.includes(':not')) return false;
      const tag = /^[a-z][\w-]*/i.exec(simple)?.[0];
      if (tag && node.tagName !== tag.toUpperCase()) return false;
      for (const [, cls] of simple.matchAll(/\.([\w-]+)/g)) if (!node.classList.contains(cls)) return false;
      const id = /#([\w-]+)/.exec(simple)?.[1];
      if (id && node.id !== id) return false;
      for (const [, key, value] of simple.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (key === 'hidden' ? !node.hidden : !node.hasAttribute(key)) return false;
        if (value !== undefined && node.getAttribute(key) !== value) return false;
      }
      if (!parts.length) return true;
      for (let parent = node.parentNode; parent; parent = parent.parentNode) if (matches(parent, parts.join(' '))) return true;
      return false;
    });
  }
  document = new Node('document');
  document.documentElement = document.appendChild(new Node('html'));
  document.head = document.documentElement.appendChild(new Node('head'));
  document.body = document.documentElement.appendChild(new Node('body'));
  document.activeElement = document.body;
  document.readyState = 'loading';
  document.createElement = tag => new Node(tag);
  document.getElementById = id => document.querySelector('#' + id);
  const location = { pathname: '/public/' + route, href: 'https://club.test/public/' + route, protocol: 'https:' };
  const storage = new Map([['algorithm-club-launcher-recents', '["page:guide.html"]']]);
  const window = new Node('window');
  Object.assign(window, {
    document, location, matchMedia: () => ({ matches: reduced }),
    ClubI18n: { getLang: () => language, t: key => key },
    scrollTo: options => { window.lastScroll = options; }
  });
  const context = vm.createContext({
    window, document, location, navigator: {}, console, URL,
    CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { return 1; },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    fetch: () => new Promise(() => {}),
    CSS: { escape: value => value },
    ClubCommon: {},
    ClubI18n: window.ClubI18n
  });
  if (events) {
    const bodyMarkup = eventsHTML.match(/<body\b[^>]*>([\s\S]*?)<script>/i);
    assert.ok(bodyMarkup, 'events page body fixture must be present');
    document.body.innerHTML = bodyMarkup[1];
    window.supabase = { createClient: () => ({ auth: { onAuthStateChange() {}, getSession: () => new Promise(() => {}) } }) };
    vm.runInContext(eventsHTML.match(/<script>([\s\S]*?)<\/script>/)[1], context, { filename: 'events.html' });
  }
  if (notifications) {
    const bar = document.body.appendChild(new Node('header'));
    bar.className = 'topbar';
    window.ClubStaffAccess = { isLoggedIn: () => true, getSession: () => new Promise(() => {}) };
  }
  const trigger = document.body.appendChild(new Node('button'));
  trigger.className = 'club-launcher-button';
  const outside = document.body.appendChild(new Node('button'));
  outside.setAttribute('data-injected-helper', '');
  vm.runInContext(shell, context, { filename: 'club-shell.js' });
  context.ClubShell = window.ClubShell;
  document.dispatchEvent({ type: 'DOMContentLoaded' });
  const key = (node, key, extra = {}) => { const event = { type: 'keydown', key, ...extra }; node.dispatchEvent(event); return event; };
  return {
    document, window, trigger, outside, context, key, storage, timers,
    run: code => vm.runInContext(code, context),
    runTimers() { for (const [id, timer] of [...timers]) { if (!timers.has(id)) continue; timers.delete(id); timer.fn(); } },
    language(value) { language = value; window.dispatchEvent({ type: 'club:langchange' }); }
  };
}

for (const [surface, routes] of Object.entries({
  read: ['guide', 'changelog', 'resources', 'appmonitor', 'join', 'donations'],
  operate: ['member-center', 'member-profile', 'member-checkin', 'member-points', 'member-messages', 'admin-hub', 'members-admin', 'events-admin', 'mall-admin', 'join-admin', 'drive-admin', 'chat-admin', 'drive', 'events', 'notifications', 'search', 'points-mall', 'password-reset', 'chat', 'assistant'],
  explore: ['club-features', 'visualization-lab', 'search-lab', 'sorting-lab', 'dp-lab', 'ds-lab', 'graph-lab', 'heap-lab', 'tree-lab', 'gomoku-satori-lab', 'gomoku', 'gomoku-experiments', 'tetris', 'snake', 'platformer']
})) {
  for (const route of routes) assert.equal(harness({ route: route + '.html' }).document.body.dataset.clubSurface, surface, route);
}
for (const route of ['index.html', 'future-lab.html', 'unknown-admin.html']) assert.equal(harness({ route }).document.body.dataset.clubSurface, undefined, 'unregistered routes keep their own mode');

for (const reduced of [false, true]) {
  const ui = harness({ reduced });
  const { document, window, trigger, outside, key } = ui;
  trigger.focus();
  window.ClubShell.openLauncher();
  const layer = document.querySelector('.club-launcher');
  const input = layer.querySelector('input');
  const clear = layer.querySelector('[data-launcher-clear]');
  assert.equal(document.activeElement, input, 'open focuses search synchronously');
  assert.equal(layer.hasAttribute('inert'), false);
  assert.equal(outside.closest('[inert]'), null, 'injected helpers are never made inert');
  assert.equal(key(input, 'Tab').defaultPrevented, undefined, 'Tab can reach the clear action');
  assert.equal(key(input, 'Tab', { shiftKey: true }).defaultPrevented, true);
  assert.equal(document.activeElement, clear, 'Shift+Tab wraps to last control');
  assert.equal(key(clear, 'Tab').defaultPrevented, true);
  assert.equal(document.activeElement, input, 'Tab wraps to search');
  clear.disabled = true;
  assert.equal(key(input, 'Tab').defaultPrevented, true, 'disabled controls are excluded from modal Tab order');
  clear.disabled = false;
  outside.focus();
  assert.equal(document.activeElement, input, 'modal recaptures escaped focus');
  key(input, 'ArrowDown');
  const active = input.getAttribute('aria-activedescendant');
  key(input, 'Enter', { ctrlKey: true });
  assert.ok(JSON.parse(ui.storage.get('algorithm-club-launcher-favorites')).length, 'favorite shortcut still writes local state');
  assert.ok(input.getAttribute('aria-activedescendant'));
  assert.ok(active);
  const guestLabels = layer.querySelectorAll('[role="option"]').map(node => node.getAttribute('aria-label')).join(' ');
  assert.doesNotMatch(guestLabels, /管理|Admin|admin/, 'guest launcher never exposes privileged tools');
  clear.focus();
  ui.language('en');
  assert.equal(document.activeElement, input, 'language rerender repairs removed control focus');
  assert.match(input.placeholder, /Search modules/);
  assert.equal(layer.getAttribute('aria-label'), 'Jump to a club module');
  window.ClubShell.openLauncher();
  key(input, 'Escape');
  assert.equal(document.activeElement, trigger, 'repeated opens retain original trigger');
  assert.equal(layer.getAttribute('aria-hidden'), 'true');
  assert.equal(layer.hasAttribute('inert'), true, 'closing contents cannot receive Tab during exit');
  window.ClubShell.closeLauncher();
  window.ClubShell.openLauncher();
  ui.runTimers();
  assert.equal(layer.classList.contains('is-open'), true, 'old close timer cannot hide reopened dialog');
  assert.equal(document.activeElement, input, 'old timer cannot steal focus');
  window.ClubShell.closeLauncher();
  outside.focus();
  ui.runTimers();
  assert.equal(document.activeElement, outside, 'completed close never steals newer focus');
  assert.equal(key(outside, 'Tab').defaultPrevented, undefined, 'closed modal does not trap Tab');
  trigger.focus();
  window.ClubShell.openLauncher();
  trigger.remove();
  outside.className = 'club-launcher-button';
  window.ClubShell.closeLauncher();
  assert.equal(document.activeElement, outside, 'disconnected trigger falls back to a connected launcher button');
}

// Notification popover remains non-modal: normal outside focus/Tab, no body inert.
{
  const ui = harness({ notifications: true });
  const button = ui.document.querySelector('[data-club-notify-button]');
  button.click();
  const panel = ui.document.querySelector('.club-notify-panel');
  assert.equal(panel.classList.contains('is-open'), true);
  assert.equal(panel.getAttribute('aria-modal'), null);
  ui.outside.focus();
  assert.equal(ui.document.activeElement, ui.outside);
  assert.equal(ui.key(ui.outside, 'Tab').defaultPrevented, undefined);
  ui.key(ui.outside, 'Escape');
  assert.equal(panel.classList.contains('is-open'), false);
  button.click();
  ui.runTimers();
  assert.equal(panel.classList.contains('is-open'), true, 'notification reopen cancels its exit timer');
}

// No matching results: search is the only tab stop, and the combobox remains usable.
{
  const ui = harness();
  ui.window.ClubShell.openLauncher();
  const input = ui.document.querySelector('.club-launcher input');
  input.value = 'no such module 945237';
  input.dispatchEvent({ type: 'input' });
  assert.equal(input.getAttribute('aria-activedescendant'), null);
  assert.equal(ui.key(input, 'Tab').defaultPrevented, true);
  assert.equal(ui.document.activeElement, input);
  ui.key(input, 'ArrowDown');
  ui.key(input, 'Escape');
  assert.equal(ui.document.querySelector('.club-launcher').classList.contains('is-open'), false);
}

// Real events rendering + shared tab activation, including data arriving in calendar view.
for (const reduced of [false, true]) {
  const ui = harness({ events: true, reduced });
  const { document, key } = ui;
  const tabs = document.querySelector('.events-view-toggle');
  const [listTab, calendarTab] = tabs.querySelectorAll('[role="tab"]');
  const list = document.getElementById('eventList');
  const calendar = document.getElementById('eventCalendar');
  let changes = 0;
  tabs.addEventListener('club:tabchange', () => { changes += 1; });
  ui.window.ClubShell.setupTabs(document);
  assert.equal(changes, 0, 'setup is idempotent');
  listTab.focus();
  key(listTab, 'ArrowRight');
  assert.equal(changes, 1, 'one arrow causes one tab change');
  assert.equal(document.activeElement, calendarTab);
  assert.equal(calendarTab.tabIndex, 0);
  assert.equal(listTab.tabIndex, -1);
  assert.equal(list.hidden, true);
  assert.equal(calendar.hidden, false);
  assert.equal(calendarTab.classList.contains('is-active'), true);
  ui.run('renderEvents([{id:"arrival", title:"Fresh event", starts_at:"2026-11-02T12:00:00Z", allow_signup:true}])');
  const link = calendar.querySelector('[data-event-target]');
  assert.ok(link, 'data arriving while calendar is selected renders there');
  link.focus();
  link.click();
  const card = list.querySelector('[data-event-id="arrival"]');
  assert.ok(card, 'calendar selection renders the current list');
  assert.equal(list.hidden, false);
  assert.equal(calendar.hidden, true);
  assert.equal(listTab.getAttribute('aria-selected'), 'true');
  assert.equal(listTab.tabIndex, 0);
  assert.equal(document.activeElement, card, 'calendar link transfers focus out of the hidden panel');
  assert.equal(card.lastScroll.behavior, reduced ? 'auto' : 'smooth');
  const name = card.querySelector('input[name="memberName"]');
  name.value = 'Unsubmitted name';
  key(listTab, 'End');
  key(calendarTab, 'Home');
  assert.equal(list.querySelector('[data-event-id="arrival"]'), card, 'switching without new data preserves cards and form input');
  assert.equal(card.querySelector('input[name="memberName"]').value, 'Unsubmitted name');
  key(listTab, 'End');
  assert.equal(calendarTab.getAttribute('aria-selected'), 'true');
  key(calendarTab, 'Home');
  assert.equal(listTab.getAttribute('aria-selected'), 'true');
  key(listTab, 'ArrowLeft');
  assert.equal(document.activeElement, calendarTab, 'left arrow wraps');
  const previousChanges = changes;
  calendarTab.click();
  assert.equal(changes, previousChanges, 'active-tab click does not rerender');
  ui.run('renderEvents([{id:"replacement", title:"Latest event", starts_at:"2026-11-03T12:00:00Z", allow_signup:false}])');
  key(calendarTab, 'Home');
  assert.equal(list.querySelector('[data-event-id="arrival"]'), null, 'new data received in calendar invalidates the old list');
  assert.ok(list.querySelector('[data-event-id="replacement"]'));
}

console.log('Shell interactions passed: explicit routes, modal Tab/focus lifecycle and races, favorites/i18n, shared event tabs, late data, reduced motion.');
