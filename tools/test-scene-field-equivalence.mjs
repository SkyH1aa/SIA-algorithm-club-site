import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// No browser or dependencies. Execute the actual shader's field functions on the
// CPU, then compare to an independently written reference of the pre-hoist field.
// This checks arithmetic/ordering, not driver precision or GPU performance.
const source = readFileSync(new URL('../public/SceneDirector.js', import.meta.url), 'utf8');
const shader = source.match(/const fragmentShader = `([\s\S]*?)`;/)[1];
const copy = x => Array.isArray(x) ? x.map(copy) : x;
const each = (fn, ...args) => {
  const vector = args.find(Array.isArray);
  return vector ? vector.map((_, i) => fn(...args.map(x => Array.isArray(x) ? x[i] : x))) : fn(...args);
};
const add = (a, b) => each((x, y) => x + y, a, b);
const sub = (a, b) => each((x, y) => x - y, a, b);
const mul = (a, b) => each((x, y) => x * y, a, b);
const div = (a, b) => each((x, y) => x / y, a, b);
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const length = a => Math.sqrt(dot(a, a));
const normalize = a => div(a, length(a));
const clamp = (x, lo, hi) => each((v, a, b) => Math.min(Math.max(v, a), b), x, lo, hi);
const mix = (a, b, t) => add(mul(a, sub(1, t)), mul(b, t));
const smoothstep = (a, b, x) => {
  const t = clamp(div(sub(x, a), sub(b, a)), 0, 1);
  return mul(mul(t, t), sub(3, mul(2, t)));
};
const fract = x => each(v => v - Math.floor(v), x);
const sin = x => each(Math.sin, x);
const cos = x => each(Math.cos, x);
const abs = x => each(Math.abs, x);
const max = (a, b) => each(Math.max, a, b);
const min = (a, b) => each(Math.min, a, b);
const vector = n => (...args) => args.length === 1 && !Array.isArray(args[0]) ? Array(n).fill(args[0]) : args.flat();
const swizzle = (v, key) => key.length === 1 ? v['xyzw'.indexOf(key)] : [...key].map(c => v['xyzw'.indexOf(c)]);
const builtins = {
  copy, add, sub, mul, div, dot, length, normalize, clamp, mix, smoothstep,
  fract, sin, cos, abs, max, min, swizzle,
  floor: x => each(Math.floor, x),
  mod: (a, b) => each((x, y) => x - y * Math.floor(x / y), a, b),
  atan: Math.atan2, float: Number,
  vec2: vector(2), vec3: vector(3), vec4: vector(4)
};

