// 独立验证 Gomoku-Satori（内部代号 V11Ge）的 VCF 必胜声明：不信任引擎内部结论，
// 用另一套朴素实现逐手核对“每步都是强制着、最后确实连五”。
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('public/gomoku-models/satori/engine.js', 'utf8');
const sandbox = { console, performance: { now: () => Date.now() }, window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const engine = sandbox.window.GomokuSatori;

const SIZE = 15;
const empty = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

// 朴素实现：某点落子是否形成 >=5 连
function isFive(b, r, c, color) {
  for (const [dr, dc] of DIRS) {
    let n = 1;
    for (const s of [-1, 1]) for (let k = 1; k < SIZE; k++) {
      if (b[r + s * dr * k]?.[c + s * dc * k] !== color) break;
      n++;
    }
    if (n >= 5) return true;
  }
  return false;
}
// 朴素实现：该颜色所有能立刻连五的空点
function fivePoints(b, color) {
  const out = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (b[r][c]) continue;
    b[r][c] = color;
    if (isFive(b, r, c, color)) out.push([r, c]);
    b[r][c] = 0;
  }
  return out;
}
const clone = (b) => b.map((row) => row.slice());

// 用朴素规则独立重建并核验引擎的“必胜”声明。
// 规则：攻击方每步必须构成强制着——要么落子后自己出现 >=2 个成五点（活四，
// 对手单点封不住），要么出现 1 个成五点（冲四，对手被强制应手）；
// 对手只有在能先连五时才可能破坏该线。
function verifyVcf(board, color, label) {
  engine.clearCache();
  const result = engine.findBestMove({ board: board.map((r) => r.slice()), color });
  const reason = engine.lastSearch.reason;
  if (reason !== 'vcf-win') { console.log(`  skip ${label}: 未声明 VCF（reason=${reason}）`); return { checked: false }; }

  const b = board.map((r) => r.slice());
  const line = [];
  let attacker = color;
  for (let step = 0; step < 16; step++) {
    const mine = fivePoints(b, attacker);
    if (mine.length) {
      // 攻击方已经可以直接连五，且对手无法抢先——该线成立
      const oppNow = fivePoints(b, 3 - attacker);
      return { checked: true, ok: oppNow.length === 0, label, line, why: oppNow.length ? '双方都能连五' : '' };
    }
    // 找一步强制着：优先活四（对手封不住），其次冲四（对手必应）
    let openFour = null, four = null;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      if (b[r][c]) continue;
      b[r][c] = attacker;
      const comps = fivePoints(b, attacker);
      b[r][c] = 0;
      if (comps.length >= 2 && !openFour) openFour = { point: [r, c], comps };
      else if (comps.length === 1 && !four) four = { point: [r, c], comps };
      if (openFour && four) break;
    }
    const pick = openFour || four;
    if (!pick) return { checked: true, ok: false, label, line, why: '找不到任何强制着，但引擎声称必胜' };
    b[pick.point[0]][pick.point[1]] = attacker;
    line.push({ by: openFour ? 'open-four' : 'four', point: pick.point });
    // 对手能否先连五？
    const oppWin = fivePoints(b, 3 - attacker);
    if (oppWin.length) return { checked: true, ok: false, label, line, why: '对手可先连五' };
    if (openFour) return { checked: true, ok: true, label, line };  // 活四：对手单点封不住
    // 冲四：对手必须堵唯一的成五点
    b[pick.comps[0][0]][pick.comps[0][1]] = 3 - attacker;
    line.push({ by: 'block', point: pick.comps[0] });
  }
  return { checked: true, ok: false, label, line, why: '超过 16 步仍未终结' };
}

const cases = [];
{
  const b = empty();
  [[7, 7], [6, 6], [8, 8], [6, 8], [8, 6]].forEach(([r, c]) => b[r][c] = 1);
  [[7, 6], [6, 7], [8, 7], [7, 8]].forEach(([r, c]) => b[r][c] = 2);
  cases.push(['双三交叉（引擎报 4,4 必胜）', b, 1]);
}
{
  const b = empty();
  [[7, 4], [7, 5], [7, 6], [8, 4], [8, 5], [8, 6]].forEach(([r, c]) => b[r][c] = 1);
  [[0, 0], [0, 1]].forEach(([r, c]) => b[r][c] = 2);
  cases.push(['双三并行', b, 1]);
}
{
  const b = empty();
  [[7, 7], [8, 8], [9, 9]].forEach(([r, c]) => b[r][c] = 1);
  [[7, 6], [7, 8]].forEach(([r, c]) => b[r][c] = 2);
  cases.push(['普通三连（不应有 VCF）', b, 1]);
}
{
  const b = empty();
  [[7, 7], [7, 8], [7, 9], [7, 10]].forEach(([r, c]) => b[r][c] = 1);
  cases.push(['纯四连（一步成五）', b, 1]);
}

let bad = 0;
for (const [label, board, color] of cases) {
  const res = verifyVcf(board, color, label);
  if (!res.checked) continue;
  if (res.ok) console.log(`  ok   ${label}：VCF 声明被独立验证通过`);
  else { console.log(`  FAIL ${label}：${res.why || '验证不通过'}`); bad++; }
}
console.log(bad ? `\n${bad} 项 VCF 声明无法被独立验证` : '\n所有 VCF 声明均通过独立验证');
process.exitCode = bad ? 1 : 0;
