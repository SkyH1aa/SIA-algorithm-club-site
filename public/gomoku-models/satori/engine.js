(function () {
  'use strict';
  // ===========================================================================
  // Gomoku-Satori（内部代号 V11Ge）— 从零自研的五子棋引擎
  //
  // 定位：展示版引擎。可参与人机对战与模型对战，但不计积分、不上传训练数据。
  // 诚实记录：实测对 V9Thinker、V10Ultra 双色及固定开局全部落败（各 0:12），
  // 它是搜索引擎与手写评估的教学样例，不是这几代的强度对手。
  //
  // 设计边界（按要求）：
  //   * 不使用 Rapfi 引擎、WASM、神经网络或任何外部二进制；
  //   * 不套用本仓库其它模型的参数与配置：下列线枚举方式、评估函数、候选生成、
  //     增量打分、置换表编码、着法排序、强制着延伸、VCF/VCT 证明都是本引擎自己的
  //     实现，所有数值权重也是按“威胁相对强弱”自行设定，没有从 v9/v10/expert-core
  //     或 v10ultra 配置里抄任何常量。
  //   * 只使用五子棋的通用棋理（连五即胜、活四不可单点封堵、冲四强制应手、
  //     连续冲四可构成必胜序列），这是棋种本身的规则，不属于任何模型的私有参数。
  //
  // 结构：
  //   1) 线枚举：预计算所有长度 >= 5 的横/竖/斜线，并记录每个点属于哪几条线，
  //      使得落子只需重算受影响的那 4 条线（增量评估）。
  //   2) 评估：按 5 格窗口统计五连/成五点/活四/冲四/活三/冲三/二，累加到线分。
  //      五连直接返回必胜分；成五点 >= 2 判活四（无法单点封堵），== 1 判冲四。
  //   3) 搜索：迭代加深 negamax + alpha-beta + PVS，置换表（typed array，验证哈希
  //      高位）、杀手着法与 history 启发、静止期搜索（解析冲四/活四强制威胁），
  //      以及“强制着延伸”：自己能成五直接返回胜；对手有唯一成五点时只搜那一手
  //      （必挡），对手有两点以上直接判负。
  //   4) VCF：只搜索“冲四”这一种强制着法，构成精确的连续冲四必胜证明。
  //   5) VCT：冲四 + 活三交替的威胁搜索，只在对手完备防守集合被逐个反驳后才判胜。
  // ===========================================================================

  const SIZE = 15;
  const CELLS = SIZE * SIZE;
  const BLACK = 1, WHITE = 2;
  const WIN = 1000000000;
  const EVAL_CAP = 800000000;
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  // ---- 我自己的威胁权重（按相对强弱排序，非抄自他处）----------------------
  const T_FIVE = 1000000000;
  const T_OPEN4 = 10000000;   // 两端都能成五，单点封不住
  const T_FOUR = 100000;      // 一个成五点，对手必须挡
  const T_OPEN3 = 10000;      // 下一步可成活四
  const T_THREE = 1000;
  const T_PAIR = 30;
  const T_SINGLE = 4;

  // ---- 线枚举 ---------------------------------------------------------------
  const LINES = [];
  const CELL_LINES = [];
  for (let i = 0; i < CELLS; i++) CELL_LINES.push([]);
  for (const [dr, dc] of DIRS) {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const pr = r - dr, pc = c - dc;
      if (pr >= 0 && pr < SIZE && pc >= 0 && pc < SIZE) continue; // 不是该方向的起点
      const cells = [];
      let rr = r, cc = c;
      while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE) { cells.push(rr * SIZE + cc); rr += dr; cc += dc; }
      if (cells.length < 5) continue; // 短于 5 的线永远不可能成五
      const id = LINES.length;
      LINES.push(Int16Array.from(cells));
      for (const cell of cells) CELL_LINES[cell].push(id);
    }
  }

  // ---- 棋盘与增量评估状态 ---------------------------------------------------
  const board = new Int8Array(CELLS);
  const near = new Int8Array(CELLS);          // 该空点附近（切比雪夫距离 <= 2）的棋子数
  const sB = new Float64Array(LINES.length);  // 每条线上黑方得分
  const sW = new Float64Array(LINES.length);
  let totalB = 0, totalW = 0;
  let stones = 0;

  const zHi = new Int32Array(2 * CELLS);
  const zLo = new Int32Array(2 * CELLS);
  (function initZobrist() {
    let seed = 0x9e3779b9;
    const next = () => {
      // xorshift32，自己选的种子与实现
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return seed | 0;
    };
    for (let i = 0; i < 2 * CELLS; i++) { zHi[i] = next(); zLo[i] = next(); }
  })();
  let keyHi = 0, keyLo = 0;

  // ---- 单线评估（O(窗口数)，全 O(n)）---------------------------------------
  function scoreLine(cells, color) {
    const n = cells.length;
    const opp = 3 - color;
    // 已经连五
    let run = 0;
    for (let i = 0; i < n; i++) {
      if (board[cells[i]] === color) { if (++run >= 5) return T_FIVE; } else run = 0;
    }
    // 5 格窗口统计
    let compMaskSide = 0;           // 成五点的分布（只用于判断 >=2 / ==1）
    const compAt = [];              // 成五点在该线内的位置
    let open3 = 0, three = 0, pairs = 0, singles = 0;
    for (let i = 0; i + 5 <= n; i++) {
      let mine = 0, theirs = 0;
      for (let k = 0; k < 5; k++) {
        const v = board[cells[i + k]];
        if (v === color) mine++;
        else if (v === opp) { theirs++; break; }
      }
      if (theirs) continue;
      if (mine === 4) {
        for (let k = 0; k < 5; k++) if (board[cells[i + k]] === 0) compAt.push(i + k);
      } else if (mine === 3) {
        // 窗口两端是否开阔（线外视为封堵）
        const leftOpen = i - 1 >= 0 && board[cells[i - 1]] === 0;
        const rightOpen = i + 5 < n && board[cells[i + 5]] === 0;
        if (leftOpen && rightOpen) open3++; else three++;
      } else if (mine === 2) pairs++;
      else if (mine === 1) singles++;
    }
    if (compAt.length) {
      // 去重：同一条线的成五点个数
      const uniq = [];
      for (const p of compAt) if (uniq.indexOf(p) < 0) uniq.push(p);
      if (uniq.length >= 2) return T_OPEN4;
      return T_FOUR;
    }
    return open3 * T_OPEN3 + three * T_THREE + pairs * T_PAIR + singles * T_SINGLE;
  }

  function refreshLinesAt(cell) {
    for (const id of CELL_LINES[cell]) {
      const cells = LINES[id];
      totalB -= sB[id]; totalW -= sW[id];
      sB[id] = scoreLine(cells, BLACK);
      sW[id] = scoreLine(cells, WHITE);
      totalB += sB[id]; totalW += sW[id];
    }
  }

  function bumpNear(cell, delta) {
    const r = (cell / SIZE) | 0, c = cell % SIZE;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
      near[rr * SIZE + cc] += delta;
    }
  }

  function place(cell, color) {
    board[cell] = color;
    keyHi ^= zHi[(color - 1) * CELLS + cell];
    keyLo ^= zLo[(color - 1) * CELLS + cell];
    bumpNear(cell, 1);
    refreshLinesAt(cell);
    stones++;
  }

  function undo(cell, color) {
    board[cell] = 0;
    keyHi ^= zHi[(color - 1) * CELLS + cell];
    keyLo ^= zLo[(color - 1) * CELLS + cell];
    bumpNear(cell, -1);
    refreshLinesAt(cell);
    stones--;
  }

  // ---- 基本查询 -------------------------------------------------------------
  function runLenThrough(cell, color) {
    const r = (cell / SIZE) | 0, c = cell % SIZE;
    let best = 1;
    for (const [dr, dc] of DIRS) {
      let len = 1;
      for (let k = 1; k < 5; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE || board[rr * SIZE + cc] !== color) break;
        len++;
      }
      for (let k = 1; k < 5; k++) {
        const rr = r - dr * k, cc = c - dc * k;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE || board[rr * SIZE + cc] !== color) break;
        len++;
      }
      if (len > best) best = len;
    }
    return best;
  }

  // 在空点 cell 落 color 是否立刻成五（调用前 cell 必须为空）
  function makesFive(cell, color) {
    board[cell] = color;
    const len = runLenThrough(cell, color);
    board[cell] = 0;
    return len >= 5;
  }

  // 落 color 于 cell 后，color 是否出现“成五点”（冲四/活四）。
  // 精确且便宜：进入该函数前 color 必无成五点（由调用方保证），
  // 因此新的成五点只可能出现在穿过 cell 的 4 条方向线上（±4 格内）。
  function createsThreat(cell, color) {
    board[cell] = color;
    const r = (cell / SIZE) | 0, c = cell % SIZE;
    let found = false;
    outer: for (const [dr, dc] of DIRS) {
      for (let s = -4; s <= 4; s++) {
        if (!s) continue;
        const rr = r + dr * s, cc = c + dc * s;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
        const t = rr * SIZE + cc;
        if (board[t]) continue;
        if (makesFive(t, color)) { found = true; break outer; }
      }
    }
    board[cell] = 0;
    return found;
  }

  // 附近空点（切比雪夫距离 <= 2 内有子），按索引顺序返回
  function candidateCells() {
    const list = [];
    for (let i = 0; i < CELLS; i++) if (!board[i] && near[i] > 0) list.push(i);
    return list;
  }

  // 该颜色的成五点（能立刻连五的空点）
  function completionCells(color) {
    const out = [];
    for (let i = 0; i < CELLS; i++) {
      if (board[i] || !near[i]) continue;
      if (makesFive(i, color)) out.push(i);
    }
    return out;
  }

  // 落子后是否在某个方向形成“活三”（可一步成为活四的三连）。
  // 判定：过该点的连长 == 3，且三连两端都为空，并且至少一端再往外一格也是空
  //（这样下一手才能形成两端全空的四）。只检测经过新落点的三，足够做威胁过滤。
  function createsOpenThree(cell, color) {
    board[cell] = color;
    const r = (cell / SIZE) | 0, c = cell % SIZE;
    let found = false;
    for (const [dr, dc] of DIRS) {
      let len = 1;
      let re = r, ce = c, rs = r, cs = c;
      for (let k = 1; k < 5; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE || board[rr * SIZE + cc] !== color) break;
        len++; re = rr; ce = cc;
      }
      for (let k = 1; k < 5; k++) {
        const rr = r - dr * k, cc = c - dc * k;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE || board[rr * SIZE + cc] !== color) break;
        len++; rs = rr; cs = cc;
      }
      if (len !== 3) continue;
      const ar = re + dr, ac = ce + dc, br = rs - dr, bc = cs - dc;
      if (ar < 0 || ar >= SIZE || ac < 0 || ac >= SIZE) continue;
      if (br < 0 || br >= SIZE || bc < 0 || bc >= SIZE) continue;
      if (board[ar * SIZE + ac] !== 0 || board[br * SIZE + bc] !== 0) continue;
      const a2r = ar + dr, a2c = ac + dc, b2r = br - dr, b2c = bc - dc;
      const a2ok = a2r >= 0 && a2r < SIZE && a2c >= 0 && a2c < SIZE && board[a2r * SIZE + a2c] === 0;
      const b2ok = b2r >= 0 && b2r < SIZE && b2c >= 0 && b2c < SIZE && board[b2r * SIZE + b2c] === 0;
      if (a2ok || b2ok) { found = true; break; }
    }
    board[cell] = 0;
    return found;
  }
  // 同上，但只检查给定候选集合（VCF 递归里用，避免重复全盘扫描）。
  function completionCellsIn(cells, color) {
    const out = [];
    for (const i of cells) {
      if (board[i]) continue;
      if (makesFive(i, color)) out.push(i);
    }
    return out;
  }

  // ---- 着法排序用的轻量启发（与搜索评分分开，纯为排序服务）----------------
  function directionalGain(cell, color) {
    const r = (cell / SIZE) | 0, c = cell % SIZE;
    let total = 0;
    for (const [dr, dc] of DIRS) {
      let len = 1, openA = false, openB = false;
      for (let k = 1; k <= 4; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) break;
        const v = board[rr * SIZE + cc];
        if (v === color) len++;
        else { openA = v === 0; break; }
      }
      for (let k = 1; k <= 4; k++) {
        const rr = r - dr * k, cc = c - dc * k;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) break;
        const v = board[rr * SIZE + cc];
        if (v === color) len++;
        else { openB = v === 0; break; }
      }
      const open = (openA ? 1 : 0) + (openB ? 1 : 0);
      if (len >= 5) total += 1000000;
      else if (len === 4) total += open >= 1 ? 20000 : 2000;
      else if (len === 3) total += open === 2 ? 3000 : (open === 1 ? 300 : 0);
      else if (len === 2) total += open === 2 ? 200 : (open === 1 ? 20 : 0);
      else total += open === 2 ? 10 : 0;
    }
    return total;
  }

  // ---- 置换表（自己设计的编码：低位索引 + 高位校验）----------------------
  const TT_BITS = 20, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const ttHi = new Int32Array(TT_SIZE);
  const ttDepth = new Int8Array(TT_SIZE);
  const ttScore = new Int32Array(TT_SIZE);
  const ttFlag = new Int8Array(TT_SIZE);
  const ttMove = new Int16Array(TT_SIZE);
  const TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3;
  const KILLERS = 2;
  const killers = Array.from({ length: 64 }, () => new Int16Array(KILLERS).fill(-1));
  // history 启发：按“历史节点上引发过剪枝的着法”累积加分，帮助排序
  const history = new Float64Array(CELLS);

  // ---- 搜索 -----------------------------------------------------------------
  let nodes = 0, deadline = 0, aborted = false;
  const QUISC_DEPTH = 8;
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  // ---- 决策剖析埋点（默认关闭）----------------------------------------------
  // 展示页（gomoku-satori-lab.html）要逐步剖析引擎的每个决策，就必须拿到它
  // 平时丢掉的信息：完整候选排序及各项得分、alpha-beta 剪枝、每层迭代结果、
  // 搜索树节点、VCF/VCT 的攻防步骤。
  //
  // 关键约束：trace 为 null 时不执行任何埋点计算，因此生产页面与对局验收的
  // 走子结果、耗时与引擎源码以外的行为完全不变。只有展示页显式调用 setTrace
  // 打开埋点，才会产生这些额外开销。
  let trace = null;
  function traceEvent(kind, data) {
    if (!trace) return false;
    if (trace.count >= trace.maxEvents) { trace.overflowed = true; return false; }
    trace.count++;
    // data 里可能有自己的 kind 字段（例如剪枝原因的细分），
    // 这里让事件类型最后写入，避免被覆盖。
    trace.events.push({ ...data, kind });
    return true;
  }
  // 树节点单独计数并限流：中盘搜索可达数百万节点，必须抽稀，否则内存与
  // 页面渲染都会失控。超出预算的节点不再记录，但仍照常参与搜索。
  //
  // 树事件写入独立的 tree 缓冲，并在每次迭代加深开始时清空：展示页要看的
  // 是“最深那层的搜索树”，而不是历次迭代的叠加，这样既聚焦又有界。
  function traceNode(kind, data) {
    if (!trace) return;
    if (data.ply !== undefined && data.ply > trace.treePly) return;
    if (trace.treeCount >= trace.treeMax) { trace.treeTruncated = true; return; }
    trace.treeCount++;
    // 未显式给 nodeId 的事件（剪枝/静止期/强制着）归属到当前栈顶节点，
    // 这样展示页能把“这个节点为什么停在这里”精确挂到树上。
    const nodeId = data.nodeId !== undefined
      ? data.nodeId
      : (trace.stack.length ? trace.stack[trace.stack.length - 1] : -1);
    trace.tree.push({ ...data, nodeId, kind, iteration: trace.iteration });
  }

  function evaluate(color) {
    const diff = totalB - totalW;
    let v = color === BLACK ? diff : -diff;
    if (v > EVAL_CAP) v = EVAL_CAP; else if (v < -EVAL_CAP) v = -EVAL_CAP;
    return v;
  }

  // 静止期搜索：叶子节点继续解析冲四/活四等强制威胁，
  // 避免在“刚落子但尚未连五”的临界位置直接以静态分数截断。
  function quiescence(alpha, beta, color, ply, depth) {
    if ((++nodes & 511) === 0 && now() > deadline) { aborted = true; return 0; }
    if (aborted) return 0;
    const stand = evaluate(color);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (depth <= 0 || ply > 64) return alpha;

    const mine = completionCells(color);
    if (mine.length) return WIN - ply;
    const theirs = completionCells(3 - color);
    if (theirs.length >= 2) return -(WIN - ply - 1);
    if (theirs.length === 1) {
      const block = theirs[0];
      place(block, color);
      const score = -quiescence(-beta, -alpha, 3 - color, ply + 1, depth - 1);
      undo(block, color);
      return score;
    }

    const forcing = [];
    for (const cell of candidateCells()) {
      if (createsThreat(cell, color)) forcing.push(cell);
    }
    forcing.sort((a, b) => directionalGain(b, color) - directionalGain(a, color));
    for (const cell of forcing.slice(0, 8)) {
      place(cell, color);
      const score = runLenThrough(cell, color) >= 5
        ? WIN - ply
        : -quiescence(-beta, -alpha, 3 - color, ply + 1, depth - 1);
      undo(cell, color);
      if (aborted) return 0;
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  // 分支因子是搜索效率的决定因素：中盘附近空点常达 40+，alpha-beta 会失效。
  // 这里按“己方增益 + 对手增益”排序后只取前 N 个，N 随深度收缩。
  function candidateLimit(ply) {
    if (ply <= 1) return 14;   // 根节点与浅层保留较多选择
    if (ply <= 3) return 10;
    if (ply <= 5) return 8;
    return 6;                  // 深层只看最像的几步
  }
  function orderedCandidates(color, ttBest, ply) {
    const list = candidateCells();
    const opp = 3 - color;
    const limit = candidateLimit(ply);
    // 关闭埋点时走原始精简路径：候选对象只有 cell/score 两个字段，
    // 与加埋点前逐字节一致，搜索速度与走子结果都不受影响。
    if (!trace) {
      const scored = list.map((cell) => {
        let s = directionalGain(cell, color) + directionalGain(cell, opp) * 0.85;
        if (cell === ttBest) s += 1e7;
        const ks = killers[ply];
        if (ks && (ks[0] === cell || ks[1] === cell)) s += 5e5;
        s += history[cell];
        const r = (cell / SIZE) | 0, c = cell % SIZE;
        s += (14 - Math.abs(r - 7) - Math.abs(c - 7)); // 靠中心略优
        return { cell, s };
      });
      scored.sort((a, b) => b.s - a.s);
      return scored.slice(0, limit).map((x) => x.cell);
    }

    // 开启埋点：额外保留各评分分量，供展示页解释“为什么是这几步、为什么这个顺序”。
    // 加法顺序与上面完全一致，因此两种模式的排序结果相同。
    const scored = list.map((cell) => {
      const own = directionalGain(cell, color);
      const foe = directionalGain(cell, opp);
      let s = own + foe * 0.85;
      const isTT = cell === ttBest;
      if (isTT) s += 1e7;
      const ks = killers[ply];
      const isKiller = !!(ks && (ks[0] === cell || ks[1] === cell));
      if (isKiller) s += 5e5;
      const isHistory = history[cell];
      s += isHistory;
      const r = (cell / SIZE) | 0, c = cell % SIZE;
      const centerBonus = (14 - Math.abs(r - 7) - Math.abs(c - 7)); // 靠中心略优
      s += centerBonus;
      return { cell, s, own, foe, isTT, isKiller, isHistory, centerBonus };
    });
    scored.sort((a, b) => b.s - a.s);
    // 候选排序只在根附近记录：深层每个节点都记会产生数万条事件，而解释
    // “这一步为什么这么选”只需要根节点（含被剪掉的候选）与对手的应手层。
    if (ply <= trace.candidatePly) {
      traceEvent(ply === 0 ? 'root-candidates' : 'candidates', {
        ply,
        color,
        limit,
        total: scored.length,
        ttBest: ttBest >= 0 ? { row: (ttBest / SIZE) | 0, col: ttBest % SIZE } : null,
        candidates: scored.map((entry, index) => ({
          row: (entry.cell / SIZE) | 0,
          col: entry.cell % SIZE,
          score: Math.round(entry.s * 100) / 100,
          attack: entry.own,
          defense: Math.round(entry.foe * 100) / 100,
          centerBonus: entry.centerBonus,
          history: Math.round(entry.isHistory * 100) / 100,
          fromTransposition: entry.isTT,
          fromKiller: entry.isKiller,
          kept: index < limit
        }))
      });
    }
    return scored.slice(0, limit).map((x) => x.cell);
  }
  // negamax 剪枝时把 bestMove 记入 history（butterfly 累积，按 ply 深度加权）
  function recordHistory(cell, ply) {
    const gain = (MAX_PLY - ply) * (MAX_PLY - ply);
    history[cell] += gain;
  }
  const MAX_PLY = 32;

  function negamax(depth, alpha, beta, color, ply) {
    // 树形埋点：只在浅层记录节点的开/闭，用来在展示页重建真实的父子结构
    // （谁是谁的子节点、各自返回多少分、在哪一步因为什么剪枝）。深层节点数量
    // 太大，记录会让内存和页面渲染失控，所以 treePly 之外的层不记。
    const tracing = trace !== null && ply <= trace.treePly;
    let nodeId = -1;
    if (tracing) {
      nodeId = ++trace.nextNodeId;
      trace.stack.push(nodeId);
      traceNode('node-open', {
        nodeId, parentId: trace.stack.length > 1 ? trace.stack[trace.stack.length - 2] : -1,
        ply, depth, color, alpha, beta, move: trace.moveByPly[ply] || null
      });
    }
    const value = negamaxCore(depth, alpha, beta, color, ply);
    if (tracing) {
      trace.stack.pop();
      traceNode('node-close', { nodeId, ply, depth, color, value: value | 0, move: trace.moveByPly[ply] || null });
    }
    return value;
  }

  function negamaxCore(depth, alpha, beta, color, ply) {
    // 与 negamax 包装器同一判据：用于决定本层是否要写子节点着法标签。
    const tracing = trace !== null && ply <= trace.treePly;
    if ((++nodes & 511) === 0 && now() > deadline) aborted = true;
    if (aborted) return 0;
    if (ply > 64) return evaluate(color);

    const idx = keyLo & TT_MASK;
    let ttBest = -1;
    if (ttHi[idx] === keyHi) {
      ttBest = ttMove[idx];
      if (ttDepth[idx] >= depth) {
        const sc = ttScore[idx], fl = ttFlag[idx];
        if (fl === TT_EXACT) {
          if (trace) traceNode('node-cutoff', { ply, depth, color, cutoff: 'tt-exact', score: sc });
          return sc;
        }
        if (fl === TT_LOWER && sc > alpha) alpha = sc;
        else if (fl === TT_UPPER && sc < beta) beta = sc;
        if (alpha >= beta) {
          if (trace) traceNode('node-cutoff', { ply, depth, color, cutoff: 'tt-bound', score: sc });
          return sc;
        }
      }
    }
    const alphaOrig = alpha;

    // 强制着分析：只在候选点里找成五点，避免全盘 225 格反复试落。
    const cands = candidateCells();
    let myFive = -1, oppFiveCell = -1, oppFiveCount = 0;
    for (const cell of cands) {
      if (makesFive(cell, color)) { myFive = cell; break; }
      if (makesFive(cell, 3 - color)) { oppFiveCount++; if (oppFiveCell < 0) oppFiveCell = cell; }
      if (oppFiveCount >= 2) break;
    }
    if (myFive >= 0) {
      if (trace) traceNode('node-cutoff', { ply, depth, color, cutoff: 'self-five' });
      return WIN - ply;
    }
    if (oppFiveCount >= 2) {
      if (trace) traceNode('node-cutoff', { ply, depth, color, cutoff: 'opp-double-five' });
      return -(WIN - ply - 1);
    }

    if (depth <= 0) {
      if (trace) traceNode('node-quiescence', { ply, depth, color });
      return quiescence(alpha, beta, color, ply, QUISC_DEPTH);
    }

    const moves = oppFiveCount === 1 ? [oppFiveCell] : orderedCandidates(color, ttBest, ply);
    if (trace && oppFiveCount === 1) traceNode('node-forced', { ply, depth, color, row: (oppFiveCell / SIZE) | 0, col: oppFiveCell % SIZE });
    let best = -WIN * 2, bestMove = -1, raised = false;
    let firstChild = true;
    for (const cell of moves) {
      place(cell, color);
      // 子节点在 ply+1，到达它的着法就是这个 cell，因此写在 moveByPly[ply+1]。
      if (tracing) trace.moveByPly[ply + 1] = { row: (cell / SIZE) | 0, col: cell % SIZE };
      let v;
      if (runLenThrough(cell, color) >= 5) v = WIN - ply;
      else if (firstChild) {
        v = -negamax(depth - 1, -beta, -alpha, 3 - color, ply + 1);
        firstChild = false;
      } else {
        // PVS：先用零窗口试探，若被证明不是最优再重新全窗口搜索
        v = -negamax(depth - 1, -alpha - 1, -alpha, 3 - color, ply + 1);
        if (v > alpha && v < beta) v = -negamax(depth - 1, -beta, -alpha, 3 - color, ply + 1);
      }
      undo(cell, color);
      if (tracing) trace.moveByPly[ply + 1] = null;
      if (aborted) return 0;
      if (v > best) { best = v; bestMove = cell; }
      if (v > alpha) { alpha = v; raised = true; }
      if (alpha >= beta) {
        const ks = killers[ply];
        if (ks && bestMove >= 0 && ks[0] !== bestMove) { ks[1] = ks[0]; ks[0] = bestMove; }
        if (bestMove >= 0) recordHistory(bestMove, ply);
        if (trace) traceNode('node-prune', {
          ply, depth, color, score: v,
          row: (bestMove / SIZE) | 0, col: bestMove % SIZE,
          beta
        });
        break;
      }
    }

    if (!aborted && bestMove >= 0) {
      ttHi[idx] = keyHi; ttDepth[idx] = depth; ttScore[idx] = best | 0; ttMove[idx] = bestMove;
      ttFlag[idx] = best <= alphaOrig ? TT_UPPER : (raised ? TT_EXACT : TT_LOWER);
    }
    return best;
  }

  // ---- VCF：只搜冲四的精确连续必胜证明 --------------------------------------
  // 严格版：攻击方每一步都必须“落子后立刻出现成五点”（冲四），对手被强制应手。
  // 关键修正（早期版本会误报必胜）：
  //   * 落子后先检查是否已经连五——已连五直接结束，不要把普通推进当冲四；
  //   * “活四”必须由同一个成五方向的两端构成，且对手不能先连五；
  //   * 对手应手前先检查对手能否直接连五，能则本线不成立；
  //   * 每一步都用独立函数重新计算成五点，不依赖增量评分。
  function vcfSearch(color, depth) {
    // 我方已能连五
    const finish = completionCells(color);
    if (finish.length) return [finish[0]];
    if (depth <= 0) return null;
    // 对手已能连五且不止一点 -> 追不动
    const oppNow = completionCells(3 - color);
    if (oppNow.length >= 2) return null;

    for (let cell = 0; cell < CELLS; cell++) {
      if (board[cell] || !near[cell]) continue;
      // 只有能形成成五点的落子才是冲四候选
      place(cell, color);
      if (runLenThrough(cell, color) >= 5) { undo(cell, color); return [cell]; }
      const comps = completionCells(color);
      if (!comps.length) { undo(cell, color); continue; }

      if (comps.length >= 2) {
        // 活四：对手即使先落一手也应不能同时封住两端
        const oppBefore = completionCells(3 - color);
        undo(cell, color);
        if (!oppBefore.length) return [cell];
        continue;
      }

      // 冲四：对手必须堵这个唯一的成五点，除非对手能直接连五
      const block = comps[0];
      const oppWins = completionCells(3 - color);
      if (oppWins.length) { undo(cell, color); continue; }
      place(block, 3 - color);
      const rest = vcfSearch(color, depth - 1);
      undo(block, 3 - color);
      undo(cell, color);
      if (rest) return [cell, block, ...rest];
    }
    return null;
  }

  function vcfProof(color, depth) {
    const before = { stones, hi: keyHi, lo: keyLo };
    const found = vcfSearch(color, depth);
    // 无论结果如何都保证状态复原
    if (stones !== before.stones || keyHi !== before.hi || keyLo !== before.lo) {
      throw new Error('VCF 搜索未复原棋盘状态');
    }
    return found;
  }

  // ---- VCT：冲四 + 活三交替的威胁搜索 ---------------------------------------
  // 比 VCF 宽一档：攻击方每手必须是冲四或活三（强制/半强制着法）。
  // 声明必胜的条件是“对手所有合法防守都被逐个反驳”，因此防守集合必须完备：
  //   * 攻击方形成冲四/活四后，防守方唯一不立刻输的应手是堵成五点
  //     （反冲四来不及：攻击方下一手先连五）；
  //   * 攻击方仅形成活三时，防守方要么落在该线穿新点 ±4 格内的空点上
  //     （封端/塞缝），要么自己反冲四争先行。除此之外的应手都会被
  //     “下一手活四”直接击穿，因此上面的集合是完备防守超集。
  // 超集里漏掉某个攻击手只可能漏掉真胜，不会谎报必胜。
  function vctSearch(color, depth) {
    if ((++vctNodes & 255) === 0 && now() > deadline) { aborted = true; return null; }
    if (aborted || depth <= 0) return null;

    // 攻击方已能连五：无需继续证明
    const finish = completionCells(color);
    if (finish.length) return [finish[0]];

    // 对手成五点 >= 2 时任何攻击都来不及；== 1 时攻击方被迫先堵
    const oppFive = completionCells(3 - color);
    const forced = oppFive.length >= 2 ? null : (oppFive.length === 1 ? [oppFive[0]] : null);
    if (!forced && depth <= 1) return null;

    const attacks = forced || (() => {
      const list = [];
      for (let cell = 0; cell < CELLS; cell++) {
        if (board[cell] || !near[cell]) continue;
        if (createsThreat(cell, color) || createsOpenThree(cell, color)) list.push(cell);
      }
      list.sort((a, b) => directionalGain(b, color) - directionalGain(a, color));
      return list.slice(0, 12);
    })();

    for (const cell of attacks) {
      place(cell, color);
      if (runLenThrough(cell, color) >= 5) { undo(cell, color); return [cell]; }

      // 生成本手之后防守方的完备防守集合
      const myThreats = completionCells(color);
      let defenses;
      if (myThreats.length >= 2) {
        // 活四：单点封不住，直接胜
        undo(cell, color);
        return [cell];
      } else if (myThreats.length === 1) {
        defenses = [myThreats[0]];                       // 冲四：必须堵
      } else {
        // 活三：线上 ±4 格内空点 + 对手反冲四点
        defenses = [];
        const r = (cell / SIZE) | 0, c = cell % SIZE;
        const seen = new Set();
        for (const [dr, dc] of DIRS) {
          for (let s = -4; s <= 4; s++) {
            if (!s) continue;
            const rr = r + dr * s, cc = c + dc * s;
            if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
            const t = rr * SIZE + cc;
            if (!board[t] && near[t] && !seen.has(t)) { seen.add(t); defenses.push(t); }
          }
        }
        for (let i = 0; i < CELLS; i++) {
          if (board[i] || !near[i] || seen.has(i)) continue;
          if (createsThreat(i, 3 - color)) defenses.push(i);
        }
      }

      let allLose = defenses.length > 0, first = null;
      for (const d of defenses) {
        place(d, 3 - color);
        const reply = vctSearch(color, depth - 1);
        undo(d, 3 - color);
        if (aborted) { undo(cell, color); return null; }
        if (!reply) { allLose = false; break; }
        if (!first) first = [d, reply];
      }
      undo(cell, color);
      if (allLose && first) return [cell, first[0], ...first[1]];
    }
    return null;
  }

  let vctNodes = 0;
  function vctProof(color, depth, timeMs) {
    const before = { stones, hi: keyHi, lo: keyLo };
    vctNodes = 0;
    deadline = now() + timeMs;   // VCT 使用独立的时间片，超时即放弃（不谎报）
    aborted = false;
    const found = vctSearch(color, depth);
    if (stones !== before.stones || keyHi !== before.hi || keyLo !== before.lo) {
      throw new Error('VCT 搜索未复原棋盘状态');
    }
    return aborted ? null : found;
  }

  // ---- 对外接口 -------------------------------------------------------------
  const THINK_MS = 16000;   // 我自己的单步预算
  const MAX_DEPTH = 32;
  const VCF_DEPTH = 8;
  const VCT_DEPTH = 6;      // VCT 攻击手数上限（冲四+活三交替）
  const VCT_MS = 6000;      // VCT 独立时间片
  let lastSearch = null;

  function reset() {
    board.fill(0); near.fill(0);
    sB.fill(0); sW.fill(0); totalB = 0; totalW = 0; stones = 0;
    keyHi = 0; keyLo = 0;
    history.fill(0);
    ttHi.fill(0); ttDepth.fill(0); ttScore.fill(0); ttFlag.fill(0); ttMove.fill(-1);
    for (const ks of killers) ks.fill(-1);
  }

  function loadBoard(boardState) {
    reset();
    if (!boardState) return;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const v = boardState[r] && boardState[r][c];
      if (v === BLACK || v === WHITE) place(r * SIZE + c, v);
    }
  }

  function findBestMove(state) {
    const started = now();
    const boardState = (state && state.board) || (typeof board !== 'undefined' && board) || null;
    const color = (state && state.color) || (typeof aiColor !== 'undefined' && aiColor) || BLACK;
    if (!boardState) throw new Error('Gomoku-Satori 缺少棋盘');
    loadBoard(boardState);
    // 每次搜索重新开始记录，避免展示页把上一步的事件混进来。
    if (trace) {
      trace.events = []; trace.count = 0;
      trace.tree = []; trace.treeCount = 0; trace.treeTruncated = false; trace.overflowed = false;
      trace.stack = []; trace.iteration = 0;
    }

    const opp = 3 - color;
    // 埋点：本步的威胁普查（双方成五点、活四/冲四/活三总数），展示页用它解释
    // 引擎在搜索前“看到”了哪些威胁。关闭埋点时跳过，不产生额外扫描。
    if (trace) traceEvent('threat-scan', threatCensus(color));

    const myFiveNow = completionCells(color);
    if (myFiveNow.length) {
      if (trace) traceEvent('decision', { reason: 'immediate-win', move: cellToMove(myFiveNow[0]), options: myFiveNow.map(cellToMove) });
      lastSearch = { reason: 'immediate-win', depth: 0, nodes: 0, candidates: myFiveNow.length, elapsedMs: Math.round(now() - started) };
      return cellToMove(myFiveNow[0]);
    }
    const oppFiveNow = completionCells(opp);
    if (oppFiveNow.length) {
      if (trace) traceEvent('decision', { reason: 'forced-block', move: cellToMove(oppFiveNow[0]), options: oppFiveNow.map(cellToMove) });
      lastSearch = { reason: 'forced-block', depth: 0, nodes: 0, candidates: oppFiveNow.length, elapsedMs: Math.round(now() - started) };
      return cellToMove(oppFiveNow[0]);
    }
    if (!stones) {
      const mid = Math.floor(SIZE / 2);
      if (trace) traceEvent('decision', { reason: 'opening-center', move: { row: mid, col: mid } });
      lastSearch = { reason: 'opening-center', depth: 0, nodes: 0, candidates: 1, elapsedMs: Math.round(now() - started) };
      return { row: mid, col: mid };
    }

    // 精确的连续冲四证明
    const proof = vcfProof(color, VCF_DEPTH);
    if (proof) {
      if (trace) traceEvent('decision', {
        reason: 'vcf-win', move: cellToMove(proof[0]),
        proof: { kind: 'VCF', steps: proof.map(cellToMove) }
      });
      lastSearch = { reason: 'vcf-win', depth: proof.length, nodes: 0, candidates: 1, elapsedMs: Math.round(now() - started) };
      return cellToMove(proof[0]);
    }

    // VCT：冲四 + 活三交替的强制胜证明（独立时间片，超时不采信）
    const vct = vctProof(color, VCT_DEPTH, VCT_MS);
    if (vct) {
      if (trace) traceEvent('decision', {
        reason: 'vct-win', move: cellToMove(vct[0]),
        proof: { kind: 'VCT', steps: vct.map(cellToMove) }, nodes: vctNodes
      });
      lastSearch = { reason: 'vct-win', depth: vct.length, nodes: vctNodes, candidates: 1, elapsedMs: Math.round(now() - started) };
      return cellToMove(vct[0]);
    }

    // 迭代加深
    deadline = started + THINK_MS;
    aborted = false;
    nodes = 0;
    let bestCell = -1, bestScore = 0, reachedDepth = 0;
    for (let depth = 2; depth <= MAX_DEPTH; depth += 1) {
      const rootMoves = orderedCandidates(color, bestCell, 0);
      if (!rootMoves.length) break;
      // 埋点相关变量只在开启时才计算，关闭时本层与加埋点前完全一致。
      const depthStarted = trace ? now() : 0, depthNodesBefore = trace ? nodes : 0;
      // 树缓冲按层重置：只保留最深一层完成迭代的搜索树。
      if (trace) { trace.tree = []; trace.treeCount = 0; trace.iteration++; }
      let alpha = -WIN * 2, localBest = -1, localScore = -WIN * 2;
      const rootScores = trace ? [] : null;
      // 根节点：树的可视化需要它作为所有候选的总入口。
      let rootNodeId = -1;
      if (trace) {
        rootNodeId = ++trace.nextNodeId;
        trace.stack = [rootNodeId];
        traceNode('node-open', { nodeId: rootNodeId, parentId: -1, ply: 0, depth, color, alpha, beta: -WIN * 2, move: null, root: true });
      }
      for (const cell of rootMoves) {
        place(cell, color);
        // 根候选的着法先写入 moveByPly[1]，这样这一支的 node-open 才带得上标签。
        if (trace) trace.moveByPly[1] = { row: (cell / SIZE) | 0, col: cell % SIZE };
        let v;
        if (runLenThrough(cell, color) >= 5) v = WIN;
        else v = -negamax(depth - 1, -WIN * 2, -alpha, opp, 1);
        undo(cell, color);
        if (trace) trace.moveByPly[1] = null;
        if (aborted) break;
        if (rootScores) rootScores.push({ row: (cell / SIZE) | 0, col: cell % SIZE, score: v | 0 });
        if (v > localScore) { localScore = v; localBest = cell; }
        if (v > alpha) alpha = v;
      }
      if (trace && rootNodeId >= 0) {
        trace.stack = [];
        traceNode('node-close', { nodeId: rootNodeId, ply: 0, depth, color, value: localScore | 0, move: null, root: true });
      }
      if (aborted) break;
      if (localBest >= 0) { bestCell = localBest; bestScore = localScore; reachedDepth = depth; }
      // 埋点：记录这一层迭代的完整结果——根候选逐个分数、本层节点数与耗时、
      // 以及是否因为“已证明胜负”提前收敛。这正是展示页“逐层变强”的证据。
      if (trace) traceEvent('iteration', {
        depth, nodes: nodes - depthNodesBefore, elapsedMs: Math.round(now() - depthStarted),
        best: { row: (bestCell / SIZE) | 0, col: bestCell % SIZE }, score: bestScore | 0,
        candidates: rootScores,
        converged: bestScore >= WIN - 100 || bestScore <= -(WIN - 100)
      });
      if (bestScore >= WIN - 100 || bestScore <= -(WIN - 100)) break; // 已证明胜负
      if (now() > deadline) break;
    }
    if (bestCell < 0) {
      const fallback = candidateCells();
      bestCell = fallback.length ? fallback[0] : 0;
      if (trace) traceEvent('decision', { reason: 'fallback', move: cellToMove(bestCell) });
      lastSearch = { reason: 'fallback', depth: 0, nodes, candidates: fallback.length, elapsedMs: Math.round(now() - started) };
      return cellToMove(bestCell);
    }
    if (trace) traceEvent('decision', {
      reason: 'search', move: cellToMove(bestCell), depth: reachedDepth, score: bestScore | 0
    });
    lastSearch = {
      reason: 'search', depth: reachedDepth, configuredDepth: MAX_DEPTH,
      nodes, score: bestScore, candidates: candidateCells().length,
      elapsedMs: Math.round(now() - started)
    };
    return cellToMove(bestCell);
  }

  // ---- 威胁普查（展示页与埋点共用）------------------------------------------
  // 统计双方在当前局面的即时威胁：成五点（能立刻连五）、能造出成五点的着法
  // （冲四/活四候选）、能造出活三的着法。这是引擎在搜索前对局面的“第一眼”。
  function threatCensus(color) {
    const scan = (side) => {
      const fivePoints = completionCells(side);
      let fours = 0, openThrees = 0;
      for (const cell of candidateCells()) {
        if (createsThreat(cell, side)) fours++;
        else if (createsOpenThree(cell, side)) openThrees++;
      }
      return {
        fivePoints: fivePoints.map((c) => ({ row: (c / SIZE) | 0, col: c % SIZE })),
        fours, openThrees
      };
    };
    return { color, mine: scan(color), theirs: scan(3 - color) };
  }

  function cellToMove(cell) { return { row: (cell / SIZE) | 0, col: cell % SIZE }; }

  window.GomokuSatori = {
    findBestMove,
    preload: () => Promise.resolve(),
    clearCache() { reset(); },
    timeMs: THINK_MS,
    depth: MAX_DEPTH,
    get lastSearch() { return lastSearch; },
    // ---- 剖析接口（仅展示页使用）--------------------------------------------
    // setTrace(null) 关闭埋点；关闭后引擎行为与未加埋点时完全一致。
    // 事件在每次 findBestMove 开始时清空，结束后由调用方取走。
    setTrace(options) {
      if (!options) { trace = null; return; }
      trace = {
        events: [], count: 0,
        maxEvents: options.maxEvents || 20000,
        treePly: options.treePly === undefined ? 3 : options.treePly,
        treeMax: options.treeMax || 4000,
        candidatePly: options.candidatePly === undefined ? 1 : options.candidatePly,
        tree: [], treeCount: 0, treeTruncated: false, overflowed: false,
        stack: [], nextNodeId: 0, moveByPly: [], iteration: 0
      };
    },
    get traceEvents() { return trace ? trace.events : []; },
    get traceTree() { return trace ? trace.tree : []; },
    get traceMeta() {
      if (!trace) return null;
      return {
        events: trace.count, maxEvents: trace.maxEvents,
        treeEvents: trace.treeCount, treeMax: trace.treeMax, iteration: trace.iteration,
        treePly: trace.treePly, candidatePly: trace.candidatePly,
        treeTruncated: trace.treeTruncated, overflowed: trace.overflowed
      };
    },
    threatCensus: (color) => threatCensus(color)
  };
})();
