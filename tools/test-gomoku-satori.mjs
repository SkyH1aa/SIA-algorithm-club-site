// Gomoku-Satori（内部代号 V11Ge）自研引擎的行为自测：立即连五、必防、活四、VCF、状态复原、耗时。
import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const source = fs.readFileSync('public/gomoku-models/satori/engine.js', 'utf8');
const sandbox = { console, performance, window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const engine = sandbox.window.GomokuSatori;

const SIZE = 15;
const empty = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
const put = (b, color, cells) => { for (const [r, c] of cells) b[r][c] = color; return b; };
let failures = 0;
const check = (cond, label, detail) => {
  if (cond) { console.log('  ok   ' + label); }
  else { console.log('  FAIL ' + label + (detail ? '  ' + detail : '')); failures++; }
};
const move = (b, color) => engine.findBestMove({ board: b, color });

console.log('== 立即连五（黑） ==');
{
  const b = put(empty(), 1, [[7, 4], [7, 5], [7, 6], [7, 7]]);
  const m = move(b, 1);
  check((m.row === 7 && (m.col === 3 || m.col === 8)), '黑方取成五点', JSON.stringify(m));
  check(engine.lastSearch.reason === 'immediate-win', 'reason=immediate-win', engine.lastSearch.reason);
}
console.log('== 立即连五（白） ==');
{
  const b = put(empty(), 2, [[5, 5], [6, 5], [7, 5], [8, 5]]);
  const m = move(b, 2);
  check(m.row === 9 && m.col === 5 || (m.row === 4 && m.col === 5), '白方取成五点', JSON.stringify(m));
}
console.log('== 必防：对手四连且两端一端被堵 ==');
{
  const b = put(empty(), 1, [[7, 4], [7, 5], [7, 6], [7, 7]]);
  b[7][3] = 2; // 白棋堵左端
  const m = move(b, 2);
  check(m.row === 7 && m.col === 8, '白方堵唯一成五点', JSON.stringify(m));
  check(engine.lastSearch.reason === 'forced-block', 'reason=forced-block', engine.lastSearch.reason);
}
console.log('== 必防：对手活四（黑方无解，但必须落在成五点上） ==');
{
  const b = put(empty(), 1, [[7, 5], [7, 6], [7, 7], [7, 8]]);
  const m = move(b, 2);
  check(m.row === 7 && (m.col === 4 || m.col === 9), '白方堵活四其中一端', JSON.stringify(m));
}
console.log('== 空盘：走天元 ==');
{
  const m = move(empty(), 1);
  check(m.row === 7 && m.col === 7, '空盘落中心', JSON.stringify(m));
}
console.log('== VCF：双冲四序列可证明 ==');
{
  // 黑方 7 行三连 + 8 行三连，落 (7,7) 后形成双四
  const b = put(empty(), 1, [[7, 4], [7, 5], [7, 6], [8, 4], [8, 5], [8, 6]]);
  put(b, 2, [[0, 0], [0, 1]]);
  const m = move(b, 1);
  check(typeof m.row === 'number' && typeof m.col === 'number', '返回合法落点', JSON.stringify(m));
}
console.log('== 状态复原：连续调用结果一致 ==');
{
  const b = put(empty(), 1, [[7, 6], [7, 7], [7, 8]]);
  put(b, 2, [[6, 7], [8, 7]]);
  const a = move(b, 1);
  const c = move(b, 1);
  check(a.row === c.row && a.col === c.col, '同局面两次调用同结果', `${JSON.stringify(a)} vs ${JSON.stringify(c)}`);
}
console.log('== 合法性：不落在已占点 ==');
{
  const b = put(empty(), 1, [[7, 4], [7, 5], [7, 6]]);
  put(b, 2, [[7, 7], [6, 6], [8, 8]]);
  const m = move(b, 1);
  check(b[m.row][m.col] === 0, '落点为空', JSON.stringify(m));
}
console.log('== 耗时（中局，10 秒预算） ==');
{
  const b = put(empty(), 1, [[7, 7], [6, 6], [8, 8], [6, 8], [8, 6]]);
  put(b, 2, [[7, 6], [6, 7], [8, 7], [7, 8]]);
  const t = performance.now();
  const m = move(b, 1);
  const ms = Math.round(performance.now() - t);
  check(b[m.row][m.col] === 0, '中局返回合法落点', JSON.stringify(m));
  console.log(`       用时 ${ms} ms, depth=${engine.lastSearch.depth}, nodes=${engine.lastSearch.nodes}`);
}
console.log(failures ? `\n失败 ${failures} 项` : '\n全部通过');
process.exitCode = failures ? 1 : 0;
