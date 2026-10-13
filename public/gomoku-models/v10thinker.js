(function () {
  'use strict';
  // V10Thinker (10.5) is V10Ultra's Rapfi setup with a deeper, fixed search: the
  // same engine and Mix9 weight bytes, the same 75 s budget, but a 16-ply cap
  // instead of 12. Measured on a recorded midgame position, a 12-ply cap reports
  // a quiet -858 while the position is already a proven loss; 14 plies sees the
  // mate for about 0.9 s, and 14 and 16 cost the same there. A 20-ply cap was
  // measured to stall moves for 85-120 s, which is why it is not used. The
  // factory stays exported so the arena can still build other depths.
  const SIZE = 15, DEFAULT_TIME_MS = 75000, DEFAULT_DEPTH = 16;
  // Resolve this module's own URL once, while document.currentScript is still
  // valid: the factory is also called from other pages' inline scripts, where
  // currentScript.src is empty and the base would otherwise fall back to the
  // page directory.
  const MODEL_BASE = new URL('./', document.currentScript?.src || document.baseURI);

  function create({ depth = DEFAULT_DEPTH, timeMs = DEFAULT_TIME_MS, name = 'gomoku-v10thinker' } = {}) {
    const MAX_DEPTH = depth;
    let worker = null;
    let ready = null;
    let requestId = 0;
    let lastSearch = null;
    let filePackagePromise = null;
    let workerBlobUrl = null;
    let generation = 0;

    function workerUrl() {
      return new URL('v10thinker/worker.js', MODEL_BASE).toString();
    }

    function loadFilePackage() {
      if (filePackagePromise) return filePackagePromise;
      filePackagePromise = new Promise((resolve, reject) => {
        if (window.GOMOKU_V10THINKER_FILE_PACKAGE) {
          resolve(window.GOMOKU_V10THINKER_FILE_PACKAGE);
          return;
        }
        const script = document.createElement('script');
        script.src = new URL('v10thinker/file-package.js', MODEL_BASE).toString();
        script.onload = () => window.GOMOKU_V10THINKER_FILE_PACKAGE
          ? resolve(window.GOMOKU_V10THINKER_FILE_PACKAGE)
          : reject(new Error('V10Thinker 离线资源包内容缺失'));
        script.onerror = () => reject(new Error('V10Thinker 离线资源包加载失败，请先运行 node tools/build-gomoku-v10thinker-file-package.mjs'));
        document.head.appendChild(script);
      }).catch(error => {
        filePackagePromise = null;
        throw error;
      });
      return filePackagePromise;
    }

    function decodeBase64(base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    }

    async function createWorker() {
      if (location.protocol !== 'file:') return { instance: new Worker(workerUrl(), { name }), assets: null, blobUrl: null };
      // A file:// page has an opaque origin: a direct file:// Worker and binary
      // fetches are blocked, but a Blob Worker inherits the page's origin.
      const pack = await loadFilePackage();
      const blobUrl = URL.createObjectURL(new Blob([pack.rapfiSource, '\n', pack.workerSource], { type: 'text/javascript' }));
      try {
        return {
          instance: new Worker(blobUrl, { name }),
          assets: { wasm: decodeBase64(pack.wasmBase64), data: decodeBase64(pack.dataBase64) },
          blobUrl
        };
      } catch (error) {
        URL.revokeObjectURL(blobUrl);
        throw error;
      }
    }

    function ensureWorker() {
      if (ready) return ready;
      const currentGeneration = generation;
      ready = createWorker().then(({ instance, assets, blobUrl }) => new Promise((resolve, reject) => {
        if (currentGeneration !== generation) {
          instance.terminate();
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          reject(new Error('V10Thinker 对局已重置'));
          return;
        }
        worker = instance;
        workerBlobUrl = blobUrl;
        const preloadId = ++requestId;
        const onMessage = event => {
          const data = event.data || {};
          if (data.type === 'loading') {
            if (typeof updateExplain === 'function') updateExplain({ reason: 'loading', progress: data.progress });
            return;
          }
          if (data.type === 'error' && data.id === 0) {
            worker.removeEventListener('message', onMessage);
            reject(new Error(data.error || 'V10Thinker Worker 初始化失败'));
            return;
          }
          if (data.id !== preloadId) return;
          worker.removeEventListener('message', onMessage);
          if (data.type === 'ready') resolve();
          else reject(new Error(data.error || 'V10Thinker 引擎加载失败'));
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', event => reject(new Error(`V10Thinker Worker 加载失败${event.message ? `：${event.message}` : ''}`)), { once: true });
        worker.postMessage({ op: 'preload', id: preloadId, inlineAssets: assets }, assets ? [assets.wasm, assets.data] : []);
      })).catch(error => {
        if (currentGeneration === generation) {
          worker?.terminate();
          worker = null;
          if (workerBlobUrl) URL.revokeObjectURL(workerBlobUrl);
          workerBlobUrl = null;
          ready = null;
        }
        throw error;
      });
      return ready;
    }

    function stoneHistory(color) {
      return (typeof gameMoves !== 'undefined' ? gameMoves : []).map(move => ({
        row: move.row,
        col: move.col,
        piece: move.player === 3 - color ? 'player' : 'ai'
      }));
    }

    function findBestMove() {
      const color = typeof aiColor !== 'undefined' ? aiColor : 1;
      const id = ++requestId;
      const started = performance.now();
      return ensureWorker().then(() => new Promise((resolve, reject) => {
        const onMessage = event => {
          const data = event.data || {};
          if (data.type === 'loading') return;
          if (data.id !== id) return;
          worker.removeEventListener('message', onMessage);
          const elapsedMs = Math.round(performance.now() - started);
          if (data.type !== 'result' || !data.move) {
            reject(new Error(data.error || 'V10Thinker 未返回合法落点'));
            return;
          }
          lastSearch = { ...(data.stats || {}), depth: MAX_DEPTH, configuredDepth: MAX_DEPTH, elapsedMs, aborted: false, reason: 'rapfi-thinker' };
          if (typeof updateExplain === 'function') updateExplain({ ...lastSearch, target: `${data.move.row + 1}, ${data.move.col + 1}`, move: data.move });
          resolve(data.move);
        };
        worker.addEventListener('message', onMessage);
        worker.postMessage({
          op: 'think',
          id,
          boardSize: SIZE,
          timeoutTurnMs: timeMs,
          maxDepth: MAX_DEPTH,
          maxNodes: 0,
          playerIsBlack: color === 2,
          stoneHistory: stoneHistory(color)
        });
      }));
    }

    return {
      findBestMove,
      clearCache() {
        generation++;
        if (worker) worker.terminate();
        if (workerBlobUrl) URL.revokeObjectURL(workerBlobUrl);
        worker = null;
        workerBlobUrl = null;
        ready = null;
      },
      get lastSearch() { return lastSearch; },
      timeMs,
      depth: MAX_DEPTH
    };
  }

  window.GomokuV10ThinkerFactory = create;
  window.GomokuV10Thinker = create();
})();
