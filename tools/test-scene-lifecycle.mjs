import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Exercise the real class with a pending shader compile and a controllable rAF
// queue. GPU/browser acceptance is separate; this catches startup/event races.
const source = readFileSync(new URL('../public/SceneDirector.js', import.meta.url), 'utf8');
async function test(reduced, lateRuntime = false) {
  const events = new Map(), canvasEvents = new Map(), frames = new Map();
  let frameId = 0, resolveCompile, renders = 0, now = 100, reveal = 0;
  class Renderer {
    setPixelRatio() {}
    setSize() {}
    render() { renders++; }
    compileAsync() { return new Promise(resolve => { resolveCompile = resolve; }); }
  }
  class Vector {
    constructor() { this.x = this.y = 0; }
    set() {}
    copy() {}
  }
  const THREE = {
    WebGLRenderer: Renderer, Scene: class { add() {} }, OrthographicCamera: class {},
    Vector2: Vector, Vector3: Vector, PlaneGeometry: class {}, CatmullRomCurve3: class {},
    ShaderMaterial: class { constructor(options) { Object.assign(this, options); } },
    Mesh: class { constructor(geometry, material) { this.material = material; this.rotation = { z: 0 }; } },
    MathUtils: { clamp: (x, a, b) => Math.max(a, Math.min(b, x)), damp: x => x }
  };
  const document = {
    hidden: false, documentElement: { dataset: { theme: 'dark' }, scrollHeight: 1000 },
    getElementById: () => null, addEventListener: (name, fn) => events.set(name, fn)
  };
  const context = {
    console, THREE, document, matchMedia: () => ({ matches: reduced }),
    devicePixelRatio: 1, innerWidth: 1000, innerHeight: 800, scrollY: 0,
    performance: { now: () => now },
    requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    requestIdleCallback: fn => fn(), setTimeout: () => 1, clearTimeout() {},
    addEventListener: (name, fn) => events.set(name, fn), IntersectionObserver: class { observe() {} }
  };
  context.window = context;
  if (lateRuntime) context.THREE = undefined;
  vm.runInNewContext(source, context);
  assert.equal(typeof context.SceneDirector, 'function', 'class is registered before three.js arrives');
  context.THREE = THREE;
  const canvas = {
    classList: { add() { reveal++; } },
    addEventListener: (name, fn) => canvasEvents.set(name, fn)
  };
  const scene = lateRuntime ? context.SceneDirector.mount(canvas) : new context.SceneDirector(canvas);
  assert.ok(scene);
  const send = name => events.get(name)();
  const visibility = hidden => { document.hidden = hidden; send('visibilitychange'); };
  const lost = () => canvasEvents.get('webglcontextlost')({ preventDefault() {} });
  const restored = () => canvasEvents.get('webglcontextrestored')();
  const oneLoop = () => {
    const scheduled = scene.frame;
    assert.ok(scheduled && frames.has(scheduled), 'one render loop scheduled');
    const before = frames.size;
    scene.resume(); scene.resume();
    assert.equal(scene.frame, scheduled, 'resume keeps the same render loop');
    assert.equal(frames.size, before, 'resume schedules no duplicate callbacks');
  };
  const stopped = () => { assert.equal(scene.frame, 0); };
  const tick = () => {
    const id = scene.frame, fn = frames.get(id);
    assert.ok(fn); frames.delete(id); now += 16; fn();
  };
  assert.equal(scene.ready, false);
  visibility(true); visibility(false); send('pageshow');
  lost(); restored(); scene.resume(); scene.loop();
  assert.equal(renders, 0, 'no render while compile is pending');
  assert.equal(frames.size, 0, 'no callbacks before readiness'); stopped();
  // Compile completion while hidden cannot start a frame or reveal the canvas.
  visibility(true); resolveCompile(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(scene.ready, true); stopped(); assert.equal(renders, 0); assert.equal(reveal, 0);
  visibility(false); oneLoop(); tick(); assert.equal(renders, 1);
  if (reduced) stopped(); else oneLoop();
  const oldFrame = scene.frame;
  visibility(true); stopped(); assert.equal(frames.has(oldFrame), false);
  scene.loop(); assert.equal(renders, 1, 'hidden loop cannot render');
  now += 600000; visibility(false); assert.equal(scene.last, now); oneLoop();
  const pageFrame = scene.frame;
  send('pagehide'); assert.equal(scene.paused, true); stopped();
  assert.equal(frames.has(pageFrame), false, 'pagehide cancels the loop');
  scene.resume(); scene.loop(); stopped(); assert.equal(renders, 1);
  send('pageshow'); assert.equal(scene.paused, false); oneLoop();
  const lostFrame = scene.frame;
  lost(); assert.equal(scene.contextLost, true); stopped();
  assert.equal(frames.has(lostFrame), false, 'context loss cancels the loop');
  scene.resume(); scene.loop(); stopped(); assert.equal(renders, 1);
  restored(); assert.equal(scene.contextLost, false); oneLoop();
  restored(); oneLoop(); assert.equal(renders, 1, 'restore never forces a render');
  tick(); assert.equal(renders, 2);
  if (reduced) stopped(); else oneLoop();
}
await test(false);
await test(true);
await test(false, true);
console.log('Scene lifecycle passed: pending compile, hidden readiness, one loop, visibility, bfcache, context restore, and reduced motion.');
