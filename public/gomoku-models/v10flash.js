(function () {
  'use strict';
  // Rapfi plan: a 120 s ceiling with a 16-ply cap, so ordinary positions finish
  // long before the ceiling and tactical ones may use the whole budget.
  const SIZE = 15, THINK_MS = 120000, MAX_DEPTH = 16;
  // Expert fusion budgets, mirroring V10Exp's decision layer.
  const EXPERT_MS = 42000, PROOF_NEURAL_MS = 6500, PROOF_ALTERNATIVE_MS = 5500;
  const base = new URL('./', document.currentScript?.src || document.baseURI);
  let generation = 0, sequence = 0, ready = null, lastSearch = null, packagePromise = null;
  const slots = new Map();
  const same = (a, b) => a && b && a.row === b.row && a.col === b.col;

  // ---- freestyle threat model ------------------------------------------------
  // Five or more in a row wins and freestyle has no forbidden moves, so the
  // decisive shapes are: five; open four (·XXXX·, two ways to five, unstoppable);
  // four (one way to five, which forces the opponent to block); and open three
  // (·XXX·, which threatens to become an open four). Full VCT search over open
  // threes is deliberately NOT played from here: an open three is only decisive
  // if neither side has a faster line, so it is detected and reported while the
  // engine and the experts keep deciding.
  const DIRS = [[0,1],[1,0],[1,1],[1,-1]];

  function win(board, row, col, color) {
    for (const [dr,dc] of DIRS) {
      let total = 1;
      for (const sign of [-1,1]) for (let n=1;n<SIZE;n++) {
        if (board[row+sign*dr*n]?.[col+sign*dc*n] !== color) break;
        total++;
      }
      if (total >= 5) return true;
    }
    return false;
  }

  // A cell can only complete five if it touches an existing stone, so every
  // tactical scan below looks at the neighbours of the stones instead of all
  // 225 cells. That is both sound and much cheaper than a full-board sweep.
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

  function lineCells(row, col) {
    const cells = [];
    for (const [dr,dc] of DIRS) for (let off=-4; off<=4; off++) {
      if (!off) continue;
      const r = row+dr*off, c = col+dc*off;
      if (r<0 || r>=SIZE || c<0 || c>=SIZE) continue;
      cells.push([r,c]);
    }
    return cells;
  }

  // Empty cells that would make five, on the four lines through a cell that
  // already holds `color`. These are the completion points of the fours that
  // stone takes part in.
  function linePoints(board, row, col, color) {
    const points = [];
    for (const [r,c] of lineCells(row,col)) {
      if (board[r][c]) continue;
      board[r][c] = color;
      const made = win(board, r, c, color);
      board[r][c] = 0;
      if (made) points.push([r,c]);
    }
    return points;
  }

  // Board-wide "can color make five right now" check.
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

  // (row,col) already holds `color`: does it threaten an open four next move?
  function openThreeAt(board, row, col, color) {
    for (const [r,c] of lineCells(row,col)) {
      if (board[r][c]) continue;
      board[r][c] = color;
      const points = linePoints(board, r, c, color);
      board[r][c] = 0;
      if (points.length >= 2) return true;
    }
    return false;
  }

  // Threat census for reporting: how many moves create each decisive shape.
  function countThreats(board, color) {
    const counts = { openFour: 0, four: 0, openThree: 0 };
    for (const [row,col] of nearbyEmpty(board)) {
      board[row][col] = color;
      const points = linePoints(board, row, col, color);
      if (points.length >= 2) counts.openFour++;
      else if (points.length === 1) counts.four++;
      else if (openThreeAt(board, row, col, color)) counts.openThree++;
      board[row][col] = 0;
    }
    return counts;
  }

  // Exact forced win by continuous fours (VCF): every one of our moves threatens
  // five, so the opponent has exactly one legal answer, and the chain ends in
  // five. Only five threats are searched, which is what makes the result sound.
  // Returns the first move of a proven line, or null.
  const VCF_BUDGET_MS = 400, VCF_MAX_DEPTH = 10;
  function vcfWin(board, color, deadline, depth) {
    if (depth <= 0 || performance.now() > deadline) return null;
    const opponent = 3 - color;
    // If the opponent can make five right now, a four chase cannot save us.
    if (fivePoints(board, opponent).length) return null;
    for (const [row,col] of nearbyEmpty(board)) {
      board[row][col] = color;
      if (win(board,row,col,color)) { board[row][col] = 0; return {row,col}; }
      const mine = linePoints(board, row, col, color);
      if (mine.length >= 2) {
        // Two ways to five cannot both be blocked, unless the opponent wins first.
        const refuted = fivePoints(board, opponent).length > 0;
        board[row][col] = 0;
        if (!refuted) return {row,col};
        continue;
      }
      if (mine.length === 1) {
        const [br,bc] = mine[0];
        board[br][bc] = opponent;
        const continued = vcfWin(board, color, deadline, depth-1);
        board[br][bc] = 0;
        board[row][col] = 0;
        if (continued) return {row,col};
        continue;
      }
      board[row][col] = 0;
    }
    return null;
  }

  // ---- opening book ----------------------------------------------------------
  // Prior learned from the games inside V10Flash's data boundary. It mirrors
  // v10-core.js exactly: the same eight-fold transform, the same canonical key
  // shape, the same AI-move cap and the same smoothed score. Hard tactics and
  // proven wins are checked before this and are never overridden by data.
  const BOOK_MIN_GAMES = 4, BOOK_MAX_MOVE = 4;
  let priorModel = null;
  function bookPriors() {
    if (priorModel === null) {
      priorModel = (typeof window !== 'undefined' && window.GOMOKU_V10FLASH_TRAINING_MODEL) || false;
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

  function stoneHistory(history, color) {
    return (history || []).map(m => ({ row: m.row, col: m.col, piece: m.player === color ? 'ai' : 'player' }));
  }

  // ---- workers: Rapfi engine and the expert system ---------------------------
  function loadScript(src, globalName, missingMessage) {
    return new Promise((resolve, reject) => {
      if (window[globalName]) { resolve(window[globalName]); return; }
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => window[globalName] ? resolve(window[globalName]) : reject(new Error(missingMessage));
      script.onerror = () => reject(new Error(missingMessage));
      document.head.appendChild(script);
    });
  }

  function loadFilePackage() {
    if (packagePromise) return packagePromise;
    // The Rapfi engine and Mix9 weights are byte-identical to V10Ultra's and live
    // only in its package; this one carries the Flash bridge plus the frozen
    // expert/proof/training sources. Both are needed to build the Blob Workers.
    packagePromise = Promise.all([
      loadScript(new URL('v10ultra/file-package.js', base).toString(), 'GOMOKU_V10ULTRA_FILE_PACKAGE',
        'V10Ultra 离线资源包加载失败，请先运行 node tools/build-gomoku-v10ultra-file-package.mjs'),
      loadScript(new URL('v10flash/file-package.js', base).toString(), 'GOMOKU_V10FLASH_FILE_PACKAGE',
        'V10Flash 离线资源包加载失败，请先运行 node tools/build-gomoku-v10flash.mjs')
    ]).then(([engine, own]) => Object.assign({}, own, {
      rapfiSource: engine.rapfiSource,
      wasmBase64: engine.wasmBase64,
      dataBase64: engine.dataBase64
    })).catch(error => { packagePromise = null; throw error; });
    return packagePromise;
  }

  const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0)).buffer;

  function dispose(name) {
    const slot = slots.get(name);
    if (!slot) return;
    slot.worker.terminate();
    if (slot.url) URL.revokeObjectURL(slot.url);
    for (const pending of slot.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('V10Flash 搜索已停止')); }
    slots.delete(name);
  }

  function clearCache() {
    generation++;
    ready = null;
    for (const name of [...slots.keys()]) dispose(name);
  }

  async function create(name) {
    if (slots.has(name)) return slots.get(name);
    const gen = generation;
    let worker, url = null, assets = null;
    const expert = name !== 'rapfi';
    if (location.protocol === 'file:') {
      // A file:// page has an opaque origin: a direct Worker and binary fetches
      // are blocked, so the same sources and bytes travel through a Blob Worker.
      const pack = await loadFilePackage();
      if (gen !== generation) throw new Error('V10Flash 对局已重置');
      const source = expert
        ? 'self.window=self;\n' + pack.expert + '\n' + pack.thinker + '\n' + pack.v10core + '\n' + pack.v10 + '\n' + pack.training + '\n' + pack.proof + '\n' + pack.expertWorker
        : pack.rapfiSource + '\n' + pack.workerSource;
      url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      worker = new Worker(url, { name: `gomoku-v10flash-${name}` });
      if (!expert) assets = { wasm: decode(pack.wasmBase64), data: decode(pack.dataBase64) };
    } else {
      worker = new Worker(new URL(`v10flash/${expert ? 'expert-worker' : 'worker'}.js`, base), { name: `gomoku-v10flash-${name}` });
    }
    const slot = { worker, url, pending: new Map(), busy: false };
    slots.set(name, slot);
    worker.onmessage = ({ data }) => {
      if (data.type === 'loading') return;
      const pending = slot.pending.get(data.id);
      if (!pending) return;
      if (data.type === 'progress') { pending.progress?.(data); return; }
      clearTimeout(pending.timer);
      slot.pending.delete(data.id);
      slot.busy = false;
      data.type === 'error' ? pending.reject(new Error(data.error)) : pending.resolve(data);
    };
    worker.onerror = event => {
      for (const pending of slot.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(event.message || 'V10Flash Worker failed')); }
      slot.pending.clear();
      slot.busy = false;
    };
    await request(name, { op: 'preload', inlineAssets: assets }, null, 60000, assets ? [assets.wasm, assets.data] : []);
    return slot;
  }

  function request(name, req, progress, timeoutMs = THINK_MS, transfer = []) {
    const slot = slots.get(name);
    if (!slot) return Promise.reject(new Error(`V10Flash ${name} 未就绪`));
    const id = ++sequence;
    slot.busy = true;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { slot.pending.delete(id); reject(new Error(`V10Flash ${name} 超时`)); dispose(name); }, timeoutMs);
      slot.pending.set(id, { resolve, reject, timer, progress });
      slot.worker.postMessage({ ...req, id }, transfer);
    });
  }

  function preload() {
    return ready ||= Promise.all(['rapfi', 'thinker', 'v10', 'proof'].map(create))
      .catch(error => { clearCache(); throw error; });
  }

  // ---- decision layer --------------------------------------------------------
  async function findBestMove(state) {
    const boardState = (state && state.board) || (typeof board !== 'undefined' ? board : null);
    const colorState = (state && state.color) || (typeof aiColor !== 'undefined' ? aiColor : 1);
    const hist = (state && state.history) || (typeof gameMoves !== 'undefined' ? gameMoves : []);
    const report = (reason, move, extra) => {
      lastSearch = { reason, elapsedMs: 0, threats: countThreats(boardState, colorState), ...extra };
      return move;
    };

    // 1. Hard tactics first: they are exact and never overridden by data.
    const wins = fivePoints(boardState, colorState);
    if (wins.length) return report('immediate-win', { row: wins[0][0], col: wins[0][1] }, { depth: 0, candidates: wins.length });
    const blocks = fivePoints(boardState, 3 - colorState);
    if (blocks.length) return report('forced-block', { row: blocks[0][0], col: blocks[0][1] }, { depth: 0, candidates: blocks.length });

    // 2. Our own threat layer: a proven four chase is played at once.
    const tacticsStarted = performance.now();
    const proofWin = vcfWin(boardState, colorState, tacticsStarted + VCF_BUDGET_MS, VCF_MAX_DEPTH);
    if (proofWin) return report('vcf-win', proofWin, { depth: VCF_MAX_DEPTH, elapsedMs: Math.round(performance.now() - tacticsStarted) });

    // 3. Expert fusion: Rapfi and the two experts search in parallel, and the
    //    independent prover only ever refutes a candidate that is a proven loss.
    const b = boardState.map(row => row.slice());
    await preload();
    const gen = generation;
    const started = performance.now(), deadline = started + THINK_MS;
    const observations = {}, expertTasks = [];
    let best = null, proven = false, engineMove = null, timer, resolveProof;
    const proofReady = new Promise(resolve => { resolveProof = resolve; });

    function observe(name, data) {
      if (!data.move || b[data.move.row]?.[data.move.col] !== 0) return;
      observations[name] = data;
      if (data.stats?.reason === 'VCF' || data.stats?.reason === 'win') {
        best = data.move; proven = true; resolveProof(best);
      } else if (!best) best = data.move;
      if (typeof updateExplain === 'function') updateExplain({ ...data.stats, target: `${data.move.row + 1}, ${data.move.col + 1}` });
    }

    // Is `move` refuted by our proof layer, or by the independent prover?
    async function safe(move, timeMs) {
      const next = b.map(row => row.slice());
      next[move.row][move.col] = colorState;
      if (fivePoints(next, 3 - colorState).length) return { proved: true, reason: 'immediate-loss' };
      if (!slots.has('proof')) await create('proof');
      return (await request('proof', { op: 'proof', board: next, color: 3 - colorState,
        history: [...hist, { row: move.row, col: move.col, player: colorState }], timeMs }, null, timeMs + 2000)).proof;
    }

    let bookInfo = null;
    const search = (async () => {
      for (const name of ['thinker', 'v10']) {
        if (!slots.has(name)) await create(name);
        expertTasks.push(request(name, { op: 'think', engine: name, board: b, color: colorState, history: hist }, data => observe(name, data), EXPERT_MS)
          .then(data => { observe(name, data); return data; })
          .catch(error => ({ error: String(error) })));
      }
      const engine = await request('rapfi', { op: 'think', boardSize: SIZE, timeoutTurnMs: THINK_MS, maxDepth: MAX_DEPTH, maxNodes: 0,
        playerIsBlack: colorState === 2, stoneHistory: stoneHistory(hist, colorState) }, null, THINK_MS + 8000);
      engineMove = engine.move;
      if (b[engineMove.row]?.[engineMove.col] !== 0) throw new Error('V10Flash 引擎返回非法落点');
      if (proven) return { move: best, reason: 'expert-proved-win' };
      const book = openingBook(b, colorState, hist);
      const bookEntry = book ? book.cells.get(`${engineMove.row},${engineMove.col}`) : null;
      const useBook = book && !bookEntry && book.best;
      const chosen = useBook ? { row: book.best.row, col: book.best.col } : engineMove;
      bookInfo = useBook
        ? { move: chosen, score: Number(book.best.score.toFixed(3)), games: book.best.games, engineMove }
        : bookEntry ? { move: engineMove, score: Number(bookEntry.score.toFixed(3)), games: bookEntry.games, agreed: true } : null;
      const proofStart = performance.now();
      const check = await safe(chosen, Math.min(PROOF_NEURAL_MS, Math.max(1, deadline - performance.now() - 2000)));
      if (!check.proved) return { move: chosen, reason: useBook ? 'opening-book' : 'mix9-expert-checked', proof: check, engine: engine.stats };
      await Promise.all(expertTasks);
      const alternatives = [observations.v10?.move, observations.thinker?.move].filter(move => move && !same(move, chosen));
      for (const move of alternatives) {
        if (proven) return { move: best, reason: 'expert-proved-win' };
        const remaining = deadline - performance.now() - 1000;
        if (remaining <= 0) break;
        const alternativeCheck = await safe(move, Math.min(PROOF_ALTERNATIVE_MS, remaining));
        if (!alternativeCheck.proved) {
          return { move, reason: 'expert-rejected-forced-loss', rejected: chosen, proof: check, alternativeProof: alternativeCheck, engine: engine.stats };
        }
      }
      return { move: chosen, reason: 'no-proven-safe-alternative', proof: check, engine: engine.stats };
    })();

    // The watchdog stays responsive while every engine searches off-thread, and
    // only ever returns a completed iteration or a proved move.
    const watchdog = new Promise(resolve => { timer = setTimeout(() => resolve(proven ? best : engineMove || best), THINK_MS); });
    try {
      const outcome = await Promise.race([search, watchdog, proofReady]);
      if (gen !== generation) throw new Error('V10Flash 对局已重置');
      let move = null, reason = 'completed-iteration-deadline', rest = {};
      if (proven) { move = best; reason = 'expert-proved-win'; }
      else if (outcome && outcome.move) { move = outcome.move; reason = outcome.reason || reason; rest = outcome; }
      else if (outcome) move = outcome;
      if (!move) throw new Error('V10Flash 预算结束前未取得完整迭代');
      if (!Number.isInteger(move.row) || !Number.isInteger(move.col) || boardState[move.row]?.[move.col] !== 0) {
        throw new Error(`V10Flash 非法落点 ${JSON.stringify(move)}`);
      }
      lastSearch = {
        ...(rest.engine || {}),
        reason,
        configuredDepth: MAX_DEPTH,
        elapsedMs: Math.round(performance.now() - started),
        threats: countThreats(boardState, colorState),
        book: bookInfo,
        experts: observations,
        proof: rest.proof || null
      };
      if (typeof updateExplain === 'function') {
        updateExplain({ ...lastSearch, target: `${move.row + 1}, ${move.col + 1}`, move });
      }
      return move;
    } finally {
      clearTimeout(timer);
      for (const [name, slot] of slots) if (slot.busy) dispose(name);
      ready = null;
    }
  }

  window.GomokuV10Flash = {
    findBestMove,
    preload,
    // Exposed for the integration and regression checks.
    bookFor: (board, color, history) => openingBook(board, color, history || []),
    threatsFor: (board, color) => countThreats(board, color),
    vcfFor: (board, color, budgetMs) => vcfWin(board, color, performance.now() + (budgetMs || VCF_BUDGET_MS), VCF_MAX_DEPTH),
    clearCache,
    timeMs: THINK_MS,
    depth: MAX_DEPTH,
    get lastSearch() { return lastSearch; }
  };
})();
