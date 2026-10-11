# V10 自由棋实验对比

用户要求先实现独立候选并完成双色对战，再选择正式名称和积分。
当前候选为 SlowRenju WASM 和 GomokuZero（策略/价值网络 + PUCT MCTS）。
实验入口：`public/gomoku-experiments.html`；保持原五子棋布局，可选颜色、人机/模型对战、倒计时和导出棋谱。
生产入口只增加实验室链接；旧引擎源码、配置和权重保持不变。

## 对比方法

- 15×15，无禁手，黑先白后，五连及长连均胜；空盘开始，不喂胜负开局。
- 每个候选分别执黑、执白，对 V9Thinker、V10、V10Ultra；两个候选共12局。
- 真实 Chrome Worker 和墙钟时间：候选上限120秒；旧模型沿用40/40/75秒原预算。
- GomokuZero最多2000次PUCT模拟、c_puct=5、全部合法候选；批量FP32推理和局面缓存，不新增训练。
- SlowRenju使用原始5.1.3源码、评估参数、60搜索宽度和24迭代深度配置；移植WASM计时检查代替原生计时线程。
- 测试设备：Intel Core Ultra 9 275HX，Chrome154；每个引擎使用单线程 Worker，最后四场 SlowRenju 对局在独立标签中并行运行，单步预算仍按墙钟计时。
- 所有棋谱仅用于验收，不上传Supabase，不计玩家积分，不加入任何训练数据期次。

`summary.json` 和实验页面侧栏是当前已完成结果。
JSON棋谱包含颜色、时间限制、每步落点/用时/引擎报告，以及代码/二进制SHA256。
`smoke-http.json`、`smoke-file.json` 验证加载、黑白即胜优先和重置；`page-integration.json` 验证实际页面选择、清盘、倒计时和无游戏数据写入。

## 最终结果（2026-10-11）

12 场全部结束；汇总工具已逐步重放棋谱并验证当前资源 SHA256，`summary.complete=true`。
下表胜负均从实验候选视角记录，每格依次为候选执黑 / 执白。

| 实验候选 | 对 V9Thinker | 对 V10 | 对 V10Ultra | 总计 |
| --- | --- | --- | --- | --- |
| SlowRenju WASM | 胜 / 胜 | 胜 / 胜 | 胜 / 负 | 5 胜 1 负 |
| GomokuZero | 胜 / 负 | 负 / 负 | 负 / 负 | 1 胜 5 负 |

SlowRenju 的 99 次落子平均 39.914 秒、最长 119.301 秒；强制应手很多，故中位数仅 3 毫秒，不能据此认为通常能秒出。运行内存初始约 384 MiB，较适合桌面设备。
GomokuZero 的 92 次落子平均 4.982 秒、最长 10.372 秒；达到 2000 次模拟上限可提前结束，不代表用满 120 秒。

SlowRenju 在此次空盘换色测试中双杀 V9Thinker 和 V10，与 V10Ultra 各胜一场，尚未满足双色战胜 V10Ultra 的更强条件。GomokuZero 当前公开权重与搜索配置不能作为棋力升级推荐。用户已选定正式名称和积分：SlowRenju为V10Mesa（14分、上传胜负平），GomokuZero为V9Mesa（9分、不上传）；本报告保留原始引擎名和完整结果。

## 复现

在仓库根目录启动静态服务器4173，独立Chrome实例启用DevTools9223；不要复用正在进行的玩家对战标签。

```powershell
node tools/run-gomoku-experiment-suite.mjs
node tools/summarize-gomoku-experiments.mjs
```

汇总工具逐步重放落点、检查换色/合法性/五连终局，并校验资源指纹。
未完成或有运行错误的对局不计为胜负；未满盘不能记平局。
脚本返回0且summary.complete=true才代表12局全部完成。

资源构建及许可来源见`public/gomoku-models/experimental/NOTICE.md`和`provenance.json`。
公开大网络不等于本项目新训练模型；这次仅导出已有GomokuZero权重。
一组空盘換色对比不构成Elo评估，也不证明任意开局、任意设备都能获胜。
