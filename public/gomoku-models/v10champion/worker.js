/**
 * Classic Worker bridge for Rapfi (GPL-3).
 * Isolated from the main MeTool bundle: only Piskvork text I/O crosses the boundary.
 *
 * Think:    { op:'think', id, boardSize, timeoutTurnMs, maxDepth?, maxNodes?,
 *             playerIsBlack, stoneHistory }
 * Preload:  { op:'preload', id }
 * Response think:    { type:'result'|'error', id, move? | error? }
 * Response preload:  { type:'ready'|'error', id }
 * Progress: { type:'loading', loaded, total, progress }  (no id; data download)
 *
 * 本目录为自由 Mix9 瘦包：不含连珠网。请求里的 renju 一律忽略，固定 RULE 0。
 *
 * 时间相关 INFO（Rapfi 时间管理）：
 * - TIMEOUT_TURN：本步最多想多久（ms）
 * - TIME_LEFT：整局还剩多少时间（ms）。Rapfi 会按「剩余手数」分配局时；
 *   若设成与 TIMEOUT_TURN 同值，实际每步往往只用到 turn/≈22，棋力明显变弱。
 *   浏览器对战没有真实棋钟，因此固定给充足局时（600s），由 TIMEOUT_TURN 卡单步。
 *
 * 复杂度硬上限（比时间更稳）：
 * - MAX_DEPTH：迭代加深深度上限
 * - MAX_NODE：搜索节点数上限（0 = 不限制）
 */
/* eslint-disable no-undef */
'use strict'

var RapfiFactory = typeof Rapfi === 'function' ? Rapfi : null
if (!RapfiFactory) {
  var module = { exports: {} }
  var exports = module.exports
  try {
    importScripts('./rapfi-single.js')
  } catch (error) {
    self.postMessage({ type: 'error', id: 0, error: 'Rapfi 脚本加载失败: ' + (error && error.message ? error.message : String(error)) })
    throw error
  }
  RapfiFactory = module.exports
}

/** 默认深度上限（请求未传 maxDepth 时） */
var DEFAULT_MAX_DEPTH = 10
/** 默认节点上限；0 = 不限制（请求显式传 0 时须保留，勿用 ||） */
var DEFAULT_MAX_NODES = 150000

var eng = null
var engReady = null
var inlineAssets = null
var lineWaiter = null
var lineQueue = []
/** 串行化 think/preload，避免取消后新请求与未完成搜索交叉 */
var opChain = Promise.resolve()

function baseUrl() {
  return self.location.href.replace(/[^/]+$/, '')
}

function locateFile(url) {
  if (/^rapfi.*\.data$/.test(url)) return baseUrl() + 'rapfi.data'
  return baseUrl() + url
}

function parseForbid(tail) {
  var out = []
  var chunks = String(tail || '').match(/.{4}/g) || []
  for (var i = 0; i < chunks.length; i++) {
    var m = chunks[i].match(/([0-9][0-9])([0-9][0-9])/)
    if (!m) continue
    out.push({ row: +m[1], col: +m[2] })
  }
  return out
}

function pushStdout(line) {
  line = String(line || '').trim()
  if (!line) return

  var parsed = null
  if (/^\d+,\d+$/.test(line)) {
    var parts = line.split(',')
    parsed = { kind: 'move', move: { row: +parts[0], col: +parts[1] } }
  } else if (line.indexOf('FORBID') === 0) {
    var space = line.indexOf(' ')
    var tail = space >= 0 ? line.substring(space + 1) : ''
    parsed = { kind: 'forbid', forbid: parseForbid(tail) }
  } else if (line.indexOf('ERROR') === 0) {
    parsed = { kind: 'error', error: line }
  } else {
    // MESSAGE / INFO / OK — ignore for waiters
    return
  }

  if (lineWaiter) {
    var w = lineWaiter
    lineWaiter = null
    w(parsed)
  } else {
    lineQueue.push(parsed)
  }
}

