(function installThinkerEngine() {
  // Four axes are sufficient because win checks count both sides. The old
  // eight-direction list evaluated every line twice.
  const directions = [
    [-1, 0], [0, -1], [-1, -1], [-1, 1]
  ];
  const MAX_SEARCH_DEPTH = 7;
  const MAX_MOVES_TO_SEARCH = 14;
  const SEARCH_TIME_MS = 40000;
  const VCF_TIME_MS = 7000;
  const VCF_NODE_LIMIT = 20000;
  const VCF_MAX_DEPTH = 8;
  
  // 置换表保存精确分或 Alpha-Beta 上下界。
  const transpositionTable = new Map();
  // Dynamic-programming memoization: identical positions reuse evaluations,
  // threat sets, patterns, and line windows across iterative-deepening passes.
  const evaluationCache = new Map();
  const lineCache = new Map();
  const threatCache = new Map();
  const patternCache = new Map();
  const moveScoreCache = new Map();
  const boardLines = [];
  const cellLines = Array.from({ length: 225 }, () => []);
  const neighborCounts = new Uint8Array(225);
  const candidateCells = [];
  const candidatePositions = new Int16Array(225).fill(-1);
  const moveObjects = Array.from({ length: 225 }, (_unused, cell) => ({ row: Math.floor(cell / 15), col: cell % 15 }));
  let occupiedCount = 0;
  let lineValues = [];
  let totalLineValue = 0;
  let hashA = 0;
  let hashB = 0;
  let hashSeed = 0x9e3779b9;
  function nextHash() {
    hashSeed ^= hashSeed << 13;
    hashSeed ^= hashSeed >>> 17;
    hashSeed ^= hashSeed << 5;
    return hashSeed >>> 0;
  }
  const zobrist = Array.from({ length: 225 }, () => [null, [nextHash(), nextHash()], [nextHash(), nextHash()]]);
  // Each move changes only its row, column, and two diagonals. Their cached
  // sliding-window values are reused when undoing or reaching the same line.
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    for (let row = 0; row < 15; row++) for (let col = 0; col < 15; col++) {
      const previousRow = row - dr;
      const previousCol = col - dc;
      if (previousRow >= 0 && previousRow < 15 && previousCol >= 0 && previousCol < 15) continue;
      const cells = [];
      for (let r = row, c = col; r >= 0 && r < 15 && c >= 0 && c < 15; r += dr, c += dc) cells.push(r * 15 + c);
      if (cells.length < 5) continue;
      const index = boardLines.length;
      boardLines.push(cells);
      cells.forEach(cell => cellLines[cell].push(index));
    }
  }
  function lineValue(index) {
    const cells = boardLines[index];
    const sequence = cells.map(cell => board[Math.floor(cell / 15)][cell % 15]).join('');
    const key = `${aiColor}|${sequence}`;
    if (lineCache.has(key)) return lineCache.get(key);
    const weights = [0, 10, 1000, 10000, 1000000, SCORE.FIVE];
    let value = 0;
    let own = 0;
    let other = 0;
    for (let end = 0; end < sequence.length; end++) {
      const stone = Number(sequence[end]);
      own += stone === aiColor ? 1 : 0;
      other += stone === playerColor ? 1 : 0;
      if (end >= 5) {
        const removed = Number(sequence[end - 5]);
        own -= removed === aiColor ? 1 : 0;
        other -= removed === playerColor ? 1 : 0;
      }
      if (end >= 4) value += other === 0 ? weights[own] : own === 0 ? -weights[other] : 0;
    }
    if (lineCache.size > 30000) lineCache.clear();
    lineCache.set(key, value);
    return value;
  }
  function initializePosition() {
    hashA = hashB = 0;
    occupiedCount = 0;
    candidateCells.length = 0;
    candidatePositions.fill(-1);
    neighborCounts.fill(0);
    for (let row = 0; row < 15; row++) for (let col = 0; col < 15; col++) {
      const stone = board[row][col];
      if (stone) {
        occupiedCount++;
        hashA ^= zobrist[row * 15 + col][stone][0];
        hashB ^= zobrist[row * 15 + col][stone][1];
      }
    }
    for (let row = 0; row < 15; row++) for (let col = 0; col < 15; col++) {
      if (!board[row][col]) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        if (!dr && !dc) continue;
        const nextRow = row + dr;
        const nextCol = col + dc;
        if (nextRow < 0 || nextRow >= 15 || nextCol < 0 || nextCol >= 15) continue;
        const cell = nextRow * 15 + nextCol;
        neighborCounts[cell]++;
      }
    }
    rebuildCandidateCells();
    lineValues = boardLines.map((_line, index) => lineValue(index));
    totalLineValue = lineValues.reduce((sum, value) => sum + value, 0);
  }

  function rebuildCandidateCells() {
    candidateCells.length = 0;
    candidatePositions.fill(-1);
    if (!occupiedCount) {
      const center = 7 * 15 + 7;
      candidatePositions[center] = 0;
      candidateCells.push(center);
      return;
    }
    for (let cell = 0; cell < 225; cell++) {
      if (!board[Math.floor(cell / 15)][cell % 15] && neighborCounts[cell]) {
        candidatePositions[cell] = candidateCells.length;
        candidateCells.push(cell);
      }
    }
  }

  function updateNeighborCounts(row, col, delta) {
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      if (!dr && !dc) continue;
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (nextRow < 0 || nextRow >= 15 || nextCol < 0 || nextCol >= 15) continue;
      const cell = nextRow * 15 + nextCol;
      neighborCounts[cell] = Math.max(0, neighborCounts[cell] + delta);
      if (board[nextRow][nextCol] || !neighborCounts[cell]) {
        const position = candidatePositions[cell];
        if (position >= 0) {
          const last = candidateCells.pop();
          candidatePositions[cell] = -1;
          if (last !== cell) {
            candidateCells[position] = last;
            candidatePositions[last] = position;
          }
        }
      } else if (candidatePositions[cell] < 0) {
        candidatePositions[cell] = candidateCells.length;
        candidateCells.push(cell);
      }
    }
  }

  function refreshCandidateCell(cell) {
    const row = Math.floor(cell / 15);
    const col = cell % 15;
    const shouldInclude = !board[row][col] && neighborCounts[cell] > 0;
    const position = candidatePositions[cell];
    if (shouldInclude && position < 0) {
      candidatePositions[cell] = candidateCells.length;
      candidateCells.push(cell);
    } else if (!shouldInclude && position >= 0) {
      const last = candidateCells.pop();
      candidatePositions[cell] = -1;
      if (last !== cell) {
        candidateCells[position] = last;
        candidatePositions[last] = position;
      }
    }
  }
  function setPiece(row, col, stone) {
    const cell = row * 15 + col;
    const previous = board[row][col];
    if (previous === stone) return;
    if (previous) {
      hashA ^= zobrist[cell][previous][0];
      hashB ^= zobrist[cell][previous][1];
      occupiedCount--;
      updateNeighborCounts(row, col, -1);
    }
    board[row][col] = stone;
    if (stone) {
      hashA ^= zobrist[cell][stone][0];
      hashB ^= zobrist[cell][stone][1];
      occupiedCount++;
      updateNeighborCounts(row, col, 1);
    }
    refreshCandidateCell(cell);
    if (!stone && !occupiedCount) rebuildCandidateCells();
    for (const index of cellLines[cell]) {
      totalLineValue -= lineValues[index];
      lineValues[index] = lineValue(index);
      totalLineValue += lineValues[index];
    }
  }
  const killerMoves = Array.from({ length: 32 }, () => []);
  const historyScores = new Map();
  let searchDeadline = 0;
  let searchAborted = false;
  let searchedNodes = 0;
  let searchPolls = 0;
  let vcfNodes = 0;
  function getBoardKey(_depth, isMaximizing) {
      return `${hashA >>> 0}|${hashB >>> 0}|${isMaximizing ? aiColor : playerColor}`;
  }
  
  
  // 棋型分数表 (第四次优化：区分活三和冲四，提高复合棋型权重)
  const SCORE = {
      'FIVE': 10000000000, // 五连
      'LIVE_FOUR': 100000000, // 活四 (分数再次提高)
      'CHONG_FOUR': 10000000, // 冲四 (分数再次提高)
      'LIVE_THREE': 1000000, // 活三 (分数再次提高，与冲四拉近)
      'SLEEP_THREE': 10000, // 眠三
      'LIVE_TWO': 1000, // 活二
      'SLEEP_TWO': 100, // 眠二
      'ONE': 10, // 单子
      'DOUBLE_LIVE_THREE': 50000000, // 双活三 (分数再次提高)
      'FOUR_THREE': 500000000, // 活四活三 (分数再次提高)
      'DOUBLE_FOUR': 500000000, // 双四 (分数再次提高)
  };
  
  // V9Thinker keeps the V9 prior boundary. New V9Pro-only periods must not
  // silently change this model's opening behavior.
  const GOMOKU_TRAINING_MODEL = window.GOMOKU_V9THINKER_TRAINING_MODEL || window.GOMOKU_V9_TRAINING_MODEL || { priors: {} };
  
  function transformTrainingCoordinate(row, col, rotation, reflected) {
    let r = row;
    let c = reflected ? BOARD_SIZE - 1 - col : col;
    for (let i = 0; i < rotation; i++) [r, c] = [c, BOARD_SIZE - 1 - r];
    return [r, c];
  }
  
  function getTrainingPrior(row, col, player) {
    if (player !== aiColor || !GOMOKU_TRAINING_MODEL.priors) return 0;
    const aiMoveNumber = gameMoves.filter(move => move.player === aiColor).length + 1;
    if (aiMoveNumber > 4) return 0;
    const keys = [];
    for (let reflected = 0; reflected < 2; reflected++) {
      for (let rotation = 0; rotation < 4; rotation++) {
        const [r, c] = transformTrainingCoordinate(row, col, rotation, reflected);
        const state = gameMoves.map(move => {
          const [historyRow, historyCol] = transformTrainingCoordinate(move.row, move.col, rotation, reflected);
          return `${move.player}:${historyRow},${historyCol}`;
        }).join(';');
        keys.push(`${aiColor}|${aiMoveNumber}|${state}|${r},${c}`);
      }
    }
    const prior = GOMOKU_TRAINING_MODEL.priors[keys.sort()[0]];
    if (!prior) return 0;
    const total = prior.win + prior.loss + (prior.draw || 0);
    // Opening samples are sparse and may mix different model generations.
    // Keep them as a bounded ordering hint, never as a tactical override.
    if (total < 2) return 0;
    return Math.max(-60, Math.min(60, 80 * (prior.win - prior.loss) / (total + 6)));
  }
  
  
  // =================================================================
  // Minimax 搜索算法核心
  // =================================================================
  
  // 寻找最佳位置 (使用 Minimax + Alpha-Beta 剪枝)
  function findBestMoveWithMinimax() {
    const startedAt = performance.now();
    searchDeadline = startedAt + SEARCH_TIME_MS;
    searchAborted = false;
    searchedNodes = 0;
    searchPolls = 0;
    vcfNodes = 0;
    transpositionTable.clear();
    evaluationCache.clear();
    threatCache.clear();
    moveScoreCache.clear();
    initializePosition();
    killerMoves.forEach(moves => moves.length = 0);
    historyScores.clear();
    // 根节点硬战术：AI 能立即连五时，绝不被对手冲四的评分带偏。
    const immediateWins = getImmediateWinningMoves(aiColor);
    if (immediateWins.length) {
      const forcedMove = immediateWins[0];
      updateExplain({
        candidates: immediateWins.length,
        depth: 0,
        score: SCORE.FIVE,
        target: `${forcedMove.row + 1}, ${forcedMove.col + 1}`
      });
      return forcedMove;
    }
    const forcingMove = findDoubleThreatMove(aiColor);
    if (forcingMove) {
      updateExplain({
        candidates: 2,
        depth: 'FORCE',
        score: SCORE.FIVE - 2,
        target: `${forcingMove.row + 1}, ${forcingMove.col + 1}`
      });
      return forcingMove;
    }
    const urgentBlocks = getImmediateWinningMoves(playerColor);
    if (urgentBlocks.length) {
      const block = urgentBlocks[0];
      updateExplain({ candidates: urgentBlocks.length, depth: 0, score: SCORE.CHONG_FOUR, target: `${block.row + 1}, ${block.col + 1}` });
      return block;
    }
    // Prevent an opponent fork even when it is not yet an immediate win.
    const forkBlock = findDoubleThreatMove(playerColor);
    if (forkBlock) {
      updateExplain({ candidates: 2, depth: 'FORK-BLOCK', score: SCORE.CHONG_FOUR, target: `${forkBlock.row + 1}, ${forkBlock.col + 1}` });
      return forkBlock;
    }
    const threatMove = findVcfWin(aiColor);
    if (threatMove) {
      updateExplain({ candidates: vcfNodes, depth: 'VCF', score: SCORE.FIVE - 1, target: `${threatMove.row + 1}, ${threatMove.col + 1}` });
      return threatMove;
    }

    const moves = getFilteredMoves(aiColor, true);
    if (!moves.length) return null;
    let bestMove = moves[0];
    let bestScore = evaluateBoard();
    let completedDepth = 0;
    updateExplain({ candidates: moves.length, depth: 0, score: bestScore, target: `${bestMove.row + 1}, ${bestMove.col + 1}`, move: bestMove });
    for (let depth = 1; depth <= MAX_SEARCH_DEPTH; depth++) {
      const center = Number.isFinite(bestScore) ? bestScore : 0;
      const window = depth <= 1 ? Infinity : Math.max(2000, Math.abs(center) * 0.08 + 1000);
      let result = searchRoot(moves, depth, bestMove, center - window, center + window);
      // Aspiration windows save work on stable iterations, then fall back to
      // a complete PVS window when the score crosses either bound.
      if (!searchAborted && depth > 1 && (result.failLow || result.failHigh)) {
        result = searchRoot(moves, depth, bestMove, -Infinity, Infinity);
      }
      if (searchAborted) break;
      completedDepth = depth;
      bestMove = result.move || bestMove;
      bestScore = result.score;
      updateExplain({ candidates: moves.length, depth: completedDepth, score: bestScore, target: `${bestMove.row + 1}, ${bestMove.col + 1}`, move: bestMove });
    }

    updateExplain({ candidates: moves.length, depth: completedDepth, score: bestScore, target: `${bestMove.row + 1}, ${bestMove.col + 1}` });
    return bestMove;
  }

  function searchRoot(rootMoves, depth, previousBest, windowAlpha = -Infinity, windowBeta = Infinity) {
    const moves = orderMoves(rootMoves, aiColor, previousBest, 0, false);
    let alpha = windowAlpha;
    const beta = windowBeta;
    let bestScore = -Infinity;
    let bestMove = null;

    for (let index = 0; index < moves.length; index++) {
      if (shouldStopSearch()) break;
      const move = moves[index];
      setPiece(move.row, move.col, aiColor);
      let score;
      if (checkWinWithoutUpdate(move.row, move.col, aiColor)) {
        score = SCORE.FIVE + depth;
      } else if (index === 0) {
        score = minimax(depth - 1, alpha, beta, false, 1);
      } else {
        score = minimax(depth - 1, alpha, alpha + 1, false, 1);
        if (!searchAborted && score > alpha && score < beta) {
          score = minimax(depth - 1, alpha, beta, false, 1);
        }
      }
      setPiece(move.row, move.col, 0);
      if (searchAborted) break;
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    return {
      move: bestMove,
      score: bestScore,
      failLow: bestScore <= windowAlpha,
      failHigh: bestScore >= windowBeta
    };
  }

  // Iterative-deepening alpha-beta with PVS, late-move reductions, and a bound-aware TT.
  function minimax(depth, alpha, beta, isMaximizingPlayer, ply) {
    if (shouldStopSearch()) return 0;
    searchedNodes++;
    const originalAlpha = alpha;
    const originalBeta = beta;
    const currentTurn = isMaximizingPlayer ? aiColor : playerColor;
    const key = getBoardKey(depth, isMaximizingPlayer);
    const cached = transpositionTable.get(key);
    if (cached && cached.depth >= depth) {
      if (cached.bound === 'exact') return cached.score;
      if (cached.bound === 'lower') alpha = Math.max(alpha, cached.score);
      else if (cached.bound === 'upper') beta = Math.min(beta, cached.score);
      if (alpha >= beta) return cached.score;
    }
    if (depth <= 0) {
      return threatQuiescence(alpha, beta, isMaximizingPlayer, ply, 0);
    }
    const ttMove = cached?.move;
    const moves = getFilteredMoves(currentTurn, false, ttMove, ply);
    if (!moves.length) return 0;
    let result;
    let bestMove = null;
    if (isMaximizingPlayer) {
      let maxEval = -Infinity;
      for (let index = 0; index < moves.length; index++) {
        if (shouldStopSearch()) break;
        const move = moves[index];
        const { row, col } = move;
        setPiece(row, col, currentTurn);
        const wins = checkWinWithoutUpdate(row, col, currentTurn);
        const reducible = index >= 4 && depth >= 3 && beta - alpha <= 1 && !wins && !move.tactical;
        let evaluation;
        if (wins) evaluation = SCORE.FIVE + depth;
        else if (index === 0) evaluation = minimax(depth - 1, alpha, beta, false, ply + 1);
        else {
          const reducedDepth = depth - 1 - (reducible ? (depth >= 6 && index >= 9 ? 2 : 1) : 0);
          evaluation = minimax(reducedDepth, alpha, alpha + 1, false, ply + 1);
          if (!searchAborted && evaluation > alpha && (reducible || evaluation < beta)) {
            evaluation = minimax(depth - 1, alpha, beta, false, ply + 1);
          }
        }
        setPiece(row, col, 0);
        if (searchAborted) break;
        if (evaluation > maxEval) {
          maxEval = evaluation;
          bestMove = move;
        }
        alpha = Math.max(alpha, evaluation);
        if (beta <= alpha) {
          rememberCutoff(move, currentTurn, depth, ply);
          break;
        }
      }
      result = maxEval;
    } else {
      let minEval = Infinity;
      for (let index = 0; index < moves.length; index++) {
        if (shouldStopSearch()) break;
        const move = moves[index];
        const { row, col } = move;
        setPiece(row, col, currentTurn);
        const wins = checkWinWithoutUpdate(row, col, currentTurn);
        const reducible = index >= 4 && depth >= 3 && beta - alpha <= 1 && !wins && !move.tactical;
        let evaluation;
        if (wins) evaluation = -SCORE.FIVE - depth;
        else if (index === 0) evaluation = minimax(depth - 1, alpha, beta, true, ply + 1);
        else {
          const reducedDepth = depth - 1 - (reducible ? (depth >= 6 && index >= 9 ? 2 : 1) : 0);
          evaluation = minimax(reducedDepth, beta - 1, beta, true, ply + 1);
          if (!searchAborted && evaluation < beta && (reducible || evaluation > alpha)) {
            evaluation = minimax(depth - 1, alpha, beta, true, ply + 1);
          }
        }
        setPiece(row, col, 0);
        if (searchAborted) break;
        if (evaluation < minEval) {
          minEval = evaluation;
          bestMove = move;
        }
      beta = Math.min(beta, evaluation);
        if (beta <= alpha) {
          rememberCutoff(move, currentTurn, depth, ply);
          break;
        }
      }
      result = minEval;
    }
    if (searchAborted || !Number.isFinite(result)) return 0;
    const bound = result <= originalAlpha ? 'upper' : result >= originalBeta ? 'lower' : 'exact';
    if (transpositionTable.size > 50000) transpositionTable.clear();
    if (!cached || cached.depth <= depth) transpositionTable.set(key, { score: result, bound, move: bestMove, depth });
    return result;
  }

  function shouldStopSearch() {
    if (searchAborted) return true;
    if ((++searchPolls & 15) === 0 && performance.now() >= searchDeadline) {
      searchAborted = true;
    }
    return searchAborted;
  }

  function moveKey(move) {
    return `${move.row},${move.col}`;
  }

  function orderMoves(moves, player, preferredMove, ply, includePrior) {
    const preferredKey = preferredMove ? moveKey(preferredMove) : '';
    const killers = killerMoves[Math.min(ply, killerMoves.length - 1)] || [];
    return moves.map(move => {
      let score = move.score || 0;
      if (preferredKey && moveKey(move) === preferredKey) score += 1e15;
      if (killers.some(killer => moveKey(killer) === moveKey(move))) score += 200000;
      score += (historyScores.get(`${player}|${moveKey(move)}`) || 0) * 10;
      if (includePrior) score += getTrainingPrior(move.row, move.col, player);
      return { ...move, score };
    }).sort((a, b) => b.score - a.score);
  }

  function rememberCutoff(move, player, depth, ply) {
    const killers = killerMoves[Math.min(ply, killerMoves.length - 1)];
    const key = moveKey(move);
    if (!killers.some(candidate => moveKey(candidate) === key)) {
      killers.unshift(move);
      killers.length = Math.min(killers.length, 2);
    }
    const historyKey = `${player}|${key}`;
    historyScores.set(historyKey, Math.min(1000000, (historyScores.get(historyKey) || 0) + depth * depth * 4));
  }

  function isForcingMove(row, col, player) {
    return getScoreForPlayer(row, col, player) >= SCORE.CHONG_FOUR;
  }

  // Five-cell windows include gaps. Distinct completion cells and independent
  // directions distinguish a real double threat from overlapping windows.
  function getSpatialThreatScore(row, col, player) {
    if (board[row][col] !== player) return 0;
    let total = 0;
    let threateningDirections = 0;
    const weights = [0, 5, 50, 500, 5000, 0];
    for (const [dr, dc] of [[-1, 0], [0, -1], [-1, -1], [-1, 1]]) {
      const completions = new Set();
      let viable = 0;
      for (let start = -4; start <= 0; start++) {
        let own = 0;
        let emptyCell = '';
        let blocked = false;
        for (let offset = start; offset < start + 5; offset++) {
          const r = row + dr * offset;
          const c = col + dc * offset;
          if (r < 0 || r >= 15 || c < 0 || c >= 15 || board[r][c] === 3 - player) { blocked = true; break; }
          if (board[r][c] === player) own++;
          else emptyCell = `${r},${c}`;
        }
        if (blocked) continue;
        viable++;
        total += weights[own];
        if (own === 4) completions.add(emptyCell);
      }
      if (completions.size) threateningDirections++;
      total += completions.size * 20000 + viable * 10;
    }
    return total + (threateningDirections > 1 ? 100000 : 0);
  }

  function getFourThreatMoves(player) {
    const moves = [];
    for (const move of getPossibleMoves()) {
      setPiece(move.row, move.col, player);
      const wins = checkWinWithoutUpdate(move.row, move.col, player);
      const score = wins ? SCORE.FIVE : getScoreForPlayer(move.row, move.col, player);
      setPiece(move.row, move.col, 0);
      if (score >= SCORE.CHONG_FOUR) moves.push({ ...move, score });
    }
    return moves;
  }

  function findVcfWin(attacker) {
    let nodes = 0;
    const deadline = Math.min(searchDeadline, performance.now() + VCF_TIME_MS);

    function prove(sideToMove, depth) {
      if (++nodes > VCF_NODE_LIMIT || depth <= 0 || performance.now() >= deadline) return null;
      if (sideToMove === attacker) {
        const threats = getFourThreatMoves(attacker)
          .sort((a, b) => b.score - a.score);
        for (const move of threats) {
          if (++nodes > VCF_NODE_LIMIT || performance.now() >= deadline) return null;
          setPiece(move.row, move.col, attacker);
          if (checkWinWithoutUpdate(move.row, move.col, attacker)) {
            setPiece(move.row, move.col, 0);
            return move;
          }
          const opponentWins = getImmediateWinningMoves(3 - attacker);
          if (opponentWins.length) {
            setPiece(move.row, move.col, 0);
            continue;
          }
          const replies = getImmediateWinningMoves(attacker);
          if (!replies.length) {
            setPiece(move.row, move.col, 0);
            continue;
          }
          const replyResult = prove(3 - attacker, depth - 1);
          setPiece(move.row, move.col, 0);
          if (replyResult) return move;
        }
        return null;
      }

      const attackingWins = getImmediateWinningMoves(attacker);
      if (!attackingWins.length) return null;
      if (attackingWins.length > 1) return { proven: true };
      for (const defense of getPossibleMoves()) {
        if (++nodes > VCF_NODE_LIMIT || performance.now() >= deadline) return null;
        setPiece(defense.row, defense.col, 3 - attacker);
        const counterWin = checkWinWithoutUpdate(defense.row, defense.col, 3 - attacker);
        if (counterWin) {
          setPiece(defense.row, defense.col, 0);
          return null;
        }
        const remainingWins = getImmediateWinningMoves(attacker);
        const blocked = remainingWins.length === 0;
        const continuation = blocked ? prove(attacker, depth - 1) : { proven: true };
        setPiece(defense.row, defense.col, 0);
        if (!continuation) return null;
      }
      return { proven: true };
    }

    for (const move of getFourThreatMoves(attacker)) {
      if (performance.now() >= deadline || nodes > VCF_NODE_LIMIT) break;
      setPiece(move.row, move.col, attacker);
      const isWin = checkWinWithoutUpdate(move.row, move.col, attacker);
      const opponentCanWin = getImmediateWinningMoves(3 - attacker).length > 0;
      const hasWinningReply = getImmediateWinningMoves(attacker).length > 0;
      setPiece(move.row, move.col, 0);
      if (isWin) return move;
      if (opponentCanWin || !hasWinningReply) continue;
      setPiece(move.row, move.col, attacker);
      const forced = prove(3 - attacker, VCF_MAX_DEPTH - 1);
      setPiece(move.row, move.col, 0);
      if (forced) return move;
    }
    vcfNodes = nodes;
    return null;
  }

  function threatQuiescence(alpha, beta, isMaximizingPlayer, ply, qDepth) {
    if (shouldStopSearch()) return 0;
    const currentTurn = isMaximizingPlayer ? aiColor : playerColor;
    const immediateWins = getImmediateWinningMoves(currentTurn);
    if (immediateWins.length) return isMaximizingPlayer ? SCORE.FIVE + ply : -SCORE.FIVE - ply;
    const opponentWins = getImmediateWinningMoves(3 - currentTurn);
    if (!opponentWins.length || qDepth >= 4) return evaluateBoard();

    const defenses = orderMoves(getFilteredMoves(currentTurn), currentTurn, null, ply, false);
    if (!defenses.length) return evaluateBoard();
    let value = isMaximizingPlayer ? -Infinity : Infinity;
    for (const move of defenses) {
      if (shouldStopSearch()) break;
      setPiece(move.row, move.col, currentTurn);
      const wins = checkWinWithoutUpdate(move.row, move.col, currentTurn);
      const score = wins
        ? (isMaximizingPlayer ? SCORE.FIVE + ply : -SCORE.FIVE - ply)
        : threatQuiescence(alpha, beta, !isMaximizingPlayer, ply + 1, qDepth + 1);
      setPiece(move.row, move.col, 0);
      if (isMaximizingPlayer) {
        value = Math.max(value, score);
        alpha = Math.max(alpha, value);
      } else {
        value = Math.min(value, score);
        beta = Math.min(beta, value);
      }
      if (alpha >= beta) break;
    }
    return Number.isFinite(value) ? value : evaluateBoard();
  }
  
  // 评估整个棋盘状态
  function evaluateBoard() {
    const positionKey = getPositionKey();
    const cachedEvaluation = evaluationCache.get(positionKey);
    if (cachedEvaluation !== undefined) return cachedEvaluation;
    // Keep the incremental line score as the base, then inspect nearby empty
    // cells for the same tactical patterns used by move ordering. The bounded
    // frontier keeps this stronger evaluation substantially cheaper than a
    // full-board scan while avoiding the old mobility-only regression.
    const frontier = candidateCells.slice(0, Math.min(candidateCells.length, 64));
    const mobility = candidateCells.length * 12;
    let attackPotential = 0;
    let defensePotential = 0;
    for (const cell of frontier) {
      const row = Math.floor(cell / 15);
      const col = cell % 15;
      setPiece(row, col, aiColor);
      attackPotential += getScoreForPlayer(row, col, aiColor) + getSpatialThreatScore(row, col, aiColor) * 40;
      setPiece(row, col, 0);
      setPiece(row, col, playerColor);
      defensePotential += getScoreForPlayer(row, col, playerColor) + getSpatialThreatScore(row, col, playerColor) * 40;
      setPiece(row, col, 0);
    }
    const result = totalLineValue + mobility + (attackPotential - defensePotential) * 0.18;
    if (evaluationCache.size > 30000) evaluationCache.clear();
    evaluationCache.set(positionKey, result);
    return result;
  }

  function getPositionKey() {
    let key = `${aiColor}|${playerColor}|`;
    for (let row = 0; row < BOARD_SIZE; row++) key += board[row].join('');
    return key;
  }
  
  // 评估单个落子位置的得分 (用于 evaluateBoard)
  function getScoreForMove(row, col, player) {
      let score = 0;
      const mainDirections = [
          [-1, 0], [0, -1], [-1, -1], [-1, 1]
      ];
  
      for (let [dx, dy] of mainDirections) {
          const pattern = getPattern(row, col, dx, dy, player);
          
          if (pattern.includes('FIVE')) return SCORE.FIVE;
          if (pattern.includes('LIVE_FOUR')) score += SCORE.LIVE_FOUR;
          else if (pattern.includes('CHONG_FOUR')) score += SCORE.CHONG_FOUR;
          else if (pattern.includes('LIVE_THREE')) score += SCORE.LIVE_THREE;
          else if (pattern.includes('SLEEP_THREE')) score += SCORE.SLEEP_THREE;
          else if (pattern.includes('LIVE_TWO')) score += SCORE.LIVE_TWO;
          else if (pattern.includes('SLEEP_TWO')) score += SCORE.SLEEP_TWO;
      }
      return score;
  }
  
  // 获取所有可能的落子位置 (只考虑周围有子的空位)
  function getPossibleMoves() {
    return candidateCells.map(cell => moveObjects[cell]);
  }
  
  function getImmediateWinningMoves(player) {
      const cacheKey = `${hashA >>> 0}|${hashB >>> 0}|${player}`;
      const cached = threatCache.get(cacheKey);
      if (cached) return cached.map(move => ({ ...move }));
      const winningMoves = [];
      for (const move of getPossibleMoves()) {
          const { row, col } = move;
          setPiece(row, col, player);
          if (checkWinWithoutUpdate(row, col, player)) winningMoves.push(move);
          setPiece(row, col, 0);
      }
      if (threatCache.size > 20000) threatCache.clear();
      threatCache.set(cacheKey, winningMoves.map(move => ({ ...move })));
      return winningMoves;
  }

  // A move that creates two independent immediate wins is a forced attack.
  // Check this before defensive ordering so a winning continuation is not
  // discarded merely because the opponent also has a developing threat.
  function findDoubleThreatMove(player) {
      const deadline = Math.min(searchDeadline, performance.now() + 2000);
      for (const move of getPossibleMoves()) {
          if (performance.now() >= deadline) break;
          setPiece(move.row, move.col, player);
          const opponentWins = getImmediateWinningMoves(3 - player);
          const winningReplies = opponentWins.length ? [] : getImmediateWinningMoves(player);
          setPiece(move.row, move.col, 0);
          if (!opponentWins.length && winningReplies.length >= 2) return move;
      }
      return null;
  }
  
  // Generate urgent wins and blocks first, then order remaining moves for either color.
  function getFilteredMoves(player = aiColor, useTraining = false, preferredMove = null, ply = 0) {
      const allMoves = getPossibleMoves();
      const opponent = 3 - player;
      const winningMoves = [];
      const opponentWinningMoves = [];
      const scoredMoves = allMoves.map(move => {
          const { row, col } = move;
          const cell = row * 15 + col;
          const stateKey = `${hashA >>> 0}|${hashB >>> 0}|${cell}|${player}`;
          const cachedScores = moveScoreCache.get(stateKey);
          if (cachedScores) {
            if (cachedScores.wins) winningMoves.push({ ...move, tactical: true, score: SCORE.FIVE });
            if (cachedScores.opponentWins) opponentWinningMoves.push({ ...move, tactical: true, score: SCORE.FIVE });
            const trainingPrior = useTraining ? getTrainingPrior(row, col, player) : 0;
            const sameMove = preferredMove && move.row === preferredMove.row && move.col === preferredMove.col;
            const killer = (killerMoves[Math.min(ply, killerMoves.length - 1)] || []).some(candidate => candidate.row === row && candidate.col === col);
            const score = cachedScores.attackScore * 1.5 + cachedScores.defenseScore * 1.5 + cachedScores.attackSpace * 0.7 + cachedScores.defenseSpace * 0.7 + trainingPrior
              + (sameMove ? 1e15 : 0) + (killer ? 200000 : 0) + (historyScores.get(`${player}|${row},${col}`) || 0) * 10;
            return { ...move, score, tactical: cachedScores.tactical };
          }
          setPiece(row, col, player);
          const wins = checkWinWithoutUpdate(row, col, player);
          const attackScore = getScoreForPlayer(row, col, player);
          const attackSpace = getSpatialThreatScore(row, col, player);
          setPiece(row, col, 0);
          setPiece(row, col, opponent);
          const opponentWins = checkWinWithoutUpdate(row, col, opponent);
          const defenseScore = getScoreForPlayer(row, col, opponent);
          const defenseSpace = getSpatialThreatScore(row, col, opponent);
          setPiece(row, col, 0);
          if (wins) winningMoves.push({ ...move, tactical: true, score: SCORE.FIVE });
          if (opponentWins) opponentWinningMoves.push({ ...move, tactical: true, score: SCORE.FIVE });
          const trainingPrior = useTraining ? getTrainingPrior(row, col, player) : 0;
          const sameMove = preferredMove && move.row === preferredMove.row && move.col === preferredMove.col;
          const killer = (killerMoves[Math.min(ply, killerMoves.length - 1)] || []).some(candidate => candidate.row === row && candidate.col === col);
          const score = attackScore * 1.5 + defenseScore * 1.5 + attackSpace * 0.7 + defenseSpace * 0.7 + trainingPrior
            + (sameMove ? 1e15 : 0) + (killer ? 200000 : 0) + (historyScores.get(`${player}|${row},${col}`) || 0) * 10;
          const tactical = attackScore >= SCORE.CHONG_FOUR || defenseScore >= SCORE.CHONG_FOUR || attackSpace >= 100000 || defenseSpace >= 100000;
          if (moveScoreCache.size > 40000) moveScoreCache.clear();
          moveScoreCache.set(stateKey, { attackScore, defenseScore, attackSpace, defenseSpace, tactical, wins, opponentWins });
          return { ...move, score, tactical };
      });
      if (winningMoves.length) return winningMoves;
      if (opponentWinningMoves.length) return opponentWinningMoves;
      scoredMoves.sort((a, b) => b.score - a.score);
      return scoredMoves.slice(0, MAX_MOVES_TO_SEARCH);
  }
  
  // 检查当前状态是否游戏结束 (用于 Minimax 终止条件)
  function isGameOver() {
      // 遍历所有已落子的位置，检查是否有五连
      for (let i = 0; i < BOARD_SIZE; i++) {
          for (let j = 0; j < BOARD_SIZE; j++) {
              if (board[i][j] !== 0) {
                  if (checkWinWithoutUpdate(i, j, board[i][j])) {
                      return true;
                  }
              }
          }
      }
      return false;
  }
  
  // 检查是否获胜 (不更新游戏状态)
  function checkWinWithoutUpdate(row, col, player) {
      for (let [dx, dy] of directions) {
          let count = 1;
          
          // 向一个方向计数
          for (let i = 1; i <= 4; i++) {
              const newRow = row + dx * i;
              const newCol = col + dy * i;
              if (newRow >= 0 && newRow < BOARD_SIZE && newCol >= 0 && newCol < BOARD_SIZE && 
                  board[newRow][newCol] === player) {
                  count++;
              } else {
                  break;
              }
          }
          
          // 向相反方向计数
          for (let i = 1; i <= 4; i++) {
              const newRow = row - dx * i;
              const newCol = col - dy * i;
              if (newRow >= 0 && newRow < BOARD_SIZE && newCol >= 0 && newCol < BOARD_SIZE && 
                  board[newRow][newCol] === player) {
                  count++;
              } else {
                  break;
              }
          }
          
          if (count >= 5) {
              return true;
          }
      }
      return false;
  }
  
  // =================================================================
  // 辅助函数 (沿用上次优化)
  // =================================================================
  
  // 为特定玩家评估位置的总分 (用于 evaluateBoard)
  function getScoreForPlayer(row, col, player) {
    let score = 0;
    const patterns = [];
    
    // 检查四个方向（水平、垂直、两个对角线）
    const mainDirections = [
      [-1, 0], [0, -1], [-1, -1], [-1, 1]
    ];
  
    for (let [dx, dy] of mainDirections) {
      const pattern = getPattern(row, col, dx, dy, player);
      patterns.push(pattern);
    }
    
    // 统计棋型
    let live4Count = 0;
    let chong4Count = 0;
    let live3Count = 0;
    
    for (const p of patterns) {
      if (p.includes('FIVE')) return SCORE.FIVE; // 必胜
      if (p.includes('LIVE_FOUR')) live4Count++;
      if (p.includes('CHONG_FOUR')) chong4Count++;
      if (p.includes('LIVE_THREE')) live3Count++;
      
      // 累加基础分数
      if (p.includes('LIVE_FOUR')) score += SCORE.LIVE_FOUR;
      else if (p.includes('CHONG_FOUR')) score += SCORE.CHONG_FOUR;
      else if (p.includes('LIVE_THREE')) score += SCORE.LIVE_THREE;
      else if (p.includes('SLEEP_THREE')) score += SCORE.SLEEP_THREE;
      else if (p.includes('LIVE_TWO')) score += SCORE.LIVE_TWO;
      else if (p.includes('SLEEP_TWO')) score += SCORE.SLEEP_TWO;
      else if (p.includes('ONE')) score += SCORE.ONE;
    }
    
    // 复合棋型加分
    if (live4Count >= 2) score += SCORE.DOUBLE_FOUR; // 双活四
    else if (live4Count >= 1 && chong4Count >= 1) score += SCORE.DOUBLE_FOUR; // 活四冲四
    else if (chong4Count >= 2) score += SCORE.DOUBLE_FOUR; // 双冲四
    
    if (live4Count >= 1 && live3Count >= 1) score += SCORE.FOUR_THREE; // 活四活三
    
    if (live3Count >= 2) score += SCORE.DOUBLE_LIVE_THREE; // 双活三
    
    return score;
  }
  
  // 获取棋型模式
  function getPattern(row, col, dx, dy, player) {
    const patternKey = `${hashA >>> 0}|${hashB >>> 0}|${row},${col},${dx},${dy},${player}`;
    const cachedPattern = patternCache.get(patternKey);
    if (cachedPattern) return cachedPattern;
    const opponent = 3 - player;
    
    // 1. 获取中心点两侧的序列
    let seq1 = getSequence(row, col, dx, dy, player, opponent);
    let seq2 = getSequence(row, col, -dx, -dy, player, opponent);
    
    // 2. 合并序列，中心点为'X'
    const fullSequence = seq1.reverse().join('') + 'X' + seq2.join('');
    
    // 3. 检查五连
    if (fullSequence.includes('XXXXX')) return cachePattern(patternKey, 'FIVE');
  
    // 4. 检查活四
    if (fullSequence.includes('_XXXX_')) return cachePattern(patternKey, 'LIVE_FOUR');
    // 活四变种 (注意: 两端必须都有空位，否则是冲四)
    if (fullSequence.includes('_XXX_X_') || fullSequence.includes('_X_XXX_') || fullSequence.includes('_XX_XX_')) return cachePattern(patternKey, 'LIVE_FOUR');
  
    // 5. 检查冲四 (死四)
    if (fullSequence.includes('OXXXX_') || fullSequence.includes('_XXXXO')) return cachePattern(patternKey, 'CHONG_FOUR');
    if (fullSequence.includes('OXXX_X') || fullSequence.includes('X_XXXO')) return cachePattern(patternKey, 'CHONG_FOUR');
    if (fullSequence.includes('OXX_XX') || fullSequence.includes('XX_XXO')) return cachePattern(patternKey, 'CHONG_FOUR');
    if (fullSequence.includes('OX_XXX') || fullSequence.includes('XXX_XO')) return cachePattern(patternKey, 'CHONG_FOUR');
    
    // 6. 检查活三
    if (fullSequence.includes('_XXX_')) return cachePattern(patternKey, 'LIVE_THREE');
    if (fullSequence.includes('_XX_X_') || fullSequence.includes('_X_XX_')) return cachePattern(patternKey, 'LIVE_THREE');
    
    // 7. 检查眠三
    if (fullSequence.includes('OXXX_') || fullSequence.includes('_XXXO')) return cachePattern(patternKey, 'SLEEP_THREE');
    if (fullSequence.includes('OXX_X') || fullSequence.includes('X_XXO')) return cachePattern(patternKey, 'SLEEP_THREE');
    if (fullSequence.includes('OX_XX') || fullSequence.includes('XX_XO')) return cachePattern(patternKey, 'SLEEP_THREE');
    
    // 8. 检查活二
    if (fullSequence.includes('_XX_')) return cachePattern(patternKey, 'LIVE_TWO');
    if (fullSequence.includes('_X_X_')) return cachePattern(patternKey, 'LIVE_TWO');
    
    // 9. 检查眠二
    if (fullSequence.includes('OXX_') || fullSequence.includes('_XXO')) return cachePattern(patternKey, 'SLEEP_TWO');
    if (fullSequence.includes('OX_X') || fullSequence.includes('X_XO')) return cachePattern(patternKey, 'SLEEP_TWO');
    
    return cachePattern(patternKey, 'NONE');
  }

  function cachePattern(key, value) {
    if (patternCache.size > 50000) patternCache.clear();
    patternCache.set(key, value);
    return value;
  }
  
  // 获取指定方向的棋子序列
  function getSequence(row, col, dx, dy, player, opponent) {
      let sequence = [];
      for (let i = 1; i <= 5; i++) { // 延伸5步，以检测活五
          const newRow = row + dx * i;
          const newCol = col + dy * i;
          
          if (newRow < 0 || newRow >= BOARD_SIZE || newCol < 0 || newCol >= BOARD_SIZE) {
              sequence.push('O'); // 边界视为对手棋子，即阻挡
              break;
          }
          
          if (board[newRow][newCol] === player) {
              sequence.push('X'); // 己方棋子
          } else if (board[newRow][newCol] === opponent) {
              sequence.push('O'); // 对手棋子
              break;
          } else {
              sequence.push('_'); // 空位
          }
      }
      return sequence;
  }
  
  
  window.GomokuV9Thinker = {
    findBestMove: findBestMoveWithMinimax,
    clearCache: () => {
      transpositionTable.clear();
      evaluationCache.clear();
      lineCache.clear();
      threatCache.clear();
      patternCache.clear();
      moveScoreCache.clear();
    }
  };
})();
