'use strict';
if (typeof SlowRenju !== 'function') importScripts('./engine.js');
let instance;
let ready;
let chain = Promise.resolve();
function preload(assets) {
  return ready ||= SlowRenju({
    wasmBinary: assets?.wasm,
    locateFile: name => assets ? name : new URL(name, self.location.href).href,
    print() {}, printErr: text => console.error(text)
  }).then(value => { instance = value; });
}
self.onmessage = ({ data }) => {
  chain = chain.then(async () => {
    await preload(data.assets);
    if (data.op === 'preload') return postMessage({ id: data.id, type: 'ready' });
    const started = performance.now();
    const cells = data.board.flat();
    const count = cells.filter(Boolean).length;
    if (data.color !== count % 2 + 1) throw new Error('SlowRenju side-to-move mismatch');
    const ptr = instance._malloc(225 * 4);
    try {
      instance.HEAP32.set(cells, ptr / 4);
      const index = instance._choose(ptr, data.timeMs - 500);
      if (index < 0 || index >= 225 || cells[index]) throw new Error('SlowRenju returned an illegal move');
      const status = instance.UTF8ToString(instance._status()).split(';');
      postMessage({ id: data.id, type: 'result', move: { row: Math.floor(index / 15), col: index % 15 },
        stats: { depth: Number(status[3]) || 0, score: Number(status[4]) || 0,
          nodes: instance._nodes(), elapsedMs: Math.round(performance.now() - started), reason: 'slowrenju-wasm' } });
    } finally { instance._free(ptr); }
  }).catch(error => postMessage({ id: data.id, type: 'error', error: error.stack || String(error) }));
};
