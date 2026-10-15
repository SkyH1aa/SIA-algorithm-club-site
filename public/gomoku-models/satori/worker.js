/**
 * Gomoku-Satori 的独立 Worker 桥接。
 *
 * 引擎是纯 JavaScript（无 WASM、无权重文件、无网络请求），本文件只负责
 * 把页面请求转成引擎调用，再把落点与遥测回传。引擎与页面共享同一份源码，
 * 因此 HTTP 与 file:// 两种来源跑的是同一套字节。
 *
 * 请求：{ op:'think', id, board, color, timeMs? }
 * 应答：{ type:'result', id, move, stats } / { type:'error', id, error }
 *       { type:'ready', id }（preload）
 */
'use strict';

var engine = null;

function ensureEngine() {
  if (engine) return engine;
  // 离线包会把引擎源码拼在本文件之前，那种情况下引擎已经就绪，不能再
  // importScripts（Blob Worker 没有可解析的相对路径）。
  if (!self.GomokuSatori) {
    // 引擎按 window.GomokuSatori 暴露；Worker 里没有 window，先把它指向 self。
    self.window = self;
    importScripts('./engine.js');
  }
  engine = self.GomokuSatori;
  if (!engine) throw new Error('Gomoku-Satori 引擎脚本未正确加载');
  return engine;
}

self.onmessage = function (event) {
  var request = event.data || {};
  var id = request.id;
  try {
    ensureEngine();
    if (request.op === 'preload') {
      self.postMessage({ type: 'ready', id: id });
      return;
    }
    if (request.op !== 'think') throw new Error('未知的请求类型：' + request.op);
    var board = request.board;
    var color = request.color;
    if (!Array.isArray(board) || ![1, 2].includes(color)) throw new Error('Gomoku-Satori 请求缺少棋盘或执子颜色');
    // 展示页会传 trace 选项以取回完整决策剖析；不传则埋点保持关闭，
    // 对局结果、耗时与正式页面完全一致。
    if (engine.setTrace) engine.setTrace(request.trace || null);
    var started = Date.now();
    var move = engine.findBestMove({ board: board, color: color });
    if (!move || !Number.isInteger(move.row) || !Number.isInteger(move.col)) throw new Error('Gomoku-Satori 未返回合法落点');
    if (board[move.row] === undefined || board[move.row][move.col] !== 0) throw new Error('Gomoku-Satori 返回了非法落点');
    self.postMessage({
      type: 'result',
      id: id,
      move: move,
      stats: Object.assign({}, engine.lastSearch, { elapsedMs: Math.round(Date.now() - started) }),
      trace: request.trace
        ? { events: engine.traceEvents, tree: engine.traceTree, meta: engine.traceMeta }
        : null
    });
  } catch (error) {
    self.postMessage({ type: 'error', id: id, error: error && error.message ? error.message : String(error) });
  }
};
