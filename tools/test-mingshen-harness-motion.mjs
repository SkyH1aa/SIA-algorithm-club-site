// Offline lifecycle coverage against the complete, real product-motion IIFE.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/mingshen-harness-motion.js', import.meta.url), 'utf8');

function harness(options = {}) {
  class Events {
    listeners = new Map();
    addEventListener(type, fn, config) {
      const entries = this.listeners.get(type) || [];
      if (!entries.some(entry => entry.fn === fn)) entries.push({ fn, config });
      this.listeners.set(type, entries);
    }
    removeEventListener(type, fn) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.fn !== fn));
    }
    emit(type, detail = {}) {
      const event = { type, ...detail };
      for (const entry of [...(this.listeners.get(type) || [])]) {
        entry.fn(event);
        if (entry.config?.once) this.removeEventListener(type, entry.fn);
      }
      return event;
    }
    count(type) { return (this.listeners.get(type) || []).length; }
  }

  const animations = [];
  const observers = [];
  const frames = new Map();
  let requests = 0;
  let cancellations = 0;
  let nextFrame = 0;
  let finishedReads = 0;
  let geometries = 0;
  let queries = 0;
  let document;

  class Element extends Events {
    children = [];
    parentElement = null;
    attributes = new Map();
    props = new Map();
    writes = [];
    hidden = false;
    reads = 0;
    rect = { top: 400, height: 600 };
    constructor(classes = '', id = '') {
      super();
      const names = new Set(classes.split(/\s+/).filter(Boolean));
      this.classList = { contains: name => names.has(name) };
      if (id) this.attributes.set('id', id);
      this.style = { setProperty: (name, value) => {
        this.props.set(name, value);
        this.writes.push({ name, value });
      } };
      if (options.noWAAPI) this.animate = undefined;
    }
    append(child) { child.parentElement = this; this.children.push(child); return child; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selector) {
      if (selector[0] === '.') return this.classList.contains(selector.slice(1));
      if (selector[0] === '[') return this.attributes.has(selector.slice(1, -1));
      return selector === 'path' && this.tagName === 'path';
    }
    querySelectorAll(selector) {
      queries += 1;
      const parts = selector.split(/\s+/);
      const simple = parts.pop();
      const nodes = [];
      const visit = node => {
        for (const child of node.children) {
          if (child.matches(simple)) {
            let ancestor = child.parentElement;
            while (ancestor && parts.length && !ancestor.matches(parts[0])) ancestor = ancestor.parentElement;
            if (!parts.length || ancestor) nodes.push(child);
          }
          visit(child);
        }
      };
      visit(this);
      return nodes;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
      return null;
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    getBoundingClientRect() { this.reads += 1; return this.rect; }
    getTotalLength() {
      geometries += 1;
      if (options.brokenGeometry) throw new Error('SVG geometry unavailable');
      return 240;
    }
    animate(keyframes, config) {
      if (options.brokenWAAPI) throw new Error('WAAPI unavailable');
      const animation = {
        node: this, keyframes, config, cancelled: false, complete: false,
        cancel() {
          if (options.brokenCancel) throw new Error('cancel unavailable');
          this.cancelled = true;
          this.oncancel?.();
        },
        finish() {
          if (this.cancelled || this.complete) return;
          this.complete = true;
          this.onfinish?.();
        },
        get finished() { finishedReads += 1; throw new Error('Do not consume cancellation-prone finished promises'); }
      };
      animations.push(animation);
      return animation;
    }
  }

  const window = new Events();
  document = new Element();
  document.readyState = options.loading ? 'loading' : 'complete';
  document.visibilityState = options.hidden ? 'hidden' : 'visible';
  document.hidden = Boolean(options.hidden);
  const body = document.append(new Element(options.otherPage ? 'other-page' : 'harness-page'));
  document.body = options.noBody ? null : body;
  document.getElementById = id => {
    const find = node => node.getAttribute('id') === id ? node : node.children.map(find).find(Boolean);
    return find(document) || null;
  };

  const words = [body.append(new Element('harness-hero-word')), body.append(new Element('harness-hero-word'))];
  const copy = body.append(new Element('harness-hero-copy'));
  const track = body.append(new Element('harness-hero-track'));
  track.attributes.set('aria-hidden', 'true');
  const heroPath = track.append(new Element());
  heroPath.tagName = 'path';
  if (options.normalizedHero) heroPath.attributes.set('pathLength', '1');
  const stage = body.append(new Element());
  stage.attributes.set('data-harness-stage', '');
  const screen = stage.append(new Element());
  screen.attributes.set('data-harness-screen', '');
  const flow = body.append(new Element());
  flow.attributes.set('data-harness-flow', '');
  const line = flow.append(new Element('harness-flow-line'));
  const paths = [line.append(new Element()), line.append(new Element())];
  paths.forEach(path => { path.tagName = 'path'; path.attributes.set('pathLength', '1'); });
  const steps = Array.from({ length: 3 }, () => flow.append(new Element('harness-flow-step')));
  const panels = [stage.append(new Element('harness-view-panel', 'harnessViewOverview')), stage.append(new Element('harness-view-panel', 'details'))];
  panels[0].append(screen);
  stage.children = stage.children.filter(node => node !== screen);
  panels[1].hidden = true;
  const explorers = ['flow', 'code', 'docs'].map(name => {
    const node = body.append(new Element());
    node.attributes.set('data-harness-explorer', name);
    const art = node.append(new Element());
    art.attributes.set('data-harness-art', '');
    art.attributes.set('aria-hidden', 'true');
    if (name === 'flow') {
      flow.parentElement = art;
      art.children.push(flow);
      body.children = body.children.filter(child => child !== flow);
    }
    const demoPanels = Array.from({ length: 3 }, (_, index) => node.append(new Element('harness-demo-panel', `${name}${index}`)));
    demoPanels.forEach((panel, index) => { panel.hidden = index !== 0; });
    return { node, art, panels: demoPanels };
  });
  const wrap = stage.append(new Element('harness-screen-wrap'));
  const roguePointer = body.append(new Element('unrelated-pointer'));
  [track, wrap, roguePointer].forEach(node => {
    node.attributes.set('data-harness-pointer', '');
    node.rect = { top: 100, left: 100, width: 800, height: 300 };
  });
  const unrelated = body.append(new Element('', 'unrelated'));
  const outside = document.append(new Element('harness-view-panel', 'outside'));
  // Mutation of functional page state is never part of motion enhancement.
  const attributesBefore = () => JSON.stringify([body, stage, screen, flow, ...panels].map(node => [...node.attributes]));
  const functionalAttributes = attributesBefore();
  if (options.noHooks) {
    stage.attributes.clear();
    flow.attributes.clear();
  }
  if (options.noScreenStyle) screen.style = undefined;

  function media(matches) {
    const item = new Events();
    item.matches = matches;
    if (options.legacy) {
      item.addEventListener = undefined;
      item.addListener = fn => Events.prototype.addEventListener.call(item, 'change', fn);
    }
    item.set = matches => { item.matches = matches; item.emit('change', { matches }); };
    return item;
  }
  const reduced = media(Boolean(options.reduced));
  const desktop = media(options.desktop !== false);
  const fine = media(options.fine !== false);
  Object.assign(window, {
    innerHeight: 900,
    matchMedia: options.noMedia ? undefined : query => {
      if (options.brokenMedia) throw new Error('matchMedia unavailable');
      assert.ok(['(prefers-reduced-motion: reduce)', '(min-width: 901px)', '(hover: hover) and (pointer: fine)'].includes(query));
      return query.includes('reduced-motion') ? reduced : query.includes('min-width') ? desktop : fine;
    },
    requestAnimationFrame: options.noRAF ? undefined : fn => {
      requests += 1;
      if (options.brokenRAF) throw new Error('RAF unavailable');
      frames.set(++nextFrame, fn);
      return nextFrame;
    },
    cancelAnimationFrame: options.noCancelRAF ? undefined : id => { cancellations += 1; frames.delete(id); },
    IntersectionObserver: options.noIO ? undefined : class {
      targets = new Set();
      disconnected = false;
      constructor(callback, config) {
        if (options.brokenIO) throw new Error('observer unavailable');
        this.callback = callback;
        this.config = config;
        observers.push(this);
      }
      observe(target) {
        if (options.brokenObserve) throw new Error('observe unavailable');
        this.targets.add(target);
      }
      unobserve(target) { this.targets.delete(target); }
      disconnect() { this.disconnected = true; this.targets.clear(); }
    }
  });
  const forbidden = name => () => { throw new Error(`Motion must not use ${name}`); };
  const context = { window, document, console, setTimeout: forbidden('timers'), setInterval: forbidden('intervals'),
    fetch: forbidden('fetch'), MutationObserver: forbidden('generic reveal/mutation observers') };
  for (const name of ['localStorage', 'sessionStorage', 'location']) {
    Object.defineProperty(window, name, { get: forbidden(name) });
    Object.defineProperty(context, name, { get: forbidden(name) });
  }
  window.fetch = forbidden('fetch');
  window.setTimeout = context.setTimeout;
  window.setInterval = context.setInterval;
  vm.runInNewContext(source, context, { filename: 'mingshen-harness-motion.js', timeout: 1000 });

  return {
    window, document, body, stage, screen, flow, paths, steps, panels, words, copy, heroPath, unrelated, outside,
    reduced, desktop, fine, animations, observers, frames, explorers, track, wrap, roguePointer,
    get requests() { return requests; }, get cancellations() { return cancellations; },
    get geometries() { return geometries; }, get queries() { return queries; },
    get finishedReads() { return finishedReads; },
    activeObserver: () => observers.findLast(observer => !observer.disconnected),
    activeAnimations: () => animations.filter(animation => !animation.cancelled && !animation.complete),
    enter(target, isIntersecting = true) {
      const observer = this.activeObserver();
      assert.ok(observer?.targets.has(target), 'semantic target must be observed');
      observer.callback([{ target, isIntersecting }]);
    },
    flush() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(fn => fn());
    },
    visible(visible) {
      document.hidden = !visible;
      document.visibilityState = visible ? 'visible' : 'hidden';
      document.emit('visibilitychange');
    },
    finish() { animations.forEach(animation => animation.finish()); },
    tab(panel) { body.emit('club:tabchange', { detail: { target: panel.getAttribute('id') } }); },
    unchanged() { assert.equal(attributesBefore(), functionalAttributes); }
  };
}

