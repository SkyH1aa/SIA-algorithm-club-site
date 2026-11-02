import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/club-shell.js', import.meta.url), 'utf8');
const start = source.indexOf('  var revealObserver = null;');
const end = source.indexOf('\n  /*', start);
assert.ok(start > 0 && end > start);

function harness({ reduced = false, broken = false, legacy = false } = {}) {
  const events = {};
  const nodes = [];
  const rootClasses = new Set();
  const observers = [];
  const mutations = [];
  const media = { matches: reduced };
  media[legacy ? 'addListener' : 'addEventListener'] = (...args) => { media.change = args.at(-1); };
  function node(children = []) {
    const classes = new Set();
    const result = { nodeType: 1, marked: true, children,
      classList: { contains: name => classes.has(name), add: name => classes.add(name) },
      hasAttribute: () => result.marked,
      querySelectorAll: () => children,
      shown: () => classes.has('is-revealed') };
    return result;
  }
  const context = {
    WeakSet,
    document: { documentElement: { classList: { add: name => rootClasses.add(name), remove: name => rootClasses.delete(name) } }, body: {}, querySelectorAll: () => nodes },
    matchMedia: () => media,
    addEventListener: (name, fn) => { events[name] = fn; },
    IntersectionObserver: class {
      constructor(callback) { if (broken) throw new Error('observer unavailable'); this.callback = callback; this.targets = new Set(); observers.push(this); }
      observe(target) { this.targets.add(target); }
      unobserve(target) { this.targets.delete(target); }
      disconnect() { this.disconnected = true; this.targets.clear(); }
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; mutations.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    }
  };
  context.global = context;
  context.window = context;
  vm.runInNewContext(source.slice(start, end) + '\nsetupReveal();', context);
  return { context, events, media, nodes, node, rootClasses, observers, mutations };
}

const ui = harness();
assert.equal(ui.observers.length, 1);
assert.equal(ui.mutations.length, 1, 'empty initial pages must observe later nodes');
const child = ui.node();
const parent = ui.node([child]);
ui.nodes.push(parent, child);
ui.mutations.at(-1).callback([{ addedNodes: [parent] }]);
assert.equal(ui.observers.at(-1).targets.size, 2);
ui.mutations.at(-1).callback([{ addedNodes: [parent] }]);
assert.equal(ui.observers.at(-1).targets.size, 2, 'duplicate insert notifications do not re-register');
ui.observers.at(-1).callback([{ target: parent, isIntersecting: true }]);
assert.ok(parent.shown());
assert.equal(ui.observers.at(-1).targets.size, 1);
ui.events.pagehide();
assert.ok(ui.observers.at(-1).disconnected);
assert.ok(ui.mutations.at(-1).disconnected);
assert.equal(ui.rootClasses.has('club-reveal-ready'), false);
ui.events.pageshow();
assert.ok(ui.observers.at(-1).targets.has(child));
assert.equal(ui.observers.at(-1).targets.has(parent), false, 'completed entrances never replay');
ui.media.matches = true;
ui.media.change();
assert.ok(child.shown());
assert.equal(ui.rootClasses.has('club-reveal-ready'), false);
const dynamic = ui.node();
ui.nodes.push(dynamic);
ui.media.matches = false;
ui.media.change();
assert.ok(ui.observers.at(-1).targets.has(dynamic));
assert.equal(ui.observers.at(-1).targets.has(child), false);
vm.runInNewContext('setupReveal();', ui.context);
assert.equal(ui.observers.filter(item => !item.disconnected).length, 1);
const fail = harness({ broken: true });
assert.equal(fail.rootClasses.has('club-reveal-ready'), false);
const old = harness({ legacy: true });
assert.equal(typeof old.media.change, 'function');
console.log('PASS reveal lifecycle: empty/dynamic trees, idempotence, once-only reveal, pagehide/bfcache, live reduced motion and observer failure.');
