(function () {
  'use strict';
  // Gomoku-Satori（内部代号 V11Ge）的页面包装器。展示版定位：
  // 可参与人机对战与模型对战，但**不计积分、不上传训练数据、不写排行榜**
  //（版本号 11 不在任何上传白名单内，前端与边缘函数两侧都拦）。
  //
  // 引擎在独立 Worker 中运行，主线程不被搜索阻塞。HTTP(S) 直接加载
  // satori/worker.js；file:// 下浏览器禁止 file:// 页面创建 file:// Worker，
  // 也不能 fetch 本地脚本，因此用生成的离线包（同样由
  // node tools/build-gomoku-satori-file-package.mjs 产出）构造 Blob Worker。
  // 两种来源跑的是同一份引擎字节，该一致性由
  // tools/test-gomoku-training-policy.mjs 校验。
  const SIZE = 15;
  const DEFAULT_TIME_MS = 16000;
  // 模块加载时解析一次自身 URL：本包装器也会被其它页面的内联脚本引用，
  // 那时 document.currentScript.src 可能为空，路径会退化成页面目录。
  const MODEL_BASE = new URL('./', document.currentScript?.src || document.baseURI);

  let worker = null;
  let workerBlobUrl = null;
  let ready = null;
  let generation = 0;
  let requestId = 0;
  let lastSearch = null;
  let packagePromise = null;
  // 进行中的请求：Worker 被终止（重开对局）时必须逐个 reject，
  // 否则调用方的 await 会永远悬着。
  const pending = new Map();

  function loadPackage() {
    if (packagePromise) return packagePromise;
    packagePromise = new Promise((resolve, reject) => {
      if (window.GOMOKU_SATORI_FILE_PACKAGE) {
        resolve(window.GOMOKU_SATORI_FILE_PACKAGE);
        return;
      }
      const script = document.createElement('script');
      script.src = new URL('satori/file-package.js', MODEL_BASE).toString();
      script.onload = () => window.GOMOKU_SATORI_FILE_PACKAGE
        ? resolve(window.GOMOKU_SATORI_FILE_PACKAGE)
        : reject(new Error('Gomoku-Satori 离线资源包内容缺失'));
      script.onerror = () => reject(new Error('Gomoku-Satori 离线资源包加载失败，请先运行 node tools/build-gomoku-satori-file-package.mjs'));
      document.head.appendChild(script);
    }).catch(error => {
      packagePromise = null;
      throw error;
    });
    return packagePromise;
  }

  function createWorker() {
    if (location.protocol !== 'file:') {
      return Promise.resolve(new Worker(new URL('satori/worker.js', MODEL_BASE)));
    }
    return loadPackage().then(pack => {
      // 引擎源码按 window.GomokuSatori 暴露，Worker 里没有 window，
      // 因此必须在引擎之前先把 window 指向 self。
      const source = 'self.window=self;\n' + pack.engineSource + '\n' + pack.workerSource;
      const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      try {
        workerBlobUrl = blobUrl;
        return new Worker(blobUrl);
      } catch (error) {
        URL.revokeObjectURL(blobUrl);
        workerBlobUrl = null;
        throw error;
      }
    });
  }

  function dispose(reason = 'Gomoku-Satori 对局已重置') {
    if (worker) worker.terminate();
    worker = null;
    if (workerBlobUrl) URL.revokeObjectURL(workerBlobUrl);
    workerBlobUrl = null;
    ready = null;
    for (const request of pending.values()) request.reject(new Error(reason));
    pending.clear();
  }

  function ensureWorker() {
    if (ready) return ready;
    const currentGeneration = generation;
    ready = createWorker().then(instance => new Promise((resolve, reject) => {
      if (currentGeneration !== generation) {
        instance.terminate();
        if (workerBlobUrl) URL.revokeObjectURL(workerBlobUrl);
        workerBlobUrl = null;
        reject(new Error('Gomoku-Satori 对局已重置'));
        return;
      }
      worker = instance;
      const preloadId = ++requestId;
      const onMessage = event => {
        const data = event.data || {};
        if (data.id !== preloadId) return;
        worker.removeEventListener('message', onMessage);
        if (data.type === 'ready') resolve();
        else reject(new Error(data.error || 'Gomoku-Satori 引擎加载失败'));
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', event => {
        const message = 'Gomoku-Satori Worker 加载失败' + (event.message ? '：' + event.message : '');
        if (pending.size) {
          for (const request of pending.values()) request.reject(new Error(message));
          pending.clear();
          dispose(message);
          return;
        }
        reject(new Error(message));
      }, { once: true });
      worker.postMessage({ op: 'preload', id: preloadId });
    })).catch(error => {
      if (currentGeneration === generation) dispose();
      throw error;
    });
    return ready;
  }

  function findBestMove(state = {}) {
    return request(state, null).then((result) => result.move);
  }

  // 展示页专用：同一次搜索，但取回完整决策剖析（威胁普查、候选排序、
  // 逐层迭代、搜索树、VCF/VCT 步骤）。带 trace 的搜索更慢，只有剖析页会走。
  function analyze(state = {}, traceOptions = {}) {
    return request(state, {
      maxEvents: traceOptions.maxEvents || 40000,
      treePly: traceOptions.treePly === undefined ? 3 : traceOptions.treePly,
      treeMax: traceOptions.treeMax || 5000,
      candidatePly: traceOptions.candidatePly === undefined ? 1 : traceOptions.candidatePly
    });
  }

  function request(state, traceOptions) {
    const board = state.board;
    const color = state.color || (typeof aiColor !== 'undefined' ? aiColor : 1);
    if (!board) return Promise.reject(new Error('Gomoku-Satori 缺少棋盘'));
    const id = ++requestId;
    const started = performance.now();
    return ensureWorker().then(() => new Promise((resolve, reject) => {
      const onMessage = event => {
        const data = event.data || {};
        if (data.id !== id) return;
        worker?.removeEventListener('message', onMessage);
        pending.delete(id);
        if (data.type !== 'result' || !data.move) {
          reject(new Error(data.error || 'Gomoku-Satori 未返回合法落点'));
          return;
        }
        lastSearch = { ...(data.stats || {}), elapsedMs: Math.round(performance.now() - started) };
        if (typeof updateExplain === 'function') {
          updateExplain({ ...lastSearch, target: `${data.move.row + 1}, ${data.move.col + 1}`, move: data.move });
        }
        resolve({ move: data.move, stats: lastSearch, trace: data.trace || null });
      };
      worker.addEventListener('message', onMessage);
      pending.set(id, { reject, onMessage });
      worker.postMessage({ op: 'think', id, board, color, timeMs: DEFAULT_TIME_MS, trace: traceOptions || null });
    }));
  }

  window.GomokuSatori = {
    findBestMove,
    analyze,
    preload: ensureWorker,
    clearCache() {
      generation++;
      dispose();
    },
    get lastSearch() { return lastSearch; },
    timeMs: DEFAULT_TIME_MS,
    depth: 32
  };
})();