function neutral(ui) {
  assert.equal(ui.screen.props.get('--harness-screen-tilt'), '0deg');
  assert.equal(ui.screen.props.get('--harness-screen-scale'), '1');
}
function bounded(ui) {
  const tilt = Number.parseFloat(ui.screen.props.get('--harness-screen-tilt'));
  const scale = Number(ui.screen.props.get('--harness-screen-scale'));
  assert.ok(tilt >= 0 && tilt <= 5, `tilt ${tilt} must be bounded`);
  assert.ok(scale >= 0.97 && scale <= 1, `scale ${scale} must be bounded`);
}
function heroAnimations(ui) { return ui.animations.filter(animation => [...ui.words, ui.copy, ui.heroPath].includes(animation.node)); }
function flowAnimations(ui) { return ui.animations.filter(animation => [...ui.paths, ...ui.steps].includes(animation.node)); }

const ui = harness();
assert.equal(ui.observers.length, 1);
assert.deepEqual([...ui.activeObserver().targets], [ui.stage, ui.flow, ui.track, ui.wrap], 'observe semantic stage/workflow and only approved pointer surfaces');
neutral(ui);
assert.equal(ui.frames.size, 0, 'no frame before a stage intersection');
assert.equal(ui.window.count('scroll'), 0);
assert.equal(heroAnimations(ui).length, 4);
for (const animation of heroAnimations(ui)) {
  assert.ok(animation.config.duration >= 500 && animation.config.duration <= 800);
  assert.ok(animation.config.duration + (animation.config.delay || 0) <= 800);
  assert.equal(animation.config.iterations, 1);
  assert.equal(animation.config.fill, 'none');
}
assert.equal(ui.geometries, 1);
assert.equal(ui.finishedReads, 0);
ui.window.emit('pageshow', { persisted: false });
assert.equal(ui.activeAnimations().length, 4, 'initial pageshow must not cancel the entrance');
ui.finish();
assert.equal(ui.activeAnimations().length, 0);
assert.ok(ui.animations.every(animation => animation.cancelled), 'finished effects release their references');

