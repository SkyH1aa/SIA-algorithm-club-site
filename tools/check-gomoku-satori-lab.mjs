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
      // 0) i18n 回归：本页大量文案由脚本生成，若在词典就绪前取过一次且不再刷新，
      //    页面会永久显示原始 key（已踩过：satoriLab.noData 之类）。这里在
      //    静态渲染后与跑完分析后各查一遍，任何残留 key 都算失败。
      function findKeyLeaks() {
        const leaks = [];
        for (const el of document.querySelectorAll('body *')) {
          if (el.children.length) continue;
          const text = (el.textContent || '').trim();
          if (/^satoriLab[a-zA-Z0-9_.]*$/.test(text)) leaks.push(el.tagName + ':' + text);
        }
        for (const select of document.querySelectorAll('select')) {
          for (const option of select.options) {
            const text = (option.textContent || '').trim();
            if (/^satoriLab[a-zA-Z0-9_.]*$/.test(text)) leaks.push('OPTION:' + select.id + ':' + text);
          }
        }
        return [...new Set(leaks)];
      }
      const initialLeaks = findKeyLeaks();
      check(initialLeaks.length === 0, 'i18n keys must resolve on first paint: ' + initialLeaks.join(', '));

      // 1) 页面骨架：15×15 棋盘、五个剖析面板、模式切换都必须在。
      const cells = document.querySelectorAll('#board .cell');
      check(cells.length === 225, 'board must render 225 cells');
      for (const id of ['decisionBody','threatBody','candidateBody','iterationBody','treeBody']) {
        check(!!document.getElementById(id), 'missing analysis panel ' + id);
      }
      check(document.querySelectorAll('#modeTabs button').length === 2, 'two modes expected');

      // 等待条件必须看“这一次运行是否真正结束”，而不是看状态行文案或 steps 数量：
      // 演示路径点击后状态行会立刻变成结果（异步分析还没写完），而每个战术演示
      // 都恰好产出 1 步，长度会回到原值。页面为此暴露了 runSeq。
      async function runAndWaitForStep() {
        const beforeSeq = window.__labRun().seq;
        document.getElementById('runReplay').click();
        let waited = 0;
        while (waited < 180000) {
          const run = window.__labRun();
          if (run.seq > beforeSeq && !run.busy) break;
          await new Promise(r => setTimeout(r, 250)); waited += 250;
        }
        return window.__labSteps();
      }

      // 2) 逐手剖析：走回放路径（内部就是引擎的真实分析调用）。
      document.getElementById('openingSelect').value = '1';
      document.getElementById('openingSelect').dispatchEvent(new Event('change'));
      document.getElementById('plySelect').value = '4';
      const steps = await runAndWaitForStep();
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

      // 7b) 主题适配：亮色与暗色都必须可读。本站有多条全站 !important 规则
      //     （.board / .btn / select 等）会覆盖页面自有样式，必须逐项核对——
      //     曾经出现亮色下白字压白底、棋盘被刷成纯白的问题。
      // 注意：这段代码整体位于 Node 的模板字符串里，正则的反斜杠会被吞掉，
      // 因此颜色解析一律不用正则，改为直接切分 computed 值。
      function parseColor(text) {
        const raw = String(text || '');
        const open = raw.indexOf('(');
        if (open < 0 || raw.indexOf('rgb') !== 0) return null;
        const parts = raw.slice(open + 1, raw.lastIndexOf(')')).split(',');
        if (parts.length < 3) return null;
        const num = i => parseFloat(parts[i]);
        return { r: num(0), g: num(1), b: num(2), a: parts.length > 3 ? parseFloat(parts[3]) : 1 };
      }
      function composite(fg, bg) {
        if (fg.a >= 1) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
        return { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
      }
      function effectiveBg(el) {
        const layers = [];
        for (let node = el; node; node = node.parentElement) {
          const c = parseColor(getComputedStyle(node).backgroundColor);
          if (c && c.a > 0) layers.push(c);
        }
        let base = { r: 255, g: 255, b: 255, a: 1 };
        for (let i = layers.length - 1; i >= 0; i--) base = composite(layers[i], base);
        return base;
      }
      function relativeLum(c) {
        const s = [c.r, c.g, c.b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
      }
      function contrastOf(el) {
        const fg = parseColor(getComputedStyle(el).color);
        if (!fg) return null;
        const bg = effectiveBg(el);
        const f = composite(fg, bg);
        const l1 = relativeLum(f), l2 = relativeLum(bg);
        const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
        return (hi + 0.05) / (lo + 0.05);
      }
      // 主题必须用站内 API 固定：theme.js 在 auto 模式下会按北京时间自动切换，
      // 直接改 data-theme 属性会被它覆盖，测出的结果不可信。
      function setTheme(theme) {
        if (window.ClubTheme && typeof ClubTheme.setMode === 'function') ClubTheme.setMode(theme, { persist: false, syncRemote: false });
        document.documentElement.setAttribute('data-theme', theme);
      }
      const themeChecks = [
        ['.topbar a.back', 'back link'], ['.panel h2', 'panel heading'], ['.hint', 'hint text'],
        ['.stat strong', 'stat value'], ['.stat span', 'stat label'],
        ['.badge.reason', 'decision badge'], ['.badge.move', 'move badge'],
        ['.threat-card dd', 'threat value'], ['.threat-card dt', 'threat label'],
        ['.lab-intro .notice', 'notice text'], ['.tree .root-line', 'tree root label'],
        ['#runReplay', 'primary action button'], ['#modeTabs button.active', 'active mode tab'],
        ['#modeTabs button:not(.active)', 'idle mode tab']
      ];
      const themeReport = {};
      for (const theme of ['dark', 'light']) {
        setTheme(theme);
        // 页面元素带 0.18–0.3s 的颜色过渡，必须等过渡结束再测，
        // 否则会量到中间色并误报对比度不足（已踩过）。
        await new Promise(r => setTimeout(r, 450));
        const rows = {}, failures = [];
        for (const [selector, label] of themeChecks) {
          const el = document.querySelector(selector);
          if (!el) { failures.push(theme + ': missing ' + label); continue; }
          const ratio = contrastOf(el);
          rows[label] = Math.round(ratio * 100) / 100;
          // 正文/标签类元素至少要 3:1，否则亮色或暗色下会看不清。
          if (!(ratio >= 3)) failures.push(theme + ': ' + label + ' contrast ' + rows[label]);
        }
        // 棋盘必须真的用上琥珀底色，而不是被全站规则刷成纯白/纯黑。
        const board = getComputedStyle(document.querySelector('.board'));
        const boardPaint = board.backgroundImage !== 'none' ? board.backgroundImage : board.backgroundColor;
        // 不用正则：这段在 Node 模板字符串里，反斜杠会被吞掉导致误判。
        // 只要不是「透明」，就认为棋盘保留了自己的底色。
        const isTransparent = boardPaint === 'transparent' || boardPaint.split(',').length === 4 && parseFloat(boardPaint.split(',')[3]) === 0;
        check(board.backgroundImage !== 'none' || !isTransparent, theme + ': board lost its own background: ' + boardPaint.slice(0, 60));
        const cellBorder = parseFloat(getComputedStyle(document.querySelector('.cell')).borderTopWidth);
        check(cellBorder >= 1, theme + ': board cells must keep a visible grid border');
        // 白子必须有深色描边，否则在浅色棋盘上看不见。
        const stoneShadow = getComputedStyle(document.querySelector('.cell.white'), '::after').boxShadow;
        check(stoneShadow && stoneShadow !== 'none', theme + ': white stones need an outline');
        themeReport[theme] = { contrast: rows, failures };
        check(failures.length === 0, 'theme readability failed: ' + failures.join(' | '));
      }
      setTheme('light');

      // 8) 战术演示：三种“非搜索”决策都必须能被复现，且各自给出对应的决策类型。
      //    这是页面的教学核心——让社员看到搜索之外的决策路径。
      let autoReport = null;
      const demoResults = [];
      const demoExpect = { 'demo-immediate-win': 'immediate-win', 'demo-forced-block': 'forced-block', 'demo-vcf': 'vcf-win' };
      for (const [openingId, expectedReason] of Object.entries(demoExpect)) {
        const index = OPENINGS_INDEX[openingId];
        check(index !== undefined, 'demo opening must be registered: ' + openingId);
        document.getElementById('openingSelect').value = String(index);
        document.getElementById('openingSelect').dispatchEvent(new Event('change'));
        const ds = await runAndWaitForStep();
        const last = ds[ds.length - 1];
        check(!!last, openingId + ' must produce an analysed step');
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

      // 9) 跑完分析后不得有任何原始 key 残留（面板文案是脚本生成的）。
      const afterRunLeaks = findKeyLeaks();
      check(afterRunLeaks.length === 0, 'i18n keys must resolve after analysis: ' + afterRunLeaks.join(', '));

      // 10) 切换到英文：由脚本生成的文案必须跟着变（本页大量文本不经过 data-i18n，
      //     必须依赖 club:langchange 重渲染，这是上一版出问题的地方）。
      //     注意 setLang 只在语言真正变化时广播事件，因此先显式建立 zh 基线，
      //     避免上一次运行留在 localStorage 的语言让这次切换变成空操作。
      ClubI18n.setLang('zh');
      await new Promise(r => setTimeout(r, 200));
      const zhStatus = document.getElementById('statusLine').textContent;
      const zhRunLabel = document.getElementById('runReplay').textContent;
      // 用战术演示项做对比：坐标型选项（如 "(8,8)"）两种语言本来就相同，
      // 只有演示项与“空盘”是本地化文案。
      const select = document.getElementById('openingSelect');
      const zhOption = select.options[select.options.length - 1].textContent;
      ClubI18n.setLang('en');
      await new Promise(r => setTimeout(r, 300));
      const enStatus = document.getElementById('statusLine').textContent;
      const enRunLabel = document.getElementById('runReplay').textContent;
      const enOption = select.options[select.options.length - 1].textContent;
      check(enStatus !== zhStatus, 'language switch must re-render the status line');
      check(enRunLabel !== zhRunLabel, 'language switch must re-render the action buttons');
      check(enOption !== zhOption, 'language switch must re-render the opening dropdown');
      check(!/[\u4e00-\u9fa5]/.test(enStatus), 'English status line must not keep Chinese text: ' + enStatus);
      const enLeaks = findKeyLeaks();
      check(enLeaks.length === 0, 'i18n keys must resolve in English: ' + enLeaks.join(', '));
      ClubI18n.setLang('zh');
      await new Promise(r => setTimeout(r, 200));

      // 10b) 自动手数：一直自对弈到某一方连五，且必须真的分出胜负。
      //      这是用户明确要求的“自动”模式，不能只跑固定手数就停。
      {
        document.getElementById('openingSelect').value = String(OPENINGS_INDEX['diag-near']);
        document.getElementById('openingSelect').dispatchEvent(new Event('change'));
        document.getElementById('plySelect').value = 'auto';
        const before = window.__labRun().seq;
        document.getElementById('runReplay').click();
        let waited = 0;
        while (waited < 600000) {
          const run = window.__labRun();
          if (run.seq > before && !run.busy) break;
          await new Promise(r => setTimeout(r, 500)); waited += 500;
        }
        const autoSteps = window.__labSteps();
        check(autoSteps.length > 6, 'auto mode must keep playing beyond the fixed options, got ' + autoSteps.length);
        // 盘面必须真的有一个连五点，且状态行如实报告胜方。
        const autoBoard = autoSteps[autoSteps.length - 1].boardBefore.map(row => row.slice());
        for (const st of autoSteps) autoBoard[st.move.row][st.move.col] = st.color;
        const stones = autoBoard.flat().filter(v => v !== 0).length;
        // 盘面 = 开局预置子（diag-near 有 2 手）+ 每一步剖析的落子。
        const openingStones = stones - autoSteps.length;
        check(openingStones >= 0 && openingStones <= 4,
          'auto mode must place one stone per analysed move on top of the opening, got ' + stones + ' stones for ' + autoSteps.length + ' plies');
        let line = null;
        const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
        for (let r = 0; r < 15 && !line; r++) for (let c = 0; c < 15 && !line; c++) {
          const color = autoBoard[r][c];
          if (!color) continue;
          for (const [dr, dc] of DIRS) {
            let n = 1;
            for (let k = 1; k < 5 && autoBoard[r + dr * k]?.[c + dc * k] === color; k++) n++;
            if (n >= 5) { line = { color, r, c }; break; }
          }
        }
        check(!!line, 'auto mode must end with an actual five-in-a-row on the board');
        const status = document.getElementById('statusLine').textContent;
        // 页面此刻是中文（本段之前的主题/语言检查已复位为 zh）。
        const sideName = line.color === 1 ? '黑棋' : '白棋';
        check(status.includes(sideName), 'auto mode must report the winning side, got: ' + status);
        check(status.includes(String(autoSteps.length)), 'auto mode must report the analysed move count, got: ' + status);
        autoReport = { plies: autoSteps.length, stones, winner: sideName };
      }
      document.getElementById('plySelect').value = '6';
      document.getElementById('openingSelect').value = String(OPENINGS_INDEX['center']);
      document.getElementById('openingSelect').dispatchEvent(new Event('change'));

      // 11) 实时对战模式：玩家落一子后，Satori 必须自己走一手并给出剖析。
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
        reasons: steps.map(s => s.stats.reason), demos: demoResults, live: true, auto: autoReport
      };
    })()`);
    reports.push(report);
    console.log(`PASS ${report.source}: ${report.steps} analysed moves, threat scans ${report.withThreat}/${report.steps}, candidate tables ${report.withCandidates}, iteration tables ${report.withIterations}, search trees ${report.withTree}, proofs ${report.withProof}, tree nodes ${report.treeNodes}, max depth ${report.maxDepth}`);
    console.log(`     reasons: ${report.reasons.join(', ')}`);
    console.log(`     tactical demos: ${report.demos.map(d => `${d.openingId}=${d.reason}@${d.move}`).join(', ')}`);
    if (report.auto) console.log(`     auto mode: ${report.auto.plies} plies -> ${report.auto.winner} wins (${report.auto.stones} stones)`);
  }
  assert.equal(reports.length, 2, 'both file:// and http:// must be validated');
} finally {
  socket.close();
}