function waitLine(predicate, ms) {
  return new Promise(function (resolve, reject) {
    var tryQueued = function () {
      for (var i = 0; i < lineQueue.length; i++) {
        if (predicate(lineQueue[i])) {
          return lineQueue.splice(i, 1)[0]
        }
      }
      return null
    }
    var hit = tryQueued()
    if (hit) {
      resolve(hit)
      return
    }
    var t = setTimeout(function () {
      lineWaiter = null
      reject(new Error('Rapfi response timeout'))
    }, ms)
    lineWaiter = function (res) {
      if (!predicate(res)) {
        lineQueue.push(res)
        return
      }
      clearTimeout(t)
      lineWaiter = null
      resolve(res)
    }
  })
}

/** Cache Storage：首次下载后写入，刷新/再进页从本地读，避免再走网络进度条 */
var MIX9_CACHE = 'metool-gomoku-mix9'
var MIX9_DATA_BYTES = 10060098

function replyLoading(loaded, total, fromCache) {
  reply({
    type: 'loading',
    loaded: loaded,
    total: total,
    progress: total ? loaded / total : 0,
    fromCache: !!fromCache,
  })
}

function readBodyProgress(res, fallbackTotal) {
  var total = Number(res.headers.get('Content-Length')) || fallbackTotal
  if (!res.body || !res.body.getReader) return res.arrayBuffer()
  var reader = res.body.getReader()
  var chunks = []
  var received = 0
  function pump() {
    return reader.read().then(function (result) {
      if (result.done) {
        var out = new Uint8Array(received)
        var offset = 0
        for (var i = 0; i < chunks.length; i++) {
          out.set(chunks[i], offset)
          offset += chunks[i].length
        }
        return out.buffer
      }
      chunks.push(result.value)
      received += result.value.length
      replyLoading(received, total, false)
      return pump()
    })
  }
  replyLoading(0, total, false)
  return pump()
}

function fetchMix9Data(url) {
  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error(res.status + ': ' + url)
    var cloned = null
    try { cloned = res.clone() } catch (err) {}
    return readBodyProgress(res, MIX9_DATA_BYTES).then(function (buf) {
      if (cloned && typeof caches !== 'undefined') {
        caches.open(MIX9_CACHE).then(function (cache) {
          return cache.put(url, cloned)
        }).catch(function () {})
      }
      return buf
    })
  })
}

function loadMix9Data() {
  var url = locateFile('rapfi.data')
  if (typeof caches === 'undefined') return fetchMix9Data(url)
  return caches.open(MIX9_CACHE).then(function (cache) {
    return cache.match(url).then(function (hit) {
      if (!hit) return fetchMix9Data(url)
      replyLoading(MIX9_DATA_BYTES, MIX9_DATA_BYTES, true)
      return hit.arrayBuffer()
    })
  }).catch(function () {
    return fetchMix9Data(url)
  })
}

function ensureEngine() {
  if (engReady) return engReady
  // file:// cannot fetch binary files from an opaque origin. The page passes
  // the same bytes through a Blob Worker; HTTP(S) still uses the normal cache.
  var data = inlineAssets ? Promise.resolve(inlineAssets.data) : loadMix9Data()
  engReady = data.then(function (buf) {
    return RapfiFactory({
      locateFile: locateFile,
      getPreloadedPackage: function () { return buf },
      wasmBinary: inlineAssets ? inlineAssets.wasm : undefined,
      onReceiveStdout: pushStdout,
      onReceiveStderr: function (o) {
        console.error('[rapfi]', o)
      },
      setStatus: function () {},
      onExit: function () {},
    })
  }).then(function (instance) {
    eng = instance
    return eng
  })
  return engReady
}

function pieceToColor(piece, playerIsBlack) {
  if (playerIsBlack) return piece === 'player' ? 1 : 2
  return piece === 'ai' ? 1 : 2
}