ui.enter(ui.stage);
assert.equal(ui.frames.size, 1);
assert.equal(ui.window.count('scroll'), 1);
assert.equal(ui.window.listeners.get('scroll')[0].config.passive, true);
for (let index = 0; index < 50; index += 1) ui.window.emit('scroll');
assert.equal(ui.requests, 1, 'scroll bursts batch to one frame');
assert.equal(ui.stage.reads, 0, 'geometry is not read in the scroll callback');
ui.flush();
bounded(ui);
assert.equal(ui.stage.reads, 1);
assert.equal(ui.screen.reads, 0, 'read untransformed stage geometry only');
assert.equal(ui.stage.writes.length, 0, 'never transform the reveal/stage wrapper');
assert.equal(ui.frames.size, 0, 'an idle frame must not requeue itself');
const idleQueries = ui.queries;
for (const top of [-10000, -600, 0, 900, 10000]) {
  ui.stage.rect.top = top;
  ui.window.emit('scroll');
  ui.window.emit('resize');
  assert.equal(ui.frames.size, 1);
  ui.flush();
  bounded(ui);
}
assert.equal(ui.queries, idleQueries, 'scroll and resize must not rescan the DOM');
ui.stage.rect.top = Number.NaN;
ui.window.emit('scroll');
ui.flush();
neutral(ui);
ui.stage.rect.top = 400;
ui.window.emit('scroll');
ui.enter(ui.stage, false);
assert.equal(ui.frames.size, 0, 'leaving stage cancels pending work');
assert.equal(ui.window.count('scroll'), 0);
neutral(ui);
const idleRequests = ui.requests;
ui.window.emit('scroll');
ui.window.emit('resize');
assert.equal(ui.requests, idleRequests, 'offstage scroll and resize stay idle');

