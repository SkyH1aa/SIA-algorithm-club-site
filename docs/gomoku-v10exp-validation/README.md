# V10Exp 换色对比与 Mesa 正式接入

2026-10-11 完成六场完整对局；`summary.complete=true`，全部落点、轮次、自由棋五连/长连终局、资源 SHA256 已复核。胜负均从 V10Exp 视角记录。

| 对手 | V10Exp 执黑 | V10Exp 执白 |
| --- | --- | --- |
| V9Thinker | 胜，21手 | 胜，36手 |
| V10 | 胜，25手 | 胜，44手 |
| V10Ultra | 胜，29手 | 负，49手 |

总计5胜1负；103次落子平均7.710秒、最长77.184秒，中位数466毫秒。大量强制应手可直接出棋，不能用中位数推断复杂局面速度；本轮无落子触及180秒上限。
本次空盘换色结果不构成Elo评估，不能认定任意开局必胜或双色全面超过Ultra。用户随后确定其正式胜局奖励15分，与V10Ultra相同。

## 融合方式

- V9Thinker和V10的冻结专家源码各运行于独立Worker，并行提供已完成迭代及VCF证明；已有模型源码和参数保持原样。
- Rapfi主搜索复用V10Ultra完全相同的WASM和10MB Mix9自由网，独立桥接预算164秒、最多18层、不设节点上限。总预算180秒，为通信和战术复核留出余量。
- 专家已证明必胜时可提前出棋。神经网落点再用独立12层VCF证明器检查；若能证明对手强制获胜，检查专家备选并择用未被证明强制败的落点。未发现强制败招不等于证明局面安全。
- 这是决策融合，没有重新训练权重，没有把专家评分与NNUE分数直接平均。独立派生证明核心由脚本生成，原V10核心未修改。
- Workers保留可复用局面缓存；搜索互相并行，页面/读条不参与同步计算。主线程179秒看门狗仅接受已完成迭代或已证明的落点；重启/切换立即终止搜索，不随机替换。
- 首次下载/初始化在读条开始前显示“正在准备模型”，不计入搜索预算；HTTP和file://都使用同一份NNUE字节。file://的Blob桥接只适配资源路径。

## 条件与复现

15×15自由棋、双方五连或长连获胜、黑先、空盘开始、没有指定胜负开局。真实Chrome154，Intel Core Ultra 9 275HX；六场在独立标签并行，每个引擎单线程Worker，预算按墙钟计时。V9Thinker/V10/V10Ultra保留原40/40/75秒预算。
验收不上传Supabase、不计排行榜、不混入用户训练期次。

```powershell
node tools/build-gomoku-v10exp.mjs
node tools/run-gomoku-experiment-browser.mjs v10exp v10ultra docs/gomoku-v10exp-validation/v10exp-black-v10ultra.json
node tools/run-gomoku-experiment-browser.mjs v10ultra v10exp docs/gomoku-v10exp-validation/v10ultra-black-v10exp.json
# 同样换色运行 v10 和 v9thinker，再汇总：
node tools/summarize-gomoku-v10exp.mjs
```

需要仓库静态服务器4173及独立Chrome DevTools9223。运行中的局可用现有runner的`--attach`恢复报告收集，不能重置棋局伪造完成。

## 已选择的正式规则

| 模型 | 内部版本号 | 引擎 | 胜局奖励 | 预算 | 自身视角上传 |
| --- | --- | --- | --- | --- | --- |
| 铭星V9Mesa | 9.3 | GomokuZero公开iteration-150权重+PUCT | 9分 | 120秒 | 不上传 |
| 铭星V10Mesa | 10.2 | SlowRenju自由棋WASM | 14分 | 120秒 | 胜负平全上传 |
| 铭星V10Exp | 10.3 | 专家战术+Mix9决策融合 | 15分 | 180秒 | 胜负平全上传 |

原Mesa十二场报告保存在`docs/gomoku-experiment-validation/`；V10Mesa对Ultra黑胜白负。生产入口`public/gomoku.html`接入三者；实验入口保留全部本地比较，不计分、不上传。
正式人机和模型对战的上传白名单为9.2/10/10.1/10.2/10.3，完整保存AI win/loss/draw与双方版本和颜色。玩家投降不上传。V9Mesa（9.3）自身不上传，但仍可作为上传记录中的对手版本。

Supabase边缘函数源码已更新，需部署`supabase/functions/gomoku-training/index.ts`才能让线上接收10.2/10.3及新的对手版本；本次未部署远端。排行榜现有RPC已接受1至15分，9/14/15分不需扩展范围，SQL中已注明新规则。

`docs/gomoku-page-integration.json`记录HTTP/file://生产页面检查（模拟后端，无真实写入）；边缘函数离线校验工具为`node tools/test-gomoku-training-policy.mjs`。

正式/实验页面的模型选项按用户指定顺序排列：V9、V9Pro、V9Mesa、V9Thinker、V10、V10Mesa、V10Exp、V10Ultra；旧版本保留在其前面。
