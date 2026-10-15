# Gomoku-Satori 上架验收（版本 11，展示版）

日期：2026-10-15

## 定位

Gomoku-Satori（原名 V11Ge）是**展示版**模型，从零自研、纯 JavaScript 实现：

- 不使用 Rapfi、WASM、神经网络或任何外部二进制；
- 不读取任何训练先验（不含 `GOMOKU_*_TRAINING_MODEL` 引用）；
- 可参与人机对战与模型对战（也可作为模型对战的对手）；
- **不计积分、不上传训练数据、不写排行榜**。

拦截有两道：前端 `isExhibitionVersion(11)` 返回 0 分并直接跳过 `record_gomoku_result`
（主 SQL 的 `p_win_points` 只接受 1–16，0 分会被数据库拒绝）；边缘函数
`acceptsResult` 白名单不含 11（但版本号 11 本身合法，因此它仍能作为对手出场，
此时只有对手视角按各自规则上传）。

## 引擎结构

`public/gomoku-models/satori/engine.js`（约 30 KB）：

| 层 | 实现 |
| --- | --- |
| 棋型评估 | 线枚举 + 增量打分（五连 / 活四 / 冲四 / 活三 / 冲三 / 二） |
| 搜索 | 迭代加深 negamax + alpha-beta + PVS |
| 表 | 置换表（typed array，高位校验）、杀手着法、history 启发 |
| 静止期 | quiescence 深度 8，精确解析冲四/活四强制威胁 |
| 证明 | VCF（只搜冲四）、VCT（冲四+活三，完备防守集合逐个反驳） |
| 预算 | 单步 16 秒 |

Worker 隔离：`satori/worker.js`，主线程不被搜索阻塞。`file://` 下用生成的
`satori/file-package.js`（32.58 KiB）构造 Blob Worker，与 HTTP 跑同一份引擎字节
（由 `tools/test-gomoku-training-policy.mjs` 校验逐字节一致）。

## 双色对局验收

`satori` vs `v9pro`（空盘换色，`complete=true`）：

| 局 | 黑 | 白 | 胜者 | 手数 |
| --- | --- | --- | --- | --- |
| 1 | satori | v9pro | v9pro | 18 |
| 2 | v9pro | satori | v9pro | 17 |

Satori 每步均值 5.87 秒、最长 16.02 秒；V9Pro 均值 0.11 秒。Satori 的决策分布为
`search` 12 次、`forced-block` 3 次、`vct-win` 1 次、`opening-center` 1 次，
说明 VCF/VCT 与必防逻辑在真实对局中确实触发过。

## 诚实棋力记录

| 对手 | 空盘换色 | 固定开局套件（6 开局 × 换色） |
| --- | --- | --- |
| V9Pro | 0:2 | 未跑 |
| V9Thinker | 0:2 | 0:12 |
| V10Ultra | 0:2（10s 与 16s 预算各一轮） | 0:12 |

结论：Satori 与 V9Thinker/V10Ultra 的差距在**评估函数质量**而非搜索框架——
所有者的搜索框架（迭代加深、置换表、PVS、静止期、VCF/VCT）都已具备，但手写
线性棋型权重与专家引擎的先验+更深战术视野存在数量级差距。**它没有积分与排序
主张，仅作展示。**

## 验收命令

```bash
node tools/test-gomoku-satori.mjs          # 引擎行为自测
node tools/verify-gomoku-satori-vcf.mjs    # VCF 声明独立朴素验证
node tools/test-gomoku-training-policy.mjs # 上传策略 + 离线包字节一致 + 11 不在白名单
node tools/check-gomoku-page-integration.mjs   # 正式页 HTTP + file://
node tools/check-gomoku-experiment-page.mjs    # 实验页 HTTP + file://
node tools/build-gomoku-satori-file-package.mjs # 改 engine/worker 后必须重跑
```

## 验收结果

- `tools/test-gomoku-satori.mjs`：全部通过。
- `tools/verify-gomoku-satori-vcf.mjs`：所有 VCF 声明均通过独立验证。
- `tools/test-gomoku-training-policy.mjs`：1080 项边缘函数用例通过。
- `tools/check-gomoku-page-integration.mjs`：HTTP 与 file:// 各 108 个人机用例、
  972 个模型对战组合通过，含 Satori 黑白真实 Worker 落子、立即连五优先级、
  16 秒倒计时、重置取消搜索。
- `tools/check-gomoku-experiment-page.mjs`：HTTP 与 file:// 均通过。
- `node tools/check-gomoku-sql-syntax.mjs`：主 SQL 28 条语句通过 PostgreSQL 解析。
- `git diff --check`：干净。
