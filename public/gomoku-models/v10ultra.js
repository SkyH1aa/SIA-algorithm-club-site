(function () {
  'use strict';

  const THINK_MS = 75000;
  const MAX_DEPTH = 12;
  const MAX_NODES = 0;
  const MODEL_BASE = new URL('./', document.currentScript?.src || document.baseURI);
  let worker = null;
  let ready = null;
  let requestId = 0;
  let lastSearch = null;
  let filePackagePromise = null;
  let workerBlobUrl = null;
  let generation = 0;

  function workerUrl() {
    // Resolve from this module's public URL so the same wrapper works from
    // `public/gomoku.html` and from the standalone browser validation page.
    return new URL('v10ultra/worker.js', MODEL_BASE).toString();
  }

  function loadFilePackage() {
    if (filePackagePromise) return filePackagePromise;
    filePackagePromise = new Promise((resolve, reject) => {
      if (window.GOMOKU_V10ULTRA_FILE_PACKAGE) {
        resolve(window.GOMOKU_V10ULTRA_FILE_PACKAGE);
        return;
      }
      const script = document.createElement('script');
      script.src = new URL('v10ultra/file-package.js', MODEL_BASE).toString();
      script.onload = () => window.GOMOKU_V10ULTRA_FILE_PACKAGE
        ? resolve(window.GOMOKU_V10ULTRA_FILE_PACKAGE)
        : reject(new Error('V10Ultra 离线资源包内容缺失'));
      script.onerror = () => reject(new Error('V10Ultra 离线资源包加载失败，请重新运行构建脚本'));
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
    if (location.protocol !== 'file:') return { instance: new Worker(workerUrl(), { name: 'gomoku-v10ultra-rapfi' }), assets: null, blobUrl: null };
    // A file:// page has an opaque origin. A direct file:// Worker and binary
    // fetches are blocked, but a Blob Worker inherits the page's origin.
    const pack = await loadFilePackage();
    const blobUrl = URL.createObjectURL(new Blob([pack.rapfiSource, '\n', pack.workerSource], { type: 'text/javascript' }));
    try {
      return {
        instance: new Worker(blobUrl, { name: 'gomoku-v10ultra-rapfi' }),
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
        reject(new Error('V10Ultra 对局已重置'));
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
          reject(new Error(data.error || 'V10Ultra Worker 初始化失败'));
          return;
        }
        if (data.id !== preloadId) return;
        worker.removeEventListener('message', onMessage);
        if (data.type === 'ready') resolve();
        else reject(new Error(data.error || 'V10Ultra 引擎加载失败'));
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', event => reject(new Error(`V10Ultra Worker 加载失败${event.message ? `：${event.message}` : ''}（${event.filename || 'worker'}:${event.lineno || 0}）`)), { once: true });
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
    return gameMoves.map(move => ({
      row: move.row,
      col: move.col,
      piece: move.player === 3 - color ? 'player' : 'ai'
    }));
  }

  function findBestMove() {
    const color = aiColor;
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
          reject(new Error(data.error || 'V10Ultra 未返回合法落点'));
          return;
        }
        lastSearch = { depth: MAX_DEPTH, configuredDepth: MAX_DEPTH, candidates: 0, elapsedMs, aborted: false, reason: 'rapfi-nnue' };
        if (typeof updateExplain === 'function') updateExplain({ ...lastSearch, target: `${data.move.row + 1}, ${data.move.col + 1}`, move: data.move });
        resolve(data.move);
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({
        op: 'think',
        id,
        boardSize: 15,
        timeoutTurnMs: THINK_MS,
        maxDepth: MAX_DEPTH,
        maxNodes: MAX_NODES,
        // The Rapfi bridge names the human side "player". When AI is white,
        // the player is black; when AI is black, the player is white.
        playerIsBlack: color === 2,
        stoneHistory: stoneHistory(color)
      });
    }));
  }

  window.GomokuV10Ultra = {
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
    timeMs: THINK_MS,
    depth: MAX_DEPTH
  };
})();