ui.enter(ui.flow);
assert.equal(flowAnimations(ui).length, 5);
assert.equal(ui.activeObserver().targets.has(ui.flow), false);
for (const animation of flowAnimations(ui)) {
  assert.ok(animation.config.duration + animation.config.delay <= 1800);
  assert.equal(animation.config.iterations, 1);
  assert.equal(animation.config.fill, 'none');
}
for (const animation of flowAnimations(ui).filter(animation => ui.paths.includes(animation.node))) {
  assert.equal(animation.keyframes[0].strokeDasharray, '1 1');
  assert.equal(animation.keyframes[0].strokeDashoffset, 1);
  assert.equal(animation.keyframes[1].strokeDashoffset, 0);
}
ui.activeObserver().callback([{ target: ui.flow, isIntersecting: true }]);
assert.equal(flowAnimations(ui).length, 5, 'duplicate intersection cannot replay workflow');
ui.finish();
ui.visible(false);
assert.equal(ui.activeObserver(), undefined);
assert.equal(ui.frames.size, 0);
ui.visible(true);
assert.equal(ui.activeObserver().targets.has(ui.flow), false, 'completed workflow is not re-observed');
assert.equal(heroAnimations(ui).length, 4, 'hero never replays on visibility restoration');
ui.unchanged();

