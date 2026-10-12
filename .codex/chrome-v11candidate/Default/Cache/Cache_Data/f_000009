/* Shared expert search for 9.1/9.2 only. Historical engines never call it. */
(function () {
  'use strict';
  const N = 225, AXES = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const POW = Array.from({ length: 8 }, (_, i) => 3 ** i);
  const FIVE = 7, OPEN4 = 6, FOUR = 5, OPEN3 = 4, THREE = 3, TWO = 2, ONE = 1;
  const MATE = 100000000, W4 = 1000000, W43 = 300000, W33 = 100000, WFOUR = 10000, W3 = 1000;
  const weights = [0, 2, 40, 100, W3, WFOUR, W4, MATE];
  const patterns = new Uint8Array(6561);
  // All five-cell windows must contain the candidate (index 4). Count
  // distinct completion cells: a gapped four has ONE, an open four has TWO.
  function winningCells(line) {
    let mask = 0;
    for (let start = 0; start <= 4; start++) {
      let empty = -1, own = 0;
      for (let i = start; i < start + 5; i++) {
        if (line[i] === 2) { own = -10; break; }
        if (line[i] === 1) own++; else empty = i;
      }
      if (own === 5) return -1;
      if (own === 4) mask |= 1 << empty;
    }
    return mask;
  }
  function multiple(mask) { return mask > 0 && (mask & (mask - 1)) !== 0; }
  for (let code = 0; code < patterns.length; code++) {
    const line = new Uint8Array(9); line[4] = 1;
    let value = code;
    for (let i = 0; i < 9; i++) if (i !== 4) { line[i] = value % 3; value = Math.floor(value / 3); }
    const wins = winningCells(line);
    if (wins === -1) { patterns[code] = FIVE; continue; }
    if (wins) { patterns[code] = multiple(wins) ? OPEN4 : FOUR; continue; }
    let open3 = false, three = false, two = false, one = false;
    for (let i = 0; i < 9; i++) if (!line[i]) {
      line[i] = 1;
      const next = winningCells(line);
      open3 ||= multiple(next); three ||= next > 0;
      line[i] = 0;
    }
    if (open3 || three) { patterns[code] = open3 ? OPEN3 : THREE; continue; }
    for (let start = 0; start <= 4; start++) {
      let count = 0, blocked = false;
      for (let i = start; i < start + 5; i++) { count += line[i] === 1 ? 1 : 0; blocked ||= line[i] === 2; }
      if (!blocked) { two ||= count >= 2; one = true; }
    }
    patterns[code] = two ? TWO : one ? ONE : 0;
  }
  const influence = Array.from({ length: N }, () => []);
  const neighbors = Array.from({ length: N }, () => []);
  const codesAt = Array.from({ length: N }, () => []);
  for (let cell = 0; cell < N; cell++) {
    const r = Math.floor(cell / 15), c = cell % 15;
    for (let axis = 0; axis < 4; axis++) {
      const [dr, dc] = AXES[axis];
      const points = [];
      for (let offset = -4, k = 0; offset <= 4; offset++) {
        if (!offset) continue;
        const nr = r + dr * offset, nc = c + dc * offset;
        const other = nr >= 0 && nr < 15 && nc >= 0 && nc < 15 ? nr * 15 + nc : -1;
        points.push(other);
        if (other >= 0) influence[other].push([cell, axis, POW[k]]);
        k++;
      }
      codesAt[cell].push(points);
    }
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const nr = r + dr, nc = c + dc;
      if ((dr || dc) && nr >= 0 && nr < 15 && nc >= 0 && nc < 15) neighbors[cell].push(nr * 15 + nc);
    }
  }
  let seed = 0x713ac921;
  function random() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
  const hashes = Array.from({ length: N }, () => [null, [random(), random()], [random(), random()]]);

  window.createGomokuExpert = function (config) {
    const cells = new Uint8Array(N), nearby = new Uint8Array(N);
    const codes = [null, new Int32Array(N * 4), new Int32Array(N * 4)];
    const scores = [null, new Int32Array(N), new Int32Array(N)];
    const sums = [0, 0, 0];
    const tt = new Map(), killers = Array.from({ length: 64 }, () => []);
    const history = [null, new Int32Array(N), new Int32Array(N)];
    let count = 0, hash1 = 0, hash2 = 0, deadline = 0, aborted = false, nodes = 0, qnodes = 0;
    let rootColor = 1, rootPriors = new Map(), lastSearch = null;

    function pointScore(cell, player) {
      let total = 0, fours = 0, threes = 0;
      for (let axis = 0; axis < 4; axis++) {
        const type = patterns[codes[player][cell * 4 + axis]];
        if (type === FIVE) return MATE;
        if (type === OPEN4) return W4;
        fours += type === FOUR ? 1 : 0; threes += type === OPEN3 ? 1 : 0;
        total += weights[type];
      }
      if (fours >= 2) return W4;
      if (fours && threes) return W43 + total;
      if (threes >= 2) return W33 + total;
      return total;
    }
    function initialize() {
      count = 0; hash1 = hash2 = 0; nearby.fill(0); sums.fill(0);
      for (let i = 0; i < N; i++) {
        const p = board[Math.floor(i / 15)][i % 15]; cells[i] = p;
        if (p) { count++; hash1 ^= hashes[i][p][0]; hash2 ^= hashes[i][p][1]; for (const n of neighbors[i]) nearby[n]++; }
      }
      for (let p = 1; p <= 2; p++) for (let i = 0; i < N; i++) {
        for (let a = 0; a < 4; a++) {
          let code = 0;
          for (let k = 0; k < 8; k++) {
            const n = codesAt[i][a][k], stone = n < 0 ? 3 - p : cells[n];
            code += (stone === p ? 1 : stone ? 2 : 0) * POW[k];
          }
          codes[p][i * 4 + a] = code;
        }
        scores[p][i] = pointScore(i, p);
        if (!cells[i]) sums[p] += scores[p][i];
      }
    }
    function change(cell, p, undo = false) {
      const delta = undo ? -1 : 1;
      if (!undo) { for (let side = 1; side <= 2; side++) sums[side] -= scores[side][cell]; cells[cell] = p; }
      count += delta; hash1 ^= hashes[cell][p][0]; hash2 ^= hashes[cell][p][1];
      for (const n of neighbors[cell]) nearby[n] += delta;
      for (const [n, axis, power] of influence[cell]) {
        for (let side = 1; side <= 2; side++) {
          const previous = scores[side][n];
          codes[side][n * 4 + axis] += delta * (side === p ? 1 : 2) * power;
          scores[side][n] = pointScore(n, side);
          if (!cells[n]) sums[side] += scores[side][n] - previous;
        }
      }
      if (undo) { cells[cell] = 0; for (let side = 1; side <= 2; side++) sums[side] += scores[side][cell]; }
    }
    function stopped() {
      if (aborted) return true;
      if ((nodes & 127) === 0 && performance.now() >= deadline) aborted = true;
      return aborted;
    }
    function immediate(player) {
      const moves = [];
      for (let i = 0; i < N; i++) if (!cells[i] && scores[player][i] >= MATE) moves.push(i);
      return moves;
    }
    function generate(player, preferred = -1, ply = 0, root = false) {
      if (!count) return [112];
      const wins = immediate(player); if (wins.length) return wins;
      const blocks = immediate(3 - player); if (blocks.length) return blocks;
      const all = [];
      for (let i = 0; i < N; i++) if (!cells[i] && nearby[i]) {
        const own = scores[player][i], other = scores[3 - player][i];
        const distance = Math.abs(Math.floor(i / 15) - 7) + Math.abs(i % 15 - 7);
        all.push({ cell: i, score: Math.max(own, other) * 2 + own + other - distance * 0.01,
          prior: root ? rootPriors.get(i) || 0 : 0 });
      }
      // Admission depends only on the position. TT/history/killer ordering
      // must not evict a tactical candidate from this fixed-width search.
      all.sort((a, b) => b.score - a.score || b.prior - a.prior || a.cell - b.cell);
      const moves = all.slice(0, config.candidates);
      moves.sort((a, b) => {
        const order = m => (m.cell === preferred ? 1e15 : 0) + m.score + (killers[ply]?.includes(m.cell) ? 500 : 0) + history[player][m.cell] * 0.01;
        return order(b) - order(a) || b.prior - a.prior || a.cell - b.cell;
      });
      return moves.map(m => m.cell);
    }
    function evaluate(player) {
      let own = 0, other = 0;
      for (let i = 0; i < N; i++) if (!cells[i]) { own = Math.max(own, scores[player][i]); other = Math.max(other, scores[3 - player][i]); }
      return Math.round((sums[player] - sums[3 - player]) * 0.08 + own * 0.8 - other * 0.8);
    }
    function forcingWin(attacker, remaining, ply, limit) {
      nodes++;
      if (stopped() || performance.now() >= limit || remaining <= 0) return -1;
      const wins = immediate(attacker); if (wins.length) return wins[0];
      const blocks = immediate(3 - attacker);
      if (blocks.length > 1) return -1;
      const moves = [];
      for (let i = 0; i < N; i++) if (!cells[i] && scores[attacker][i] >= WFOUR && (!blocks.length || blocks[0] === i)) moves.push(i);
      moves.sort((a, b) => scores[attacker][b] - scores[attacker][a] || a - b);
      for (const move of moves) {
        change(move, attacker);
        const replies = immediate(attacker);
        let proved = false;
        if (!immediate(3 - attacker).length) {
          if (replies.length >= 2) proved = true;
          else if (replies.length === 1 && remaining >= 3) {
            change(replies[0], 3 - attacker);
            proved = forcingWin(attacker, remaining - 2, ply + 2, limit) >= 0;
            change(replies[0], 3 - attacker, true);
          }
        }
        change(move, attacker, true);
        if (proved) return move;
        if (aborted || performance.now() >= limit) break;
      }
      return -1;
    }
    function quiet(player, alpha, beta, ply, remaining) {
      nodes++; qnodes++;
      if (stopped()) return 0;
      const wins = immediate(player); if (wins.length) return MATE - ply;
      const blocks = immediate(3 - player); if (blocks.length > 1) return -MATE + ply + 1;
      if (!remaining) return evaluate(player);
      if (blocks.length) {
        const move = blocks[0]; change(move, player);
        const value = -quiet(3 - player, -beta, -alpha, ply + 1, remaining - 1);
        change(move, player, true); return value;
      }
      // Continue forcing fours at the horizon. Their forced defense is
      // searched, so static evaluation never mistakes a gapped four for mate.
      let best = evaluate(player);
      if (best >= beta) return best;
      alpha = Math.max(alpha, best);
      if (remaining <= 1) return best;
      const moves = [];
      for (let i = 0; i < N; i++) if (!cells[i] && scores[player][i] >= WFOUR) moves.push(i);
      moves.sort((a, b) => scores[player][b] - scores[player][a] || a - b);
      for (const move of moves) {
        change(move, player);
        const value = -quiet(3 - player, -beta, -alpha, ply + 1, remaining - 1);
        change(move, player, true);
        if (aborted) return 0;
        best = Math.max(best, value); alpha = Math.max(alpha, value); if (alpha >= beta) break;
      }
      return best;
    }
    function search(player, depth, alpha, beta, ply) {
      nodes++; if (stopped()) return 0;
      const wins = immediate(player); if (wins.length) return MATE - ply;
      const blocks = immediate(3 - player); if (blocks.length > 1) return -MATE + ply + 1;
      if (count === N) return 0;
      if (depth <= 0) return quiet(player, alpha, beta, ply, config.threatDepth);
      const key = `${hash1 >>> 0},${hash2 >>> 0},${player}`;
      const entry = tt.get(key), alpha0 = alpha, beta0 = beta;
      if (entry && entry.depth >= depth) {
        if (entry.bound === 0) return entry.score;
        if (entry.bound === 1) alpha = Math.max(alpha, entry.score); else beta = Math.min(beta, entry.score);
        if (alpha >= beta) return entry.score;
      }
      const moves = generate(player, entry?.move ?? -1, ply);
      let best = -Infinity, bestMove = moves[0];
      for (let index = 0; index < moves.length; index++) {
        const move = moves[index];
        const tactical = blocks.length || scores[player][move] >= W3 || scores[3 - player][move] >= W3;
        const reduced = index >= 6 && depth >= 3 && beta - alpha === 1 && !tactical;
        change(move, player);
        let value;
        if (!index) value = -search(3 - player, depth - 1, -beta, -alpha, ply + 1);
        else {
          value = -search(3 - player, depth - 1 - (reduced ? 1 : 0), -alpha - 1, -alpha, ply + 1);
          if (!aborted && value > alpha && (reduced || value < beta)) value = -search(3 - player, depth - 1, -beta, -alpha, ply + 1);
        }
        change(move, player, true);
        if (aborted) return 0;
        if (value > best) { best = value; bestMove = move; }
        alpha = Math.max(alpha, value);
        if (alpha >= beta) {
          if (!tactical) { killers[ply] = [move, killers[ply]?.[0]].filter(Number.isInteger).slice(0, 2); history[player][move] = Math.min(20000, history[player][move] + depth * depth); }
          break;
        }
      }
      if (tt.size > 200000) tt.clear();
      tt.set(key, { depth, move: bestMove, score: best, bound: best <= alpha0 ? 2 : best >= beta0 ? 1 : 0 });
      return best;
    }
    function rootSearch(moves, depth, previous, alpha, beta) {
      const ordered = moves.slice().sort((a, b) => (b === previous ? 1 : 0) - (a === previous ? 1 : 0));
      let best = -Infinity, move = ordered[0];
      for (let i = 0; i < ordered.length; i++) {
        const cell = ordered[i]; change(cell, rootColor);
        let value = i === 0 ? -search(3 - rootColor, depth - 1, -beta, -alpha, 1) : -search(3 - rootColor, depth - 1, -alpha - 1, -alpha, 1);
        if (i && !aborted && value > alpha && value < beta) value = -search(3 - rootColor, depth - 1, -beta, -alpha, 1);
        change(cell, rootColor, true);
        if (aborted) return { move, score: best };
        if (value > best) { best = value; move = cell; }
        alpha = Math.max(alpha, value); if (alpha >= beta) break;
      }
      return { move, score: best };
    }
    function trainingPriors() {
      const priors = config.training()?.priors || {}, result = new Map();
      const moveNumber = gameMoves.filter(m => m.player === rootColor).length + 1;
      if (moveNumber > 4) return result;
      function transform(row, col, rotation, reflected) { let r = row, c = reflected ? 14 - col : col; for (let i = 0; i < rotation; i++) [r, c] = [c, 14 - r]; return [r, c]; }
      for (let cell = 0; cell < N; cell++) if (!cells[cell] && (!count || nearby[cell])) {
        const keys = [];
        for (let flip = 0; flip < 2; flip++) for (let rot = 0; rot < 4; rot++) {
          const [r, c] = transform(Math.floor(cell / 15), cell % 15, rot, flip);
          const state = gameMoves.map(m => { const [mr, mc] = transform(m.row, m.col, rot, flip); return `${m.player}:${mr},${mc}`; }).join(';');
          keys.push(`${rootColor}|${moveNumber}|${state}|${r},${c}`);
        }
        const entry = priors[keys.sort()[0]];
        if (entry) result.set(cell, (entry.win - entry.loss) / (entry.win + entry.loss + (entry.draw || 0) + 6));
      }
      return result;
    }
    function findBestMove() {
      const started = performance.now(); deadline = started + config.timeMs;
      aborted = false; nodes = qnodes = 0; rootColor = aiColor; tt.clear();
      killers.forEach(k => k.length = 0); history[1].fill(0); history[2].fill(0);
      initialize(); rootPriors = trainingPriors();
      let bestMove, score = 0, completedDepth = 0, reason = 'search';
      const wins = immediate(rootColor), blocks = immediate(3 - rootColor);
      if (wins.length) { bestMove = wins[0]; score = MATE; reason = 'win'; }
      else if (blocks.length) { bestMove = blocks[0]; reason = 'block'; }
      else {
        const forced = forcingWin(rootColor, config.threatDepth, 0, Math.min(deadline, started + config.vcfMs));
        if (forced >= 0) { bestMove = forced; score = MATE - 2; reason = 'VCF'; }
        else {
          const moves = generate(rootColor, -1, 0, true);
          if (!moves.length) return null;
          bestMove = moves[0];
          for (let depth = 1; depth <= config.depth; depth++) {
            let width = depth > 1 ? Math.max(500, Math.abs(score) * 0.25) : Infinity;
            let alpha = score - width, beta = score + width;
            let result = rootSearch(moves, depth, bestMove, alpha, beta);
            if (!aborted && (result.score <= alpha || result.score >= beta)) result = rootSearch(moves, depth, bestMove, -Infinity, Infinity);
            if (aborted) break;
            completedDepth = depth; bestMove = result.move; score = result.score;
            updateExplain({ candidates: moves.length, depth, score, target: `${Math.floor(bestMove / 15) + 1}, ${bestMove % 15 + 1}`, move: { row: Math.floor(bestMove / 15), col: bestMove % 15 } });
            if (Math.abs(score) >= MATE - 1000) break;
          }
        }
      }
      lastSearch = { depth: completedDepth, configuredDepth: config.depth, candidates: config.candidates, nodes, qnodes, elapsedMs: performance.now() - started, aborted, reason, score };
      const move = { row: Math.floor(bestMove / 15), col: bestMove % 15 };
      updateExplain({ ...lastSearch, depth: reason === 'search' ? completedDepth : reason, target: `${move.row + 1}, ${move.col + 1}`, move });
      return move;
    }
    return { findBestMove, clearCache() { tt.clear(); }, get lastSearch() { return lastSearch; } };
  };
})();
