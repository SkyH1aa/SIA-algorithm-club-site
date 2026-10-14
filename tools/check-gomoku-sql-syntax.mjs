// 用 PostgreSQL 官方解析器校验五子棋主 SQL 的语法。
// 这次事故（grant 语句被字符串替换挤断）逃过了括号配对与关键字检查，
// 只有真正的 SQL 解析器才能发现，所以把这一步固化下来。
//
// 依赖 pglast（libpg_query 的 Python 绑定）：
//   pip install pglast
// 未安装时脚本会明确提示并退出 1，而不是静默跳过。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['supabase-gomoku-schema.sql'];
const python = process.platform === 'win32' ? 'python' : 'python3';

const probe = spawnSync(python, ['-c', 'import pglast'], { encoding: 'utf8' });
if (probe.status !== 0) {
  console.error('缺少 pglast：请先运行 pip install pglast（这是真实 SQL 语法校验，不能用其它检查替代）。');
  process.exit(1);
}

let failed = false;
for (const file of targets) {
  const sql = fs.readFileSync(path.join(root, file), 'utf8');
  const script = [
    'import sys, json',
    'import pglast',
    'sql = open(sys.argv[1], encoding="utf-8").read()',
    'try:',
    '    stmts = pglast.parse_sql(sql)',
    'except Exception as exc:',
    '    print(json.dumps({"ok": False, "error": str(exc)}))',
    '    sys.exit(0)',
    'kinds = [s.stmt.__class__.__name__ for s in stmts]',
    'print(json.dumps({"ok": True, "count": len(stmts), "tables": kinds.count("CreateStmt"), "functions": kinds.count("CreateFunctionStmt"), "views": kinds.count("ViewStmt")}))'
  ].join('\n');
  const result = spawnSync(python, ['-c', script, path.join(root, file)], { encoding: 'utf8' });
  const line = (result.stdout || '').trim().split('\n').pop();
  let parsed;
  try { parsed = JSON.parse(line); } catch { console.error(`FAIL ${file}: 无法解析校验输出 ${JSON.stringify(result.stdout)} ${result.stderr}`); failed = true; continue; }
  if (!parsed.ok) { console.error(`FAIL ${file}: ${parsed.error}`); failed = true; continue; }
  if (parsed.tables < 2 || parsed.functions < 3 || parsed.views < 1) {
    console.error(`FAIL ${file}: 期望至少 2 表 / 3 函数 / 1 视图，实际 ${parsed.tables}/${parsed.functions}/${parsed.views}`);
    failed = true;
    continue;
  }
  console.log(`PASS ${file}: ${parsed.count} 条语句通过 PostgreSQL 语法解析（表 ${parsed.tables} / 函数 ${parsed.functions} / 视图 ${parsed.views}）。`);
}
if (failed) process.exit(1);