// Live preferences and page lifecycle interrupt active work, not merely future starts.
const live = harness();
live.enter(live.stage);
const oldObserver = live.activeObserver();
const staleFrame = [...live.frames.values()][0];
live.reduced.set(true);
neutral(live);
assert.equal(live.activeAnimations().length, 0);
assert.equal(live.frames.size, 0);
assert.equal(live.window.count('scroll'), 0);
assert.ok(oldObserver.disconnected);
oldObserver.callback([{ target: live.stage, isIntersecting: true }, { target: live.flow, isIntersecting: true }]);
staleFrame();
assert.equal(live.frames.size, 0, 'queued callbacks cannot revive disabled motion');
assert.equal(flowAnimations(live).length, 0);
live.reduced.set(false);
assert.ok(live.activeObserver().targets.has(live.flow), 'unseen workflow can still play after preference restoration');
assert.equal(heroAnimations(live).length, 4, 'cancelled hero is never replayed');
live.enter(live.stage);
live.flush();
live.window.emit('scroll');
live.desktop.set(false);
neutral(live);
assert.equal(live.frames.size, 0);
assert.equal(live.activeObserver(), undefined);
live.desktop.set(true);
live.enter(live.flow);
live.enter(live.stage);
live.visible(false);
neutral(live);
assert.equal(live.activeAnimations().length, 0, 'hidden documents cancel the workflow and all live effects');
assert.equal(live.frames.size, 0);
live.visible(true);
assert.equal(flowAnimations(live).length, 5, 'interrupted workflow also stays one-shot');
live.enter(live.stage);
live.window.emit('pagehide', { persisted: true });
neutral(live);
assert.equal(live.frames.size, 0);
assert.equal(live.window.count('scroll'), 0);
assert.equal(live.activeObserver(), undefined);
live.document.emit('visibilitychange');
assert.equal(live.activeObserver(), undefined, 'visibility cannot unsuspend a pagehide');
live.window.emit('pageshow', { persisted: true });
assert.ok(live.activeObserver().targets.has(live.stage));
assert.equal(live.activeObserver().targets.has(live.flow), false);
assert.equal(live.window.count('scroll'), 0, 'restoration waits for a fresh stage intersection');
live.enter(live.stage);
live.flush();
bounded(live);
assert.equal(heroAnimations(live).length, 4);
live.window.emit('pageshow', { persisted: true });
assert.equal(live.window.count('scroll'), 1, 'duplicate pageshow cannot duplicate listeners');
live.unchanged();

const cached = harness();
cached.enter(cached.stage);
assert.equal(cached.activeAnimations().length, 4);
cached.window.emit('pagehide', { persisted: true });
assert.equal(cached.activeAnimations().length, 0, 'pagehide cancels live hero effects directly');
assert.equal(cached.frames.size, 0);
neutral(cached);
cached.window.emit('pageshow', { persisted: true });
assert.ok(cached.activeObserver().targets.has(cached.flow), 'unseen workflow survives bfcache restoration');
cached.enter(cached.flow);
assert.equal(flowAnimations(cached).length, 5);
cached.window.emit('pagehide', { persisted: false });
assert.equal(cached.activeAnimations().length, 0, 'pagehide also cancels a running workflow');
cached.window.emit('pageshow', { persisted: true });
assert.equal(cached.activeObserver().targets.has(cached.flow), false);
assert.equal(heroAnimations(cached).length, 4);

// Tabs provide feedback only, after the shared shell has made the state change.
const tabs = harness();
tabs.finish();
tabs.tab(tabs.panels[0]);
assert.equal(tabs.activeAnimations().length, 1);
assert.equal(tabs.activeAnimations()[0].config.duration, 240);
assert.equal(tabs.activeAnimations()[0].node, tabs.panels[0]);
const previous = tabs.activeAnimations()[0];
tabs.panels[0].hidden = true;
tabs.panels[1].hidden = false;
tabs.tab(tabs.panels[1]);
assert.ok(previous.cancelled);
assert.equal(tabs.activeAnimations().length, 1, 'rapid tabs keep at most one panel animation');
const count = tabs.animations.length;
for (const panel of [tabs.panels[0], tabs.unrelated, tabs.outside]) tabs.tab(panel);
tabs.body.emit('club:tabchange');
tabs.body.emit('club:tabchange', { detail: { target: {} } });
assert.equal(tabs.animations.length, count);
assert.equal(tabs.panels[0].hidden, true);
assert.equal(tabs.panels[1].hidden, false);
assert.equal(tabs.body.count('keydown'), 0);
assert.equal(tabs.body.count('click'), 0);
tabs.reduced.set(true);
assert.equal(tabs.activeAnimations().length, 0);
tabs.tab(tabs.panels[1]);
assert.equal(tabs.animations.length, count);
tabs.unchanged();

