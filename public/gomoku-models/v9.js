(function () {
  const directions = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, 1], [1, -1], [-1, 1]
  ];
  const BASE_SEARCH_DEPTH = 5; // 基础Minimax搜索深度 (提升到5)
  const MAX_MOVES_TO_SEARCH = 10;
  
  // 置换表保存精确分或 Alpha-Beta 上下界。
  const transpositionTable = new Map();
  function getBoardKey(depth, isMaximizing) {
      let key = depth + '|' + (isMaximizing ? '1' : '0') + '|';
      for (let i = 0; i < BOARD_SIZE; i++) {
          for (let j = 0; j < BOARD_SIZE; j++) {
              key += board[i][j];
          }
      }
      return key;
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
  
  const GOMOKU_TRAINING_MODEL = window.GOMOKU_TRAINING_MODEL || { priors: {} };
  
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
    return total ? 300 * (prior.win - prior.loss) / (total + 4) : 0;
  }
  
  
  // =================================================================
  // Minimax 搜索算法核心
  // =================================================================
  
  // 寻找最佳位置 (使用 Minimax + Alpha-Beta 剪枝)
  function findBestMoveWithMinimax() {
    let bestScore = -Infinity;
    let bestMove = null;
    transpositionTable.clear();
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
    const moves = getFilteredMoves(aiColor, true);
    const currentSearchDepth = BASE_SEARCH_DEPTH;
    updateExplain({ candidates: moves.length, depth: currentSearchDepth, score: moves[0]?.score ?? '—', target: moves[0] ? `${moves[0].row + 1}, ${moves[0].col + 1}` : '—' });
    let alpha = -Infinity;
    for (const move of moves) {
      const { row, col } = move;
      board[row][col] = aiColor;
      const score = checkWinWithoutUpdate(row, col, aiColor)
        ? SCORE.FIVE
        : minimax(currentSearchDepth - 1, alpha, Infinity, false);
      board[row][col] = 0;
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      alpha = Math.max(alpha, bestScore);
    }
    return bestMove;
  }
  
  // Minimax with bound-aware transposition caching.
  function minimax(depth, alpha, beta, isMaximizingPlayer) {
    const originalAlpha = alpha;
    const originalBeta = beta;
    const key = getBoardKey(depth, isMaximizingPlayer);
    const cached = transpositionTable.get(key);
    if (cached) {
      if (cached.bound === 'exact') return cached.score;
      if (cached.bound === 'lower') alpha = Math.max(alpha, cached.score);
      else if (cached.bound === 'upper') beta = Math.min(beta, cached.score);
      if (alpha >= beta) return cached.score;
    }
    if (depth === 0) {
      const evalScore = evaluateBoard();
      transpositionTable.set(key, { score: evalScore, bound: 'exact' });
      return evalScore;
    }
    const currentTurn = isMaximizingPlayer ? aiColor : playerColor;
    const moves = getFilteredMoves(currentTurn);
    if (!moves.length) return 0;
    let result;
    if (isMaximizingPlayer) {
      let maxEval = -Infinity;
      for (const move of moves) {
        const { row, col } = move;
        board[row][col] = currentTurn;
        const evaluation = checkWinWithoutUpdate(row, col, currentTurn)
          ? SCORE.FIVE + depth
          : minimax(depth - 1, alpha, beta, false);
        board[row][col] = 0;
        maxEval = Math.max(maxEval, evaluation);
        alpha = Math.max(alpha, evaluation);
        if (beta <= alpha) break;
      }
      result = maxEval;
    } else {
      let minEval = Infinity;
      for (const move of moves) {
        const { row, col } = move;
        board[row][col] = currentTurn;
        const evaluation = checkWinWithoutUpdate(row, col, currentTurn)
          ? -SCORE.FIVE - depth
          : minimax(depth - 1, alpha, beta, true);
        board[row][col] = 0;
        minEval = Math.min(minEval, evaluation);
        beta = Math.min(beta, evaluation);
        if (beta <= alpha) break;
      }
      result = minEval;
    }
    const bound = result <= originalAlpha ? 'upper' : result >= originalBeta ? 'lower' : 'exact';
    if (transpositionTable.size > 50000) transpositionTable.clear();
    transpositionTable.set(key, { score: result, bound });
    return result;
  }
  
  // 评估整个棋盘状态
  function evaluateBoard() {
    let aiTotalScore = 0;
    let playerTotalScore = 0;
    let hasPieces = false;
    
    // 只遍历已落子的位置，跳过空位
    for (let i = 0; i < BOARD_SIZE; i++) {
      for (let j = 0; j < BOARD_SIZE; j++) {
        if (board[i][j] === aiColor) {
          hasPieces = true;
          aiTotalScore += getScoreForPlayer(i, j, aiColor);
        } else if (board[i][j] === playerColor) {
          hasPieces = true;
          playerTotalScore += getScoreForPlayer(i, j, playerColor);
        }
      }
    }
    
    if (!hasPieces) return 0;
    
    // Evaluate both sides' next-move threats symmetrically.
    const emptyMoves = getPossibleMoves();
    for (const move of emptyMoves) {
        const { row, col } = move;
        
        board[row][col] = aiColor;
        aiTotalScore += getScoreForMove(row, col, aiColor);
        board[row][col] = 0;
        
        board[row][col] = playerColor;
        playerTotalScore += getScoreForMove(row, col, playerColor);
        board[row][col] = 0;
    }
    
    return aiTotalScore - playerTotalScore;
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
    const moves = [];
    const hasPiece = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] !== 0;
    
    for (let i = 0; i < BOARD_SIZE; i++) {
      for (let j = 0; j < BOARD_SIZE; j++) {
        if (board[i][j] === 0) {
          // 检查周围两圈是否有棋子，以扩大搜索范围
          let neighbor = false;
          for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
              if (dx === 0 && dy === 0) continue;
              if (hasPiece(i + dx, j + dy)) {
                neighbor = true;
                break;
              }
            }
            if (neighbor) break;
          }
          if (neighbor) {
            moves.push({ row: i, col: j });
          }
        }
      }
    }
    
    // 如果棋盘为空，则从中心开始
    if (moves.length === 0) {
        const center = Math.floor(BOARD_SIZE / 2);
        if (board[center][center] === 0) {
            moves.push({ row: center, col: center });
        }
    }
    
    return moves;
  }
  
  function getImmediateWinningMoves(player) {
      const winningMoves = [];
      for (const move of getPossibleMoves()) {
          const { row, col } = move;
          board[row][col] = player;
          if (checkWinWithoutUpdate(row, col, player)) winningMoves.push(move);
          board[row][col] = 0;
      }
      return winningMoves;
  }
  
  // Generate urgent wins and blocks first, then order remaining moves for either color.
  function getFilteredMoves(player = aiColor, useTraining = false) {
      const allMoves = getPossibleMoves();
      const opponent = 3 - player;
      const winningMoves = getImmediateWinningMoves(player);
      const opponentWinningMoves = getImmediateWinningMoves(opponent);
      if (winningMoves.length) return winningMoves;
      if (opponentWinningMoves.length) return opponentWinningMoves;
  
      const scoredMoves = allMoves.map(move => {
          const { row, col } = move;
          board[row][col] = player;
          const attackScore = getScoreForPlayer(row, col, player);
          board[row][col] = 0;
          board[row][col] = opponent;
          const defenseScore = getScoreForPlayer(row, col, opponent);
          board[row][col] = 0;
          const trainingPrior = useTraining ? getTrainingPrior(row, col, player) : 0;
          const score = attackScore * 1.5 + defenseScore * 1.5 + trainingPrior;
          return { ...move, score };
      });
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
    const opponent = 3 - player;
    
    // 1. 获取中心点两侧的序列
    let seq1 = getSequence(row, col, dx, dy, player, opponent);
    let seq2 = getSequence(row, col, -dx, -dy, player, opponent);
    
    // 2. 合并序列，中心点为'X'
    const fullSequence = seq1.reverse().join('') + 'X' + seq2.join('');
    
    // 3. 检查五连
    if (fullSequence.includes('XXXXX')) return 'FIVE';
  
    // 4. 检查活四
    if (fullSequence.includes('_XXXX_')) return 'LIVE_FOUR';
    // 活四变种 (注意: 两端必须都有空位，否则是冲四)
    if (fullSequence.includes('_XXX_X_') || fullSequence.includes('_X_XXX_') || fullSequence.includes('_XX_XX_')) return 'LIVE_FOUR';
  
    // 5. 检查冲四 (死四)
    if (fullSequence.includes('OXXXX_') || fullSequence.includes('_XXXXO')) return 'CHONG_FOUR';
    if (fullSequence.includes('OXXX_X') || fullSequence.includes('X_XXXO')) return 'CHONG_FOUR';
    if (fullSequence.includes('OXX_XX') || fullSequence.includes('XX_XXO')) return 'CHONG_FOUR';
    if (fullSequence.includes('OX_XXX') || fullSequence.includes('XXX_XO')) return 'CHONG_FOUR';
    
    // 6. 检查活三
    if (fullSequence.includes('_XXX_')) return 'LIVE_THREE';
    if (fullSequence.includes('_XX_X_') || fullSequence.includes('_X_XX_')) return 'LIVE_THREE';
    
    // 7. 检查眠三
    if (fullSequence.includes('OXXX_') || fullSequence.includes('_XXXO')) return 'SLEEP_THREE';
    if (fullSequence.includes('OXX_X') || fullSequence.includes('X_XXO')) return 'SLEEP_THREE';
    if (fullSequence.includes('OX_XX') || fullSequence.includes('XX_XO')) return 'SLEEP_THREE';
    
    // 8. 检查活二
    if (fullSequence.includes('_XX_')) return 'LIVE_TWO';
    if (fullSequence.includes('_X_X_')) return 'LIVE_TWO';
    
    // 9. 检查眠二
    if (fullSequence.includes('OXX_') || fullSequence.includes('_XXO')) return 'SLEEP_TWO';
    if (fullSequence.includes('OX_X') || fullSequence.includes('X_XO')) return 'SLEEP_TWO';
    
    return 'NONE';
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
  
  
  window.GomokuV9 = {
    findBestMove: findBestMoveWithMinimax,
    clearCache: () => transpositionTable.clear()
  };
})();