// A deliberately small GLSL-subset compiler, rather than another handwritten
// implementation of the optimized equations. Unsupported syntax fails closed.
// Vector operators and assignments retain GLSL value semantics.
function compileField(text) {
  const field = text.slice(0, text.indexOf('    vec3 dayPalette'))
    .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*#define\s+(\w+)\s+([^\n]+)/gm, 'const float $1 = $2;');
  const tokens = field.match(/\d+(?:\.\d*)?(?:e[+-]?\d+)?|[A-Za-z_]\w*|\+\+|[+*/-]=|<=|>=|==|!=|&&|\|\||[^\s]/g);
  let cursor = 0;
  const peek = () => tokens[cursor];
  const take = () => tokens[cursor++];
  const expect = value => assert.equal(take(), value, `GLSL token near ${tokens.slice(cursor - 5, cursor + 5).join(' ')}`);
  const types = /^(?:float|int|vec[234]|void)$/;
  const precedence = { '=': 1, '+=': 1, '-=': 1, '*=': 1, '/=': 1, '?': 2, '||': 3, '&&': 4, '==': 5, '!=': 5, '<': 6, '>': 6, '<=': 6, '>=': 6, '+': 7, '-': 7, '*': 8, '/': 8 };
  const arithmetic = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' };
  function expression(level = 0) {
    let left;
    const token = take();
    if (token === '(') { left = expression(); expect(')'); }
    else if (token === '-') left = `mul(-1,${expression(9)})`;
    else if (token === '+') left = expression(9);
    else { assert.match(token, /^(?:\d|[A-Za-z_])/); left = token; }
    while (true) {
      if (peek() === '(') {
        take(); const args = [];
        if (peek() !== ')') { do { args.push(expression()); } while (peek() === ',' && take()); }
        expect(')'); left = `${left}(${args.join(',')})`;
      } else if (peek() === '[') {
        take(); const index = expression(); expect(']'); left = `${left}[${index}]`;
      } else if (peek() === '.') {
        take(); const key = take();
        // A single component is an assignable lvalue; multi-component reads copy.
        left = key.length === 1 ? `${left}[${'xyzw'.indexOf(key)}]` : `swizzle(${left},'${key}')`;
      } else if (peek() === '++') { take(); left = `${left}++`; }
      else break;
    }
    while ((precedence[peek()] ?? -1) >= level) {
      const op = take(), rank = precedence[op];
      if (op === '?') {
        const yes = expression(); expect(':'); left = `(${left}?${yes}:${expression(rank)})`;
      } else {
        const assignment = rank === 1;
        const right = expression(assignment ? rank : rank + 1);
        if (op === '=') left = `(${left}=copy(${right}))`;
        else if (assignment) left = `(${left}=${arithmetic[op[0]]}(${left},${right}))`;
        else left = arithmetic[op] ? `${arithmetic[op]}(${left},${right})` : `(${left}${op}${right})`;
      }
    }
    return left;
  }
  function declaration(type, firstName) {
    const vars = [];
    let name = firstName;
    do {
      let initial = type.startsWith('vec') ? `Array(${type.at(-1)}).fill(0)` : '0';
      if (peek() === '[') { take(); const size = expression(); expect(']'); initial = `Array.from({length:${size}},()=>${initial})`; }
      if (peek() === '=') { take(); initial = `copy(${expression(2)})`; }
      vars.push(`${name}=${initial}`);
      if (peek() !== ',') break;
      take(); name = take();
    } while (true);
    expect(';');
    return `let ${vars.join(',')};`;
  }
  function statement() {
    if (peek() === '{') {
      take(); let body = '{';
      while (peek() !== '}') body += statement();
      take(); return `${body}}`;
    }
    if (peek() === 'return') { take(); const value = expression(); expect(';'); return `return copy(${value});`; }
    if (peek() === 'if') { take(); expect('('); const condition = expression(); expect(')'); return `if(${condition})${statement()}`; }
    if (peek() === 'for') {
      take(); expect('('); const init = statement(); const condition = expression(); expect(';'); const increment = expression(); expect(')');
      return `for(${init}${condition};${increment})${statement()}`;
    }
    if (types.test(peek())) return declaration(take(), take());
    const value = expression(); expect(';'); return `${value};`;
  }
  let program = '';
  while (cursor < tokens.length) {
    if (['uniform', 'varying', 'const'].includes(peek())) take();
    const type = take(), name = take();
    assert.match(type, types);
    if (peek() === '(') {
      take(); const params = [];
      if (peek() !== ')') {
        do { assert.match(take(), types); params.push(take()); } while (peek() === ',' && take());
      }
      expect(')'); program += `function ${name}(${params.join(',')})${statement()}`;
    } else program += declaration(type, name);
  }
  const factory = new Function(...Object.keys(builtins), `${program}
    return { prepare(time, scroll) { uTime=time; uScroll=scroll; prepareChapter(); prepareScene(); },
      sample: sceneMap, normal: normalAt,
      chapter: () => [coreMorph(),armCount(),ringShape(),ringCount(),topologyValue(),flowValue(),densityValue()] };`);
  return factory(...Object.values(builtins));
}
const actual = compileField(shader);