for (const options of [{ reduced: true }, { desktop: false }, { hidden: true }, { noMedia: true }, { brokenMedia: true }]) {
  const disabled = harness(options);
  neutral(disabled);
  assert.equal(disabled.animations.length, 0);
  assert.equal(disabled.observers.length, 0);
  assert.equal(disabled.frames.size, 0);
  disabled.window.emit('scroll');
  disabled.window.emit('resize');
  disabled.tab(disabled.panels[0]);
  assert.equal(disabled.requests, 0);
  assert.equal(disabled.animations.length, 0);
  disabled.unchanged();
}
const initialReduced = harness({ reduced: true });
initialReduced.reduced.set(false);
assert.equal(heroAnimations(initialReduced).length, 0, 'changing initial preference does not replay hero');
initialReduced.enter(initialReduced.flow);
assert.equal(flowAnimations(initialReduced).length, 5);
const initialHidden = harness({ hidden: true });
initialHidden.visible(true);
assert.equal(heroAnimations(initialHidden).length, 0);
initialHidden.enter(initialHidden.stage);
initialHidden.flush();
bounded(initialHidden);

for (const options of [{ noIO: true }, { brokenIO: true }, { brokenObserve: true }]) {
  const staticStage = harness(options);
  neutral(staticStage);
  staticStage.window.emit('scroll');
  assert.equal(staticStage.requests, 0);
  assert.equal(staticStage.window.count('scroll'), 0);
  staticStage.window.emit('pagehide');
  staticStage.window.emit('pageshow', { persisted: true });
  assert.equal(staticStage.frames.size, 0);
  staticStage.unchanged();
}
for (const options of [{ noRAF: true }, { noCancelRAF: true }, { brokenRAF: true }]) {
  const noFrames = harness(options);
  if (noFrames.activeObserver().targets.has(noFrames.stage)) noFrames.enter(noFrames.stage);
  noFrames.window.emit('scroll');
  assert.equal(noFrames.frames.size, 0);
  neutral(noFrames);
  noFrames.enter(noFrames.flow);
  assert.equal(flowAnimations(noFrames).length, 5, 'workflow does not depend on RAF');
  noFrames.window.emit('pagehide');
}
for (const options of [{ noWAAPI: true }, { brokenWAAPI: true }, { brokenGeometry: true }, { brokenCancel: true }, { noScreenStyle: true }]) {
  const partial = harness(options);
  partial.enter(partial.flow);
  partial.enter(partial.stage);
  partial.flush();
  partial.visible(false);
  partial.reduced.set(true);
  partial.window.emit('pagehide');
  partial.window.emit('pageshow', { persisted: true });
  assert.equal(partial.finishedReads, 0);
  partial.unchanged();
}
const legacy = harness({ legacy: true });
legacy.enter(legacy.stage);
legacy.reduced.set(true);
neutral(legacy);
assert.equal(legacy.frames.size, 0);
legacy.reduced.set(false);
assert.ok(legacy.activeObserver());
legacy.desktop.set(false);
assert.equal(legacy.activeObserver(), undefined);
const normalized = harness({ normalizedHero: true });
assert.equal(normalized.geometries, 0, 'normalized SVG paths need no geometry call');
assert.equal(heroAnimations(normalized).at(-1).keyframes[0].strokeDashoffset, 1);
const loading = harness({ loading: true });
assert.equal(loading.animations.length, 0);
assert.equal(loading.observers.length, 0);
loading.document.emit('DOMContentLoaded');
assert.equal(loading.animations.length, 4);
loading.document.emit('DOMContentLoaded');
assert.equal(loading.animations.length, 4, 'boot listener runs once');
for (const options of [{ otherPage: true }, { noBody: true }]) {
  const untouched = harness(options);
  assert.equal(untouched.observers.length, 0);
  assert.equal(untouched.animations.length, 0);
  assert.equal(untouched.window.count('pagehide'), 0);
}
const empty = harness({ noHooks: true, fine: false });
assert.equal(empty.observers.length, 0, 'missing hooks and disabled pointer work need no observer');
assert.equal(empty.frames.size, 0);

