(function () {
  'use strict';
  // V10Champion is the V10Ultra Rapfi configuration plus the full training
  // archive as an opening book. Same engine, same Mix9 weights, same 12-ply cap
  // and 75 s budget as V10Ultra; the only addition is a book built from every
  // recorded game in every period (1008 through the newest), which may replace
  // the engine's move in the first four plies when the data supports a different
  // one. Hard tactics and proven wins are checked first and never overridden.
  const SIZE = 15;
  const THINK_MS = 75000;
  const MAX_DEPTH = 12;
  const BASE = new URL('./', document.currentScript?.src || document.baseURI);
  // Same book parameters as V10Flash: a cell needs at least this many recorded
  // games to count, and the book only speaks in the first four own moves.
  const BOOK_MIN_GAMES = 4, BOOK_MAX_MOVE = 4;
  let worker = null, ready = null, requestId = 0, lastSearch = null, generation = 0;
  let filePackagePromise = null, workerBlobUrl = null, priorModel = null;

  function workerUrl() { return new URL('v10champion/worker.js', BASE).toString(); }

  function win(board, row, col, color) {
    return [[1,0],[0,1],[1,1],[1,-1]].some(([dr,dc]) => {
      let total = 1;
      for (const sign of [-1,1]) for (let n=1;n<SIZE;n++) { if (board[row+sign*dr*n]?.[col+sign*dc*n] !== color) break; total++; }
      return total >= 5;
    });
  }

  // Only cells next to a stone can extend a line, so the scans stay local.
  function nearbyEmpty(board) {
    const cells = [], seen = new Set();
    for (let row=0; row<SIZE; row++) for (let col=0; col<SIZE; col++) {
      if (!board[row][col]) continue;
      for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) {
        const r = row+dr, c = col+dc;
        if (r<0 || r>=SIZE || c<0 || c>=SIZE || board[r][c]) continue;
        const key = r*SIZE+c;
        if (seen.has(key)) continue;
        seen.add(key); cells.push([r,c]);
      }
    }
    if (!cells.length) cells.push([(SIZE-1)>>1,(SIZE-1)>>1]);
    return cells;
  }

  function fivePoints(board, color) {
    const points = [];
    for (const [row,col] of nearbyEmpty(board)) {
      board[row][col] = color;
      const made = win(board, row, col, color);
      board[row][col] = 0;
      if (made) points.push([row,col]);
    }
    return points;
  }

  // ---- opening book: the full training archive -------------------------------
  function bookPriors() {
    if (priorModel === null) {
      priorModel = (typeof window !== 'undefined' && window.GOMOKU_V10CHAMPION_TRAINING_MODEL) || false;
    }
    return priorModel ? priorModel.priors : null;
  }
  function fold(row, col, rotation, reflected) {
    let r = row, c = reflected ? SIZE - 1 - col : col;
    for (let i = 0; i < rotation; i++) [r, c] = [c, SIZE - 1 - r];
    return [r, c];
  }
  function openingBook(board, color, history) {
    const priors = bookPriors();
    if (!priors) return null;
    const moveNumber = history.filter(m => m.player === color).length + 1;
    if (moveNumber > BOOK_MAX_MOVE) return null;
    const cells = new Map();
    let best = null;
    for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) {
      if (board[row][col]) continue;
      let key = null;
      for (let reflected = 0; reflected < 2; reflected++) for (let rotation = 0; rotation < 4; rotation++) {
        const [r, c] = fold(row, col, rotation, reflected);
        const state = history.map(m => {
          const [mr, mc] = fold(m.row, m.col, rotation, reflected);
          return `${m.player}:${mr},${mc}`;
        }).join(';');
        const candidate = `${color}|${moveNumber}|${state}|${r},${c}`;
        if (key === null || candidate < key) key = candidate;
      }
      const entry = priors[key];
      if (!entry) continue;
      const games = entry.win + entry.loss + (entry.draw || 0);
      if (games < BOOK_MIN_GAMES) continue;
      const score = (entry.win - entry.loss) / (games + 6);
      if (score <= 0) continue;
      cells.set(`${row},${col}`, { score, games, record: { win: entry.win, loss: entry.loss, draw: entry.draw || 0 } });
      if (!best || score > best.score) best = { row, col, score, games };
    }
    return cells.size ? { cells, best } : null;
  }

  function loadFilePackage() {
    if (filePackagePromise) return filePackagePromise;
    filePackagePromise = new Promise((resolve, reject) => {
      if (window.GOMOKU_V10CHAMPION_FILE_PACKAGE) { resolve(window.GOMOKU_V10CHAMPION_FILE_PACKAGE); return; }
      const script = document.createElement('script');
      script.src = new URL('v10champion/file-package.js', BASE).toString();
      script.onload = () => window.GOMOKU_V10CHAMPION_FILE_PACKAGE
        ? resolve(window.GOMOKU_V10CHAMPION_FILE_PACKAGE)
        : reject(new Error('V10Champion 离线资源包内容缺失'));
      script.onerror = () => reject(new Error('V10Champion 离线资源包加载失败，请先运行 node tools/build-gomoku-v10champion-file-package.mjs'));
      document.head.appendChild(script);
    }).catch(error => { filePackagePromise = null; throw error; });
    return filePackagePromise;
  }

  const decodeBase64 = base64 => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  };

  async function createWorker() {
    if (location.protocol !== 'file:') return { instance: new Worker(workerUrl(), { name: 'gomoku-v10champion' }), assets: null, blobUrl: null };
    const pack = await loadFilePackage();
    const blobUrl = URL.createObjectURL(new Blob([pack.rapfiSource, '\n', pack.workerSource], { type: 'text/javascript' }));
    try {
      return { instance: new Worker(blobUrl, { name: 'gomoku-v10champion' }), assets: { wasm: decodeBase64(pack.wasmBase64), data: decodeBase64(pack.dataBase64) }, blobUrl };
    } catch (error) { URL.revokeObjectURL(blobUrl); throw error; }
  }

  function ensureWorker() {
    if (ready) return ready;
    const currentGeneration = generation;
    ready = createWorker().then(({ instance, assets, blobUrl }) => new Promise((resolve, reject) => {
      if (currentGeneration !== generation) { instance.terminate(); if (blobUrl) URL.revokeObjectURL(blobUrl); reject(new Error('V10Champion 对局已重置')); return; }
      worker = instance; workerBlobUrl = blobUrl;
      const preloadId = ++requestId;
      const onMessage = event => {
        const data = event.data || {};
        if (data.type === 'loading') { if (typeof updateExplain === 'function') updateExplain({ reason: 'loading', progress: data.progress }); return; }
        if (data.type === 'error' && data.id === 0) { worker.removeEventListener('message', onMessage); reject(new Error(data.error || 'V10Champion Worker 初始化失败')); return; }
        if (data.id !== preloadId) return;
        worker.removeEventListener('message', onMessage);
        if (data.type === 'ready') resolve(); else reject(new Error(data.error || 'V10Champion 引擎加载失败'));
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', event => reject(new Error(`V10Champion Worker 加载失败${event.message ? `：${event.message}` : ''}`)), { once: true });
      worker.postMessage({ op: 'preload', id: preloadId, inlineAssets: assets }, assets ? [assets.wasm, assets.data] : []);
    })).catch(error => {
      if (currentGeneration === generation) {
        worker?.terminate(); worker = null;
        if (workerBlobUrl) URL.revokeObjectURL(workerBlobUrl);
        workerBlobUrl = null; ready = null;
      }
      throw error;
    });
    return ready;
  }

  function stoneHistory(history, color) {
    return (history || []).map(move => ({
      row: move.row, col: move.col,
      piece: move.player === 3 - color ? 'player' : 'ai'
    }));
  }

  async function findBestMove(state) {
    const boardState = (state && state.board) || (typeof board !== 'undefined' ? board : null);
    const colorState = (state && state.color) || (typeof aiColor !== 'undefined' ? aiColor : 1);
    const hist = (state && state.history) || (typeof gameMoves !== 'undefined' ? gameMoves : []);
    if (!boardState) throw new Error('V10Champion 缺少棋盘');

    // Hard tactics first: exact, and never overridden by the book.
    const wins = fivePoints(boardState, colorState);
    if (wins.length) {
      lastSearch = { reason: 'immediate-win', depth: 0, candidates: wins.length, elapsedMs: 0 };
      return { row: wins[0][0], col: wins[0][1] };
    }
    const blocks = fivePoints(boardState, 3 - colorState);
    if (blocks.length) {
      lastSearch = { reason: 'forced-block', depth: 0, candidates: blocks.length, elapsedMs: 0 };
      return { row: blocks[0][0], col: blocks[0][1] };
    }

    const book = openingBook(boardState, colorState, hist);
    await ensureWorker();
    const id = ++requestId;
    const started = performance.now();
    const result = await new Promise((resolve, reject) => {
      const onMessage = event => {
        const data = event.data || {};
        if (data.type === 'loading') return;
        if (data.id !== id) return;
        worker.removeEventListener('message', onMessage);
        if (data.type !== 'result' || !data.move) { reject(new Error(data.error || 'V10Champion 未返回合法落点')); return; }
        resolve(data);
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({
        op: 'think', id, boardSize: SIZE,
        timeoutTurnMs: THINK_MS, maxDepth: MAX_DEPTH, maxNodes: 0,
        playerIsBlack: colorState === 2,
        stoneHistory: stoneHistory(hist, colorState)
      });
    });
    const elapsedMs = Math.round(performance.now() - started);
    const engineMove = result.move;
    // The book only speaks when the engine's own move has no support in the data.
    const bookEntry = book ? book.cells.get(`${engineMove.row},${engineMove.col}`) : null;
    const useBook = book && !bookEntry && book.best;
    const move = useBook ? { row: book.best.row, col: book.best.col } : engineMove;
    lastSearch = {
      ...(result.stats || {}),
      depth: MAX_DEPTH,
      configuredDepth: MAX_DEPTH,
      reason: useBook ? 'opening-book' : 'rapfi-nnue-champion',
      elapsedMs,
      book: useBook
        ? { move, score: Number(book.best.score.toFixed(3)), games: book.best.games, engineMove }
        : bookEntry ? { move: engineMove, score: Number(bookEntry.score.toFixed(3)), games: bookEntry.games, agreed: true } : null
    };
    if (typeof updateExplain === 'function') updateExplain({ ...lastSearch, target: `${move.row + 1}, ${move.col + 1}`, move });
    return move;
  }

  window.GomokuV10Champion = {
    findBestMove,
    preload: ensureWorker,
    bookFor: (board, color, history) => openingBook(board, color, history || []),
    clearCache() {
      generation++;
      if (worker) worker.terminate();
      if (workerBlobUrl) URL.revokeObjectURL(workerBlobUrl);
      worker = null; workerBlobUrl = null; ready = null;
    },
    get lastSearch() { return lastSearch; },
    timeMs: THINK_MS,
    depth: MAX_DEPTH
  };
})();
