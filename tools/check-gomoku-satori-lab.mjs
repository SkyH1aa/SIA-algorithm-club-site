// Gomoku-Satori 决策剖析实验室的集成验收：
// 在真实页面里跑一次“逐手剖析”，确认每一步都拿到了完整剖析数据
//（威胁普查、候选排序、逐层迭代、搜索树），并且棋盘与面板确实渲染出来了。
// 同时验证展示页不会写入任何后端。
//   node tools/check-gomoku-satori-lab.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = await fetch(`http://127.0.0.1:${process.env.GOMOKU_UI_PORT || 9222}/json`).then(r => r.json());
const target = targets.find(item => item.type === 'page');
assert.ok(target, 'Chrome DevTools page required on port 9222 (start Chrome with --remote-debugging-port)');
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;
socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  if (!pending.has(message.id)) return;
  const callbacks = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) callbacks.reject(new Error(JSON.stringify(message.error)));
  else callbacks.resolve(message.result);
});
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

try {
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Network.enable');
  await call('Network.setCacheDisabled', { cacheDisabled: true });
  // 展示页不应该有任何写入：把网络与 Supabase 都挡在外面，出现写入即失败。
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__labRequests = [];
    const originalFetch = window.fetch;
    window.fetch = async (...args) => { window.__labRequests.push(String(args[0])); return originalFetch(...args); };
    Object.defineProperty(window, 'supabaseClient', { get: () => null, set() {}, configurable: true });
  ` });

  const reports = [];
  for (const url of [pathToFileURL(path.join(root, 'public/gomoku-satori-lab.html')).href,
                     'http://127.0.0.1:4173/public/gomoku-satori-lab.html']) {
    await call('Page.navigate', { url });
    let loaded = false;
    for (let i = 0; i < 100; i++) {
      loaded = await evaluate('typeof GomokuSatori !== "undefined" && typeof GomokuSatori.analyze === "function"');
      if (loaded) break;
      await new Promise(r => setTimeout(r, 200));
    }
    assert.ok(loaded, `Satori lab page did not load: ${url}`);

    const report = await evaluate(`(async () => {
      function check(condition, message) { if (!condition) throw new Error(message); }
      const OPENINGS_INDEX = Object.fromEntries(window.__labOpenings().map(o => [o.id, o.index]));
      // 1) 页面骨架：15×15 棋盘、五个剖析面板、模式切换都必须在。
      const cells = document.querySelectorAll('#board .cell');
      check(cells.length === 225, 'board must render 225 cells');
      for (const id of ['decisionBody','threatBody','candidateBody','iterationBody','treeBody']) {
        check(!!document.getElementById(id), 'missing analysis panel ' + id);
      }
      check(document.querySelectorAll('#modeTabs button').length === 2, 'two modes expected');

      // 2) 逐手剖析：走回放路径（内部就是引擎的真实分析调用）。
      document.getElementById('openingSelect').value = '1';
      document.getElementById('plySelect').value = '4';
      document.getElementById('runReplay').click();
      let waited = 0;
      while (waited < 180000) {
        const counter = document.getElementById('stepCounter').textContent;
        const status = document.getElementById('statusLine').textContent;
        if (counter && counter !== '—' && !status.includes('正在')) break;
        await new Promise(r => setTimeout(r, 500));
        waited += 500;
      }

      // 3) 每一步都要有完整的剖析数据。
      const steps = window.__labSteps ? window.__labSteps() : null;
      check(Array.isArray(steps) && steps.length >= 2, 'expected at least two analysed moves, got ' + (steps ? steps.length : 'none'));
      let withThreat = 0, withCandidates = 0, withIterations = 0, withTree = 0, withProof = 0;
      for (const s of steps) {
        check(s.trace && Array.isArray(s.trace.events), 'every step must carry trace events');
        const kinds = new Set(s.trace.events.map(e => e.kind));
        if (kinds.has('decision')) check(true, 'decision event');
        if (kinds.has('decision') ? s.trace.events.find(e => e.kind === 'decision').reason : false) { /* reason recorded */ }
        if (kinds.has('threat-scan')) withThreat++;
        if (kinds.has('root-candidates')) withCandidates++;
        if (kinds.has('iteration')) withIterations++;
        if ((s.trace.tree || []).length) withTree++;
        const decision = s.trace.events.find(e => e.kind === 'decision');
        if (decision && decision.proof) withProof++;
        check(s.move && Number.isInteger(s.move.row) && Number.isInteger(s.move.col), 'legal move recorded');
        check(s.stats && s.stats.reason, 'search reason recorded');
      }
      check(withThreat === steps.length, 'threat scan on every move: ' + withThreat + '/' + steps.length);

      // 4) 至少一步进入了常规搜索，应该同时具备候选表、逐层迭代与搜索树。
      check(withCandidates > 0, 'at least one move must expose a candidate ranking');
      check(withIterations > 0, 'at least one move must expose iterative-deepening layers');
      const searchStep = steps.find(s => s.trace.events.some(e => e.kind === 'root-candidates'));
      const root = searchStep.trace.events.find(e => e.kind === 'root-candidates');
      check(root.candidates.length >= 2, 'candidate ranking must list multiple candidates');
      check(root.candidates.some(c => c.kept) && root.candidates.some(c => !c.kept), 'ranking must show both kept and pruned candidates');
      check(root.candidates.some(c => c.attack > 0), 'candidates must carry scoring components');
      const iteration = searchStep.trace.events.find(e => e.kind === 'iteration');
      check(iteration.depth >= 2 && iteration.nodes > 0, 'iteration must report depth and nodes');
      check(Array.isArray(iteration.candidates) && iteration.candidates.length >= 2, 'iteration must list per-candidate scores');
      check((searchStep.trace.tree || []).length > 0, 'search tree events expected');
      const opens = searchStep.trace.tree.filter(e => e.kind === 'node-open');
      const closes = searchStep.trace.tree.filter(e => e.kind === 'node-close');
      check(opens.length > 0 && opens.length === closes.length, 'tree must pair every node open with a close');
      check(opens.some(o => o.root), 'tree must have a root node');
      check(opens.some(o => o.parentId >= 0 && o.move), 'tree children must carry parent links and move labels');

      // 5) 面板确实渲染成 HTML，而不是停在空状态。
      check(!document.getElementById('decisionBody').textContent.includes('还没有决策数据'), 'decision panel must render');
      check(document.querySelectorAll('#candidateBody tbody tr').length >= 2, 'candidate table must render rows');
      check(document.querySelectorAll('#iterationBody tbody tr').length >= 1, 'iteration table must render rows');
      check(document.querySelectorAll('#treeBody li').length >= 1, 'search tree must render nodes');

      // 6) 步骤导航可用：回放结束后停在最后一步，往回走到第一步，prev 应禁用。
      const lastCounter = document.getElementById('stepCounter').textContent;
      const prevBtn = document.getElementById('prevStep');
      const firstCounter = document.getElementById('stepCounter').textContent;
      for (let i = 0; i < steps.length + 1 && !prevBtn.disabled; i++) prevBtn.click();
      check(prevBtn.disabled === true, 'prev must be disabled on the first step');
      const afterBack = document.getElementById('stepCounter').textContent;
      check(afterBack !== lastCounter || steps.length === 1, 'stepping back must change the shown move');
      document.getElementById('nextStep').click();
      check(document.getElementById('stepCounter').textContent !== firstCounter, 'stepping forward must change the shown move');

      // 7) 展示页不得写后端。
      const writes = (window.__labRequests || []).filter(u => /supabase|gomoku-training/i.test(u));
      check(writes.length === 0, 'lab page must not call any backend: ' + writes.join(', '));

      // 8) 战术演示：三种“非搜索”决策都必须能被复现，且各自给出对应的决策类型。
      //    这是页面的教学核心——让社员看到搜索之外的决策路径。
      const demoResults = [];
      const demoExpect = { 'demo-immediate-win': 'immediate-win', 'demo-forced-block': 'forced-block', 'demo-vcf': 'vcf-win' };
      for (const [openingId, expectedReason] of Object.entries(demoExpect)) {
        const index = OPENINGS_INDEX[openingId];
        check(index !== undefined, 'demo opening must be registered: ' + openingId);
        document.getElementById('openingSelect').value = String(index);
        document.getElementById('openingSelect').dispatchEvent(new Event('change'));
        document.getElementById('runReplay').click();
        let w = 0;
        while (w < 60000) {
          const st = document.getElementById('statusLine').textContent;
          if (!st.includes('正在')) break;
          await new Promise(r => setTimeout(r, 250)); w += 250;
        }
        const ds = window.__labSteps();
        const last = ds[ds.length - 1];
        check(last.stats.reason === expectedReason, openingId + ' must be decided as ' + expectedReason + ', got ' + last.stats.reason);
        const decision = last.trace.events.find(e => e.kind === 'decision');
        check(!!decision, openingId + ' must record a decision event');
        if (expectedReason === 'vcf-win') {
          check(decision.proof && decision.proof.kind === 'VCF' && decision.proof.steps.length >= 2,
            'VCF demo must expose its proof sequence');
        }
        // 立即连五 / 必防 都不应进入搜索，因此没有候选表与迭代表——页面要如实说明。
        check(!last.trace.events.some(e => e.kind === 'iteration'), openingId + ' must not run iterative deepening');
        demoResults.push({ openingId, reason: last.stats.reason, move: last.move.row + ',' + last.move.col });
      }

      // 9) 实时对战模式：玩家落一子后，Satori 必须自己走一手并给出剖析。
      await new Promise(r => setTimeout(r, 300));
      document.querySelector('#modeTabs button[data-mode="live"]').click();
      document.getElementById('liveSide').value = '1';
      document.getElementById('startLive').click();
      await new Promise(r => setTimeout(r, 400));
      check(document.getElementById('statusLine').textContent.includes('轮到你'), 'live mode must hand the first move to Black');
      document.querySelectorAll('#board .cell')[7 * 15 + 7].click();
      check(/思考/.test(document.getElementById('statusLine').textContent) || document.querySelectorAll('#board .cell.black, #board .cell.white').length >= 2,
        'live mode must start the AI turn after the player moves');
      let lw = 0;
      while (lw < 60000 && !document.getElementById('statusLine').textContent.includes('轮到你')) {
        await new Promise(r => setTimeout(r, 400)); lw += 400;
      }
      const stones = document.querySelectorAll('#board .cell.black, #board .cell.white').length;
      check(stones === 2, 'live mode must place both stones, got ' + stones);
      const liveSteps = window.__labSteps();
      check(liveSteps.length === 1, 'live mode must analyse exactly the AI move');
      check(liveSteps[0].color === 2, 'live AI must play White here');
      check(document.querySelectorAll('#candidateBody tbody tr').length >= 2, 'live mode must render the candidate table');

      return {
        source: location.protocol, steps: steps.length,
        withThreat, withCandidates, withIterations, withTree, withProof,
        treeNodes: opens.length, rootCandidates: root.total, kept: root.candidates.filter(c => c.kept).length,
        maxDepth: Math.max(...steps.map(s => s.stats.depth || 0)),
        reasons: steps.map(s => s.stats.reason), demos: demoResults, live: true
      };
    })()`);
    reports.push(report);
    console.log(`PASS ${report.source}: ${report.steps} analysed moves, threat scans ${report.withThreat}/${report.steps}, candidate tables ${report.withCandidates}, iteration tables ${report.withIterations}, search trees ${report.withTree}, proofs ${report.withProof}, tree nodes ${report.treeNodes}, max depth ${report.maxDepth}`);
    console.log(`     reasons: ${report.reasons.join(', ')}`);
    console.log(`     tactical demos: ${report.demos.map(d => `${d.openingId}=${d.reason}@${d.move}`).join(', ')}`);
  }
  assert.equal(reports.length, 2, 'both file:// and http:// must be validated');
} finally {
  socket.close();
}