// Independent baseline: chapter interpolation is table-driven, geometry is built
// inline per sample, and links use their endpoints rather than cached deltas.
const chapterRows = [
  [0, .33, .52, .68, .78, .90, 1], [3, 4, 5, 6, 4, 5, 6],
  [0, .24, .56, .90, .42, .78, 1], [3, 5, 6, 7, 5, 6, 7],
  [0, .33, .66, 1, .34, .66, 1], [0, .65, .34, 1, .50, .68, 1],
  [.58, .72, .84, .68, .78, .90, .96]
];
function chapterReference(scroll) {
  const c = clamp(clamp(scroll * 6, 0, 5.999), 0, 5.999);
  const segment = Math.floor(c), weight = smoothstep(0, 1, fract(c));
  return chapterRows.map(row => mix(row[segment], row[segment + 1], weight));
}
function hash(p) {
  let q = fract(mul(p, [123.34, 345.45]));
  q = add(q, dot(q, add(q, 34.345)));
  return fract(q[0] * q[1]);
}
function noise(p) {
  const cell = p.map(Math.floor), f = fract(p).map(x => x * x * (3 - 2 * x));
  const n = dot(cell, [1, 57, 113]);
  const corners = [0, 57, 113, 170].map(offset => hash([n + offset, n + offset + 1]));
  return mix(mix(corners[0], corners[1], f[0]), mix(corners[2], corners[3], f[0]), f[1]);
}
const sphere = (p, r) => length(p) - r;
const torus = (p, r, tube) => length([length([p[0], p[2]]) - r, p[1]]) - tube;
function box(p, size) {
  const q = sub(abs(p), size);
  return length(max(q, 0)) + Math.min(Math.max(q[0], Math.max(q[1], q[2])), 0);
}
function smoothMinimum(a, b, k) {
  const h = clamp(.5 + .5 * (b - a) / k, 0, 1);
  return mix(b, a, h) - k * h * (1 - h);
}
function reference(point, time, scroll) {
  const [morph, , shape, count, topology, , density] = chapterReference(scroll);
  const t = time * .10 + scroll * 3.5, az = Math.atan2(point[2], point[0]);
  let noisePoint = add(mul(point, 1.35), [t * .15, -t * .11, t * .08]);
  let flow = 0, amplitude = .5;
  for (let octave = 0; octave < 3; octave++) {
    flow += noise(noisePoint) * amplitude;
    noisePoint = add(mul(noisePoint, 2.03), [11, 7, 5]); amplitude *= .5;
  }
  const p = add(point, mul((flow - .5) * .08, normalize(add(point, .001))));
  const boxPoint = [...p]; boxPoint[1] += Math.sin(az * 3 + t) * .035;
  const knotPoint = [...p]; knotPoint[1] += Math.sin(az * 3 + t * .8) * .18;
  let core = mix(sphere(p, .56) + Math.sin(az * 5 + p[1] * 3) * .014,
    torus(mul(p, [1, .82, 1]), .82, .045), smoothstep(0, .34, morph));
  const cell = mul(abs(sub(fract(add(div(boxPoint, .34), .5)), .5)), .34);
  core = mix(core, Math.min(cell[0], Math.min(cell[1], cell[2])) - .026, smoothstep(.26, .70, morph));
  core = mix(core, torus(knotPoint, .66, .048), smoothstep(.62, 1, morph));
  core = smoothMinimum(core, box(boxPoint, .30 + morph * .08), .10);
  let result = [core, 1];
  const include = (distance, material) => { if (!(result[0] < distance)) result = [distance, material]; };
  for (let i = 0; i < 7; i++) {
    const q = [...p]; q[0] *= 1 + shape * (.18 + i * .018);
    q[1] += Math.sin(az * (2 + i * .35) + t * (.35 + i * .04) + shape * i) * (.025 + shape * .025);
    include(mix(10, torus(q, .96 + i * (.36 + shape * .035), .012 + i * .0018),
      1 - smoothstep(count - .80, count + .05, i)), 2);
  }
  const radius = 1.40 + .18 * density + .10 * Math.sin(t * .7);
  function node(index, ringAngle, graphAngle) {
    const grid = [(index % 4 - 1.5) * .46, (Math.floor(index / 4) - .5) * .48, Math.sin(index + t) * .05];
    const graph = [Math.cos(graphAngle * 1.7) * .72, Math.sin(index * 2.1 + t) * .30, Math.sin(graphAngle * 1.7) * .38];
    const tree = [(index % 2 - .5) * (.34 + Math.floor(index / 2) * .08), (Math.floor(index / 2) - 1.5) * .34, Math.sin(index * 1.3 + t) * .08];
    const ring = [Math.cos(ringAngle) * radius, Math.sin(index * 1.7 + t) * .22, Math.sin(ringAngle) * radius * .62];
    let value = mix(grid, graph, smoothstep(0, .33, topology));
    value = mix(value, tree, smoothstep(.26, .66, topology));
    return mul(mix(value, ring, smoothstep(.58, 1, topology)), .72 + density * .38);
  }
  for (let i = 0; i < 8; i++) {
    const angle = i / 8 * 6.28318530718 + t * .12 + scroll * .7;
    const start = node(i, angle, angle);
    const end = node(i + 1, angle + 6.28318530718 / 8, angle + .8);
    include(sphere(sub(p, start), .052), 3);
    const ba = sub(end, start), pa = sub(p, start);
    const h = clamp(dot(pa, ba) / Math.max(dot(ba, ba), .0001), 0, 1);
    include(length(sub(pa, mul(ba, h))) - .012, 4);
  }
  const companions = [
    [[-1.95 + Math.sin(t * .025) * .12, .34 + Math.cos(t * .031) * .06, -.90], .78, t * .18],
    [[2.05 + Math.cos(t * .021) * .14, -.40 + Math.sin(t * .028) * .08, -1.10], .62, -t * .14]
  ];
  for (const [center, scale, spin] of companions) {
    const local = div(sub(p, center), scale), c = Math.cos(spin), s = Math.sin(spin);
    const q = [c * local[0] - s * local[2], local[1], s * local[0] + c * local[2]];
    let value = smoothMinimum(sphere(q, .42), torus(mul(q, [1, .78, 1]), .62, .035), .08);
    value = smoothMinimum(value, box(q, .24), .08);
    include(value * scale, 5);
  }
  return result;
}