// Independent component cancellation: tab changes never erase other in-flight work.
const scoped = harness();
const heroLive = heroAnimations(scoped);
scoped.enter(scoped.stage);
scoped.flush();
scoped.enter(scoped.flow);
const workflowLive = flowAnimations(scoped);
scoped.tab(scoped.panels[0]);
assert.ok(heroLive.every(animation => !animation.cancelled));
assert.ok(workflowLive.every(animation => !animation.cancelled), 'screenshot tabs preserve the workflow entrance');
const screenshotEffect = scoped.activeAnimations().find(animation => animation.node === scoped.panels[0]);
const [flowDemo, codeDemo, docsDemo] = scoped.explorers;
scoped.tab(codeDemo.panels[0]);
const codeEffects = scoped.activeAnimations().filter(animation => codeDemo.node.contains(animation.node));
assert.equal(codeEffects.length, 2, 'demo panel and its art each receive finite feedback');
assert.ok(codeEffects.every(animation => animation.config.iterations === 1 && animation.config.fill === 'none'));
assert.equal(codeEffects.find(animation => animation.node === codeDemo.panels[0]).keyframes[0].clipPath, 'inset(0 0 5% 0)');
assert.ok(workflowLive.every(animation => !animation.cancelled));
scoped.tab(docsDemo.panels[0]);
const docEffects = scoped.activeAnimations().filter(animation => docsDemo.node.contains(animation.node));
codeDemo.panels[0].hidden = true;
codeDemo.panels[1].hidden = false;
scoped.tab(codeDemo.panels[1]);
assert.ok(codeEffects.every(animation => animation.cancelled));
assert.ok(docEffects.every(animation => !animation.cancelled));
assert.equal(screenshotEffect.cancelled, false);
assert.ok(heroLive.every(animation => !animation.cancelled));
scoped.tab(flowDemo.panels[0]);
assert.ok(workflowLive.every(animation => animation.cancelled), 'flow selection interrupts only its own entrance');
assert.equal(scoped.activeAnimations().filter(animation => scoped.paths.includes(animation.node)).length, 2);
for (let index = 0; index < 30; index += 1) {
  codeDemo.panels.forEach((panel, position) => { panel.hidden = position !== index % 3; });
  scoped.tab(codeDemo.panels[index % 3]);
}
assert.equal(scoped.activeAnimations().filter(animation => codeDemo.node.contains(animation.node)).length, 2, 'rapid changes are bounded per explorer');
assert.ok(heroLive.every(animation => !animation.cancelled));
scoped.flush();
assert.equal(scoped.frames.size, 0, 'finite tab effects add no scheduling loop');

// Overview visibility owns the screenshot scroll work, not the stage intersection.
scoped.window.emit('scroll');
assert.equal(scoped.frames.size, 1);
scoped.panels[0].hidden = true;
scoped.panels[1].hidden = false;
scoped.tab(scoped.panels[1]);
assert.equal(scoped.frames.size, 0);
assert.equal(scoped.window.count('scroll'), 0);
neutral(scoped);
const hiddenStageReads = scoped.stage.reads;
scoped.window.emit('scroll'); scoped.window.emit('resize'); scoped.flush();
assert.equal(scoped.stage.reads, hiddenStageReads, 'hidden Overview never samples scroll geometry');
scoped.panels[0].hidden = false;
scoped.panels[1].hidden = true;
scoped.tab(scoped.panels[0]);
assert.equal(scoped.window.count('scroll'), 1);
assert.equal(scoped.frames.size, 1, 'visible Overview resumes within the existing stage intersection');
scoped.flush(); bounded(scoped);

