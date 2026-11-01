import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const loader = home.slice(home.indexOf('      let homeScenesStarted = false;'), home.indexOf('      (() => {\n        const zones ='));
assert.ok(loader.includes('Promise.all(['));
assert.doesNotMatch(home, /<script\b[^>]*src="public\/(?:vendor\/three\/three\.min|SceneDirector)\.js/);
const settle = () => new Promise(resolve => setImmediate(resolve));

async function exercise(order) {
  const events = new Map(), scripts = [], timers = new Map();
  let timer = 0, mainCalls = 0, fieldCalls = 0, resolveMain;
  const pendingMain = new Promise(resolve => { resolveMain = resolve; });
  const document = {
    hidden: false,
    addEventListener(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
    removeEventListener(name, fn) { events.set(name, events.get(name).filter(item => item !== fn)); },
    createElement() { return { remove() {} }; },
    head: { appendChild(script) { scripts.push(script); } }
  };
  const context = {
    document, console,
    setTimeout(fn) { timers.set(++timer, fn); return timer; },
    bootAlgorithmScene: () => { mainCalls++; return pendingMain; },
    bootShaderField: () => { fieldCalls++; }
  };
  context.window = context;
  vm.runInNewContext(loader, context);
  const emit = name => [...(events.get(name) || [])].forEach(fn => fn());
  const runTimers = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); };
  emit('DOMContentLoaded');
  assert.equal(scripts.length, 2, 'resources requested without blocking page initialization');
  runTimers(); assert.equal(mainCalls, 0, 'no premature boot');
  const runtime = scripts.find(script => script.src.includes('three.min.js'));
  const director = scripts.find(script => script.src.includes('SceneDirector.js'));
  for (const type of order) {
    if (type === 'three') { context.THREE = {}; runtime.onload(); }
    else { context.SceneDirector = {}; director.onload(); }
    await settle(); runTimers();
  }
  assert.equal(mainCalls, 1, 'both runtime load orders start exactly once');
  assert.equal(fieldCalls, 0, 'secondary field waits for main scene compile');
  emit('visibilitychange'); runTimers(); assert.equal(mainCalls, 1);
  document.hidden = true;
  resolveMain(); await settle(); assert.equal(fieldCalls, 0, 'hidden page cannot start secondary WebGL context');
  document.hidden = false; emit('visibilitychange'); runTimers();
  assert.equal(fieldCalls, 1);
  emit('visibilitychange'); runTimers(); assert.equal(mainCalls, 1); assert.equal(fieldCalls, 1);
}
await exercise(['three', 'director']);
await exercise(['director', 'three']);
const lifecycle = home.slice(home.indexOf('        const stopSceneDraw = () => {'), home.indexOf('      let homeScenesStarted = false;')).replace(/\n      };\s*$/, '');
const lifecycleEvents = new Map(), canvasEvents = new Map(), frames = new Map();
let id = 0, resolveCompile, draws = 0, clockStarts = 0;
const lifecycleDocument = { hidden: false, addEventListener: (name, fn) => lifecycleEvents.set(name, fn) };
const lifecycleContext = {
  document: lifecycleDocument,
  canvas: { addEventListener: (name, fn) => canvasEvents.set(name, fn), classList: { add() {} } },
  clock: { start() { clockStarts++; }, stop() {} },
  renderer: { compileAsync: () => new Promise(resolve => { resolveCompile = resolve; }) },
  scene: {}, camera: {}, nextFrame: async () => {}, touchClearColor() {},
  requestAnimationFrame: fn => { frames.set(++id, fn); return id; },
  cancelAnimationFrame: key => frames.delete(key),
  addEventListener: (name, fn) => lifecycleEvents.set(name, fn)
};
vm.runInNewContext(`let frame = 0, sceneReady = false, scenePaused = false, contextLost = false;
function draw() { frame = 0; if (!sceneReady || scenePaused || document.hidden || contextLost) return; recordDraw(); frame = requestAnimationFrame(draw); }
${'(async () => {'}${lifecycle}${'\n})()'}`, Object.assign(lifecycleContext, { recordDraw() { draws++; } }));
await settle();
lifecycleEvents.get('visibilitychange')(); lifecycleEvents.get('pageshow')();
assert.equal(frames.size, 0, 'main scene cannot render before compilation');
lifecycleDocument.hidden = true; resolveCompile(); await settle(); assert.equal(frames.size, 0);
lifecycleDocument.hidden = false; lifecycleEvents.get('visibilitychange')();
const pending = frames.size;
lifecycleEvents.get('visibilitychange')(); lifecycleEvents.get('pageshow')();
assert.equal(frames.size, pending, 'main scene repeated resume cannot duplicate loops');
assert.equal(clockStarts, 1);
const first = frames.entries().next().value; frames.delete(first[0]); first[1](); assert.equal(draws, 1);
lifecycleEvents.get('pagehide')();
const stopped = frames.size;
lifecycleEvents.get('visibilitychange')(); assert.equal(frames.size, stopped, 'pagehide remains paused');
lifecycleEvents.get('pageshow')(); assert.equal(clockStarts, 2);
canvasEvents.get('webglcontextlost')({ preventDefault() {} });
const lost = frames.size; lifecycleEvents.get('visibilitychange')(); assert.equal(frames.size, lost);
canvasEvents.get('webglcontextrestored')(); assert.equal(clockStarts, 3);
console.log('PASS home scene startup: nonblocking runtime, both load orders, serialized compilation, hidden defer, single boot, main scene lifecycle.');
