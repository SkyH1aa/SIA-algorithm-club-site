(function () {
  'use strict';
  const base = new URL('./', document.currentScript.src);
  const specs = {
    'slowrenju': { label: 'V10 实验 · SlowRenju', timeMs: 120000 },
    'gomokuzero': { label: 'V10 实验 · GomokuZero', timeMs: 120000 }
  };
  let filePackage;
  function loadFilePackage() {
    return filePackage ||= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('file-package.js', base).href;
      script.onload = () => window.GOMOKU_EXPERIMENT_FILE_PACKAGE
        ? resolve(window.GOMOKU_EXPERIMENT_FILE_PACKAGE) : reject(new Error('实验模型离线包缺失'));
      script.onerror = () => reject(new Error('实验模型离线包加载失败'));
      document.head.append(script);
    }).catch(error => { filePackage = null; throw error; });
  }
  function decode(s) {
    return Uint8Array.from(atob(s), x => x.charCodeAt(0)).buffer;
  }
  function create(name) {
    let worker = null, ready = null, generation = 0, sequence = 0, blobUrl = null;
    const pending = new Map();
    let lastSearch = null;
    function clearCache() {
      generation++;
      worker?.terminate(); worker = null; ready = null;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = null;
      for (const request of pending.values()) request.reject(new Error('实验对局已重置'));
      pending.clear();
    }
    async function ensure() {
      if (ready) return ready;
      const currentGeneration = generation;
      ready = (async () => {
        let assets;
        if (location.protocol === 'file:') {
          const pack = (await loadFilePackage())[name];
          if (currentGeneration !== generation) throw new Error('实验对局已重置');
          blobUrl = URL.createObjectURL(new Blob([pack.source], { type: 'text/javascript' }));
          worker = new Worker(blobUrl);
          assets = { wasm: decode(pack.wasm) };
          if (name === 'gomokuzero') { assets.mjs = pack.mjs; assets.model = decode(pack.model); }
        } else {
          if (currentGeneration !== generation) throw new Error('实验对局已重置');
          worker = new Worker(new URL(name + '/worker.js', base), { name: 'gomoku-' + name });
        }
        worker.onmessage = ({ data }) => {
          const request = pending.get(data.id);
          if (!request) return;
          if (data.type === 'progress') {
            request.best = data;
            request.onProgress?.(data);
            return;
          }
          pending.delete(data.id);
          data.type === 'error' ? request.reject(new Error(data.error)) : request.resolve(data);
        };
        worker.onerror = event => {
          for (const request of pending.values()) request.reject(new Error(event.message || 'Worker failed'));
          pending.clear();
        };
        await send({ op: 'preload', assets }, assets ? Object.values(assets).filter(v => v instanceof ArrayBuffer) : []);
      })().catch(error => { if (currentGeneration === generation) clearCache(); throw error; });
      return ready;
    }
    function send(data, transfer = [], onProgress) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject, onProgress });
        worker.postMessage({ ...data, id }, transfer);
      });
    }
    async function findBestMove(state = { board, color: aiColor }) {
      await ensure();
      const started = performance.now();
      const result = await send({ op: 'think', board: state.board, color: state.color, timeMs: specs[name].timeMs }, [],
        progress => window.updateExplain?.(progress.stats));
      lastSearch = { ...result.stats, elapsedMs: Math.round(performance.now() - started) };
      window.updateExplain?.({ ...lastSearch, target: `${result.move.row + 1}, ${result.move.col + 1}` });
      return result.move;
    }
    return { ...specs[name], findBestMove, clearCache, preload: ensure, get lastSearch() { return lastSearch; } };
  }
  window.GomokuExperiments = Object.fromEntries(Object.keys(specs).map(name => [name, create(name)]));
})();