// Only explicitly marked fine-mouse surfaces can schedule pointer lighting.
const pointer = harness();
const move = (ui, node, extra = {}) => node.emit('pointermove', { pointerType: 'mouse', clientX: 900, clientY: 100, ...extra });
const reset = node => {
  assert.equal(node.props.get('--harness-pointer-active'), '0');
  assert.equal(node.props.get('--harness-pointer-x'), '50%');
  assert.equal(node.props.get('--harness-pointer-y'), '50%');
  assert.equal(node.props.get('--harness-pointer-tilt-x'), '0deg');
  assert.equal(node.props.get('--harness-pointer-tilt-y'), '0deg');
};
assert.equal(pointer.roguePointer.count('pointermove'), 0);
assert.equal(pointer.body.count('pointermove'), 0);
assert.equal(pointer.track.count('pointermove'), 1);
assert.equal(pointer.track.listeners.get('pointermove')[0].config.passive, true);
reset(pointer.track);
move(pointer, pointer.track);
assert.equal(pointer.frames.size, 0, 'offscreen surfaces cannot start work');
pointer.enter(pointer.track);
for (const pointerType of ['touch', 'pen', undefined]) move(pointer, pointer.track, { pointerType });
assert.equal(pointer.frames.size, 0);
const pointerReads = pointer.track.reads;
for (let index = 0; index < 40; index += 1) move(pointer, pointer.track);
assert.equal(pointer.track.reads, pointerReads, 'pointermove handler does not read layout');
assert.equal(pointer.frames.size, 1);
pointer.flush();
assert.equal(pointer.track.reads, pointerReads + 1);
assert.equal(pointer.track.props.get('--harness-pointer-active'), '1');
assert.equal(pointer.track.props.get('--harness-pointer-x'), '100.00%');
assert.equal(pointer.track.props.get('--harness-pointer-y'), '0.00%');
assert.equal(pointer.frames.size, 0);
for (const [clientX, clientY] of [[-10000, -10000], [10000, 10000], [500, 250]]) {
  move(pointer, pointer.track, { clientX, clientY }); pointer.flush();
  for (const axis of ['x', 'y']) {
    const position = Number.parseFloat(pointer.track.props.get(`--harness-pointer-${axis}`));
    const tilt = Number.parseFloat(pointer.track.props.get(`--harness-pointer-tilt-${axis}`));
    assert.ok(position >= 0 && position <= 100);
    assert.ok(Math.abs(tilt) <= 1.2);
  }
}
assert.equal(pointer.screen.writes.some(write => write.name.startsWith('--harness-pointer-')), false, 'actual screenshot has no pointer transform owner');
for (const event of ['pointerleave', 'pointercancel']) {
  move(pointer, pointer.track);
  const stale = [...pointer.frames.values()][0];
  pointer.track.emit(event);
  assert.equal(pointer.frames.size, 0); reset(pointer.track);
  stale(); reset(pointer.track);
}
move(pointer, pointer.track); pointer.flush(); pointer.window.emit('blur'); reset(pointer.track);
move(pointer, pointer.track); pointer.enter(pointer.track, false); reset(pointer.track);
assert.equal(pointer.frames.size, 0);
pointer.enter(pointer.wrap); move(pointer, pointer.wrap); pointer.flush();
assert.equal(pointer.wrap.props.get('--harness-pointer-active'), '1');
pointer.panels[0].hidden = true;
pointer.panels[1].hidden = false;
pointer.tab(pointer.panels[1]);
reset(pointer.wrap);
move(pointer, pointer.wrap); pointer.flush();
assert.equal(pointer.wrap.props.get('--harness-pointer-active'), '1', 'local screenshot switch resets lighting but permits subsequent mouse movement');
neutral(pointer);
pointer.fine.set(false); reset(pointer.wrap);
assert.equal(pointer.wrap.count('pointermove'), 0);
pointer.fine.set(true); pointer.enter(pointer.wrap);
move(pointer, pointer.wrap); pointer.visible(false); reset(pointer.wrap);
assert.equal(pointer.frames.size, 0);
pointer.visible(true); pointer.enter(pointer.wrap); move(pointer, pointer.wrap); pointer.flush();
pointer.window.emit('pagehide'); reset(pointer.wrap);
assert.equal(pointer.wrap.count('pointermove'), 0);
pointer.window.emit('pageshow'); pointer.enter(pointer.wrap); move(pointer, pointer.wrap); pointer.flush();
pointer.reduced.set(true); reset(pointer.wrap);
assert.equal(pointer.frames.size, 0);
pointer.reduced.set(false); pointer.enter(pointer.wrap); move(pointer, pointer.wrap);
pointer.desktop.set(false); reset(pointer.wrap);
assert.equal(pointer.frames.size, 0);
for (const options of [{ fine: false }, { reduced: true }, { desktop: false }, { noIO: true }, { noRAF: true }, { noCancelRAF: true }]) {
  const disabledPointer = harness(options);
  assert.equal(disabledPointer.track.count('pointermove'), 0, 'pointer listener gate is conservative');
  reset(disabledPointer.track);
}
console.log('PASS harness motion: real IIFE, scoped finite panel/art feedback, independent rapid switching, Overview scroll pause/resume, semantic observers, bounded fine-mouse lighting/reset, passive batching, no idle frames, reduced/mobile/static fallbacks and lifecycle/partial APIs.');