function buildBoardBody(stoneHistory, playerIsBlack) {
  var parts = []
  for (var i = 0; i < stoneHistory.length; i++) {
    var s = stoneHistory[i]
    parts.push(s.row + ',' + s.col + ',' + pieceToColor(s.piece, playerIsBlack))
  }
  return parts.join(' ')
}

function reply(msg) {
  self.postMessage(msg)
}

function applyRule() {
  // 本包只有自由 Mix9；连珠请走 /games/gomoku/rapfi/
  eng.sendCommand('INFO RULE 0')
}

/** 每次 START 后重发：Rapfi 在 START 时会重置部分 option */
function applyThinkLimits(timeoutTurnMs, maxDepth, maxNodes) {
  eng.sendCommand('INFO TIMEOUT_TURN ' + timeoutTurnMs)
  // 充足局时：让 TIMEOUT_TURN 真正成为单步上限（勿把 TIME_LEFT 设成 turn）
  eng.sendCommand('INFO TIME_LEFT 600000')
  // 只有显式指定深度时才覆盖；maxDepth <= 0 表示沿用 config.toml 的
  // max_search_depth（官方发布版为 99），这才是冠军配置的行为。
  if (maxDepth > 0) eng.sendCommand('INFO MAX_DEPTH ' + maxDepth)
  eng.sendCommand('INFO MAX_NODE ' + maxNodes)
  eng.sendCommand('INFO SHOW_DETAIL 1')
}

function handleOp(req) {
  var id = req.id
  var op = req.op || 'think'
  var timeoutTurnMs = Math.max(500, Number(req.timeoutTurnMs) || 5000)
  // ?? 保留显式 0（MAX_NODE 不限制）；|| 会把 0 误判成缺省
  // 0（或负数）保留 config 的 max_search_depth；否则作为显式上限
  var requestedDepth = Number(req.maxDepth ?? DEFAULT_MAX_DEPTH)
  var maxDepth = Number.isFinite(requestedDepth) && requestedDepth > 0 ? Math.max(2, requestedDepth) : 0
  var maxNodes = Math.max(0, Number(req.maxNodes ?? DEFAULT_MAX_NODES))
  var boardSize = Number(req.boardSize) || 15
  var playerIsBlack = !!req.playerIsBlack
  var stoneHistory = req.stoneHistory || []

  if (req.inlineAssets) inlineAssets = req.inlineAssets

  return ensureEngine()
    .then(function () {
      if (op === 'preload') {
        reply({ type: 'ready', id: id })
        return null
      }
      if (op === 'forbid') {
        reply({ type: 'forbid', id: id, forbid: [] })
        return null
      }

      lineQueue.length = 0
      lineWaiter = null
      applyRule()
      eng.sendCommand('START ' + boardSize)
      applyThinkLimits(timeoutTurnMs, maxDepth, maxNodes)

      var body = buildBoardBody(stoneHistory, playerIsBlack)
      if (!body) {
        eng.sendCommand('BEGIN')
      } else {
        eng.sendCommand('BOARD ' + body + ' DONE')
      }
      return waitLine(function (r) {
        return r && (r.kind === 'move' || r.kind === 'error')
      }, timeoutTurnMs + 8000).then(function (r) {
        if (r.kind === 'error') {
          reply({ type: 'error', id: id, error: r.error })
          return
        }
        var move = r.move
        if (
          !move
          || move.row < 0
          || move.col < 0
          || move.row >= boardSize
          || move.col >= boardSize
        ) {
          reply({ type: 'error', id: id, error: 'illegal Rapfi move' })
          return
        }
        reply({ type: 'result', id: id, move: move })
      })
    })
}

self.onmessage = function (e) {
  var req = e.data || {}
  opChain = opChain.then(function () {
    return handleOp(req)
  }).catch(function (err) {
    reply({
      type: 'error',
      id: req.id,
      error: err && err.message ? err.message : String(err),
    })
  })
}
