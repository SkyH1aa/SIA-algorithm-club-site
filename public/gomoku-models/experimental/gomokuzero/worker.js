// Browser port of maojh15/GomokuZeroAI PUCT (MIT). Unchanged iteration-150
// policy/value weights, FP32 ONNX inference; all legal cells remain candidates.
'use strict';
if (typeof ort === 'undefined') importScripts('../runtime/ort.wasm.min.js');
let session;
let ready;
let chain = Promise.resolve();
const cache = new Map();
function preload(assets) {
  return ready ||= (async () => {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    if (assets) {
      const mjs = URL.createObjectURL(new Blob([assets.mjs], { type: 'text/javascript' }));
      const wasm = URL.createObjectURL(new Blob([assets.wasm], { type: 'application/wasm' }));
      ort.env.wasm.wasmPaths = { mjs, wasm };
    } else ort.env.wasm.wasmPaths = new URL('../runtime/', self.location.href).href;
    session = await ort.InferenceSession.create(assets?.model || new URL('./model.onnx', self.location.href).href,
      { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  })();
}
const directions = [[1,0],[0,1],[1,1],[1,-1]];
function won(board, index, color) {
  const row = Math.floor(index / 15), col = index % 15;
  return directions.some(([dr, dc]) => {
    let n = 1;
    for (const sign of [-1, 1]) for (let i = 1; i < 15; i++) {
      const r = row + dr * sign * i, c = col + dc * sign * i;
      if (r < 0 || r >= 15 || c < 0 || c >= 15 || board[r * 15 + c] !== color) break;
      n++;
    }
    return n >= 5;
  });
}
function immediate(board, color) {
  for (let i = 0; i < 225; i++) if (!board[i]) {
    board[i] = color;
    const win = won(board, i, color);
    board[i] = 0;
    if (win) return i;
  }
  return -1;
}
function node(prior = 1, index = -1) {
  return { prior, index, visits: 0, sum: 0, children: null, pending: false };
}
function select(parent) {
  let best = null, score = -Infinity;
  const scale = 5 * Math.sqrt(Math.max(1, parent.visits));
  for (const child of parent.children) {
    if (child.pending) continue;
    const value = -(child.visits ? child.sum / child.visits : 0) + scale * child.prior / (1 + child.visits);
    if (value > score) { best = child; score = value; }
  }
  return best;
}
function key(board, color) { return color + ':' + board.join(''); }
async function evaluate(batch) {
  const missing = batch.filter(item => !cache.has(item.key));
  if (missing.length) {
    const input = new Float32Array(missing.length * 450);
    missing.forEach(({ board, color }, b) => {
      for (let i = 0; i < 225; i++) if (board[i]) input[b * 450 + (board[i] === color ? 0 : 225) + i] = 1;
    });
    const out = await session.run({ board: new ort.Tensor('float32', input, [missing.length, 2, 15, 15]) });
    missing.forEach((item, b) => {
      const logits = Array.from(out.policy.data.subarray(b * 225, (b + 1) * 225));
      const legal = [];
      for (let i = 0; i < 225; i++) if (!item.board[i]) legal.push(i);
      const max = Math.max(...legal.map(i => logits[i]));
      const probs = legal.map(i => Math.exp(logits[i] - max));
      const sum = probs.reduce((a, b) => a + b, 0);
      cache.set(item.key, { priors: legal.map((i, j) => [i, probs[j] / sum]), value: out.value.data[b] * 2 - 1 });
      if (cache.size > 12000) cache.delete(cache.keys().next().value);
    });
  }
  return batch.map(item => cache.get(item.key));
}
function bestMove(root) {
  return root.children.reduce((best, child) => !best || child.visits > best.visits ||
    (child.visits === best.visits && child.prior > best.prior) ? child : best, null).index;
}
function replyMove(id, index, stats, type = 'result') {
  postMessage({ type, id, move: { row: Math.floor(index / 15), col: index % 15 }, stats });
}
async function think(req) {
  const started = performance.now(), deadline = started + req.timeMs - 2500;
  const board = Uint8Array.from(req.board.flat());
  const count = board.reduce((n, v) => n + !!v, 0);
  if (req.color !== count % 2 + 1) throw new Error('GomokuZero side-to-move mismatch');
  const win = immediate(board, req.color), block = immediate(board, 3 - req.color);
  if (win >= 0 || block >= 0) return replyMove(req.id, win >= 0 ? win : block,
    { depth: 1, simulations: 0, reason: win >= 0 ? 'immediate-win' : 'forced-block' });
  const root = node();
  const first = (await evaluate([{ board, color: req.color, key: key(board, req.color) }]))[0];
  root.children = first.priors.map(([i, p]) => node(p, i));
  let simulations = 0, depth = 0;
  replyMove(req.id, bestMove(root), { simulations, depth }, 'progress');
  // Batch leaf inference using temporary virtual visits. Remove every virtual
  // visit before backup; each Q stays in that node's side-to-move perspective.
  while (simulations < 2000 && performance.now() < deadline) {
    const batch = [];
    for (let b = 0; b < 16 && simulations + batch.length < 2000; b++) {
      const copy = board.slice(), path = [root];
      let current = root, color = req.color, terminal = null;
      while (current.children) {
        const next = select(current);
        if (!next) break;
        copy[next.index] = color;
        current = next; path.push(current); color = 3 - color;
        if (won(copy, next.index, 3 - color)) { terminal = -1; break; }
      }
      if (current.pending || (current.children && terminal === null)) break;
      if (terminal === null && !copy.includes(0)) terminal = 0;
      current.pending = true;
      for (const n of path) { n.visits++; n.sum++; }
      batch.push({ board: copy, color, path, node: current, terminal, key: key(copy, color) });
      depth = Math.max(depth, path.length - 1);
    }
    if (!batch.length) break;
    const leaves = batch.filter(item => item.terminal === null);
    const evaluated = await evaluate(leaves);
    let j = 0;
    for (const item of batch) {
      for (const n of item.path) { n.visits--; n.sum--; }
      item.node.pending = false;
      let value = item.terminal;
      if (value === null) {
        const result = evaluated[j++];
        item.node.children = result.priors.map(([i, p]) => node(p, i));
        value = result.value;
      }
      for (let i = item.path.length - 1; i >= 0; i--) {
        item.path[i].visits++; item.path[i].sum += value; value = -value;
      }
      simulations++;
    }
    replyMove(req.id, bestMove(root), { depth, simulations, elapsedMs: Math.round(performance.now() - started),
      reason: 'gomokuzero-puct' }, 'progress');
  }
  replyMove(req.id, bestMove(root), { depth, simulations, candidates: root.children.length,
    elapsedMs: Math.round(performance.now() - started), aborted: simulations < 2000, reason: 'gomokuzero-puct' });
}
self.onmessage = ({ data }) => {
  chain = chain.then(async () => {
    await preload(data.assets);
    if (data.op === 'preload') postMessage({ id: data.id, type: 'ready' });
    else await think(data);
  }).catch(error => postMessage({ id: data.id, type: 'error', error: error.stack || String(error) }));
};