// Preserve the full numerical normal stencil and raymarch policy in the source.
assert.match(shader, /void main\(\)\{\s*prepareChapter\(\);\s*if\(uQuality >= 0\.50\) prepareScene\(\);/);
assert.match(shader, /int steps = 42;\s*if\(uQuality > 0\.85\) steps = 64;\s*for\(int i = 0; i < 64; i\+\+\)/);
assert.match(shader, /if\(scene.x < 0\.003\)\{ hit = 1\.0; material = scene.y; break; \}\s*travel \+= max\(scene.x \* 0\.76, 0\.006\);\s*if\(travel > 11\.0\) break;/);
const normalBody = shader.slice(shader.indexOf('    vec3 normalAt'), shader.indexOf('    vec3 dayPalette'));
assert.equal((normalBody.match(/sceneMap\(/g) || []).length, 6);
assert.match(normalBody, /vec2 e = vec2\(0\.0015, 0\.0\)/);
const mapBody = shader.slice(shader.indexOf('    vec2 sceneMap'), shader.indexOf('    vec3 normalAt'));
assert.doesNotMatch(mapBody, /chapterKey|densityValue|ringShape|ringCount|topologyValue|cos\(/);
assert.match(mapBody, /for\(int i = 0; i < 7; i\+\+\)/);
assert.match(mapBody, /for\(int i = 0; i < 8; i\+\+\)/);

let seed = 0x51a2026;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
let samples = 0, normals = 0, rays = 0, maxError = 0;
const materials = new Set();
function close(a, b, label) {
  if (Array.isArray(a)) { assert.equal(a.length, b.length); a.forEach((x, i) => close(x, b[i], `${label}[${i}]`)); return; }
  assert.ok(Number.isFinite(a) && Number.isFinite(b), `${label}: nonfinite ${a}, ${b}`);
  const error = Math.abs(a - b); maxError = Math.max(maxError, error);
  assert.ok(error <= 2e-11 * Math.max(1, Math.abs(a), Math.abs(b)), `${label}: ${a} != ${b}`);
}
const scrolls = [-.1, 0, 1, 1.1, ...Array.from({ length: 7 }, (_, i) => [i / 6 - 1e-9, i / 6, i / 6 + 1e-9]).flat(),
  ...Array.from({ length: 56 }, random)];
function normal(sample, p) {
  return normalize(p.map((_, axis) => {
    const plus = [...p], minus = [...p]; plus[axis] += .0015; minus[axis] -= .0015;
    return sample(plus)[0] - sample(minus)[0];
  }));
}
function march(sample, ro, rd, steps) {
  let travel = 0, point = ro, material = 0, hit = false, count = 0;
  for (let i = 0; i < steps; i++) {
    count++; point = add(ro, mul(rd, travel)); const scene = sample(point);
    if (scene[0] < .003) { hit = true; material = scene[1]; break; }
    travel += Math.max(scene[0] * .76, .006);
    if (travel > 11) break;
  }
  return { travel, point, material, hit, count };
}
for (const scroll of scrolls) {
  const time = random() * 36000;
  actual.prepare(time, scroll);
  close(actual.chapter(), chapterReference(scroll), 'chapter');
  const expected = p => reference(p, time, scroll);
  const points = [[0, 0, 0], [1e-8, -1e-8, 1e-8], [-1.95, .34, -.9], [2.05, -.4, -1.1]];
  for (let i = 0; i < 28; i++) points.push([random() * 7 - 3.5, random() * 3 - 1.5, random() * 7 - 3.5]);
  for (const point of points) {
    const baseline = expected(point), optimized = actual.sample(point);
    close(optimized[0], baseline[0], 'distance'); assert.equal(optimized[1], baseline[1], 'material');
    materials.add(baseline[1]); samples++;
    close(actual.normal(point), normal(expected, point), 'six-sample normal'); normals++;
  }
  // Both quality budgets, including rays through the lattice and off-center rings.
  for (const steps of [42, 64]) for (let i = 0; i < 4; i++) {
    const p = [random() * 1.8 - .9, random() * 1.2 - .6];
    const ro = [...mul(p, 2.25), 5.6 - scroll * .65], rd = normalize([...p, -2.55]);
    const a = march(actual.sample, ro, rd, steps), b = march(expected, ro, rd, steps);
    assert.equal(a.hit, b.hit); assert.equal(a.material, b.material); assert.equal(a.count, b.count);
    close(a.travel, b.travel, 'ray travel'); close(a.point, b.point, 'ray endpoint'); rays++;
    if (a.hit) close(actual.normal(a.point), normal(expected, b.point), 'hit normal');
  }
}
assert.deepEqual([...materials].sort(), [1, 2, 3, 4, 5], 'exercise every material');
console.log(`Scene field equivalence passed: ${samples} points, ${normals} six-sample normals, ${rays} complete 42/64-step rays; maximum absolute error ${maxError}.`);
