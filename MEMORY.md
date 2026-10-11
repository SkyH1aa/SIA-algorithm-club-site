# 五子棋维护记忆

## Mesa 与 V10Exp 正式版本

- 用户已正式命名：SlowRenju=铭星V10Mesa（内部10.2），胜局14分；GomokuZero=铭星V9Mesa（内部9.3），胜局9分。两者独立120秒预算，正式入口 `public/gomoku.html` 支持人机及模型对战和倒计时。V9Mesa不上传，V10Mesa上传AI胜负平全部结果，玩家投降不上传。不要沿用废弃的10.201/10.202实验标识写入后端。
- 铭星V10Exp（内部10.3）已正式接入，180秒预算；用户已决定胜局15分，与V10Ultra相同。人机和模型对战均上传自身视角全部胜负平，排行榜正常记录胜负平及积分。
- 当前正式上传白名单为9.2/10/10.1/10.2/10.3（V9Thinker、V10、V10Ultra、V10Mesa、V10Exp），五者全部上传胜负平；其余版本不上传。V9Pro10分、V9Thinker12分、V10 12分、V10Ultra15分、V9Mesa9分、V10Mesa14分、V10Exp15分。前端、边缘函数和排行榜RPC必须一致。
- Mesa资源保留在 `public/gomoku-models/experimental/`，正式别名在 `mesa.js`。SlowRenju自由棋fflag=0/nosix=0，原24层/60宽度和评估参数不变，独立WASM Worker；初始384MiB内存。GomokuZero使用公开iteration-150已有权重，FP32 ONNX+PUCT最多2000模拟，全合法候选；这不是本项目新训练网络。
- Mesa可重建工具：`python tools/build-gomoku-slowrenju.py --emcc <emcc路径>`、`python tools/export-gomoku-zero.py <checkpoint.pt>`、`node tools/build-gomoku-experiment-file-package.mjs`。训练目录仍持续累加，不能用外部网络覆盖历史先验。
- V10Exp是决策层融合：复用冻结的V9Thinker/V10专家源码，在独立Worker并行搜索；复用V10Ultra相同的Rapfi WASM和10MB Mix9自由网，独立桥接主搜索最多18层/164秒/不限节点。只用专家已证明VCF或立即胜着提前终止；神经网落点由独立12层VCF证明器检查，发现强制败招才查验专家备选。不平均不可比评分、不声称混合/重新训练了权重。未证明败招不等于证明安全。
- V10Exp资源在 `v10exp.js` / `v10exp/`；`node tools/build-gomoku-v10exp.mjs` 从冻结核心生成带proof-only API的独立派生核心和file://源码包，绝不改原核心。HTTP直接引用原NNUE二进制；file://用原Ultra离线包中的同字节资产和Blob Worker。首次准备模型在读条之前，计时不包含资产下载。主线程179秒看门狗只接受完整迭代或已证明的落点，不随机降级；暂停/切换/重启终止所有相关Worker。
- 所有历史模型源码、配置、NNUE权重和训练边界冻结。实验页面 `public/gomoku-experiments.html` 所有对局均不上传、不计分；正式页面实施Mesa与Exp生产计分/上传规则。
- 原12场Mesa对比棋谱在 `docs/gomoku-experiment-validation/`：V10Mesa黑白均胜V9Thinker/V10，对Ultra黑胜白负（5胜1负）；V9Mesa仅黑胜Thinker，其余5负。保留真实旧报告和资源SHA256；新命名不改旧报告结果。
- V10Exp完整六场换色对比在 `docs/gomoku-v10exp-validation/`；工具 `node tools/run-gomoku-experiment-browser.mjs <黑模型> <白模型> <报告路径>`（静态服务器4173、独立Chrome DevTools9223），汇总 `node tools/summarize-gomoku-v10exp.mjs`。12场Mesa汇总工具为 `tools/summarize-gomoku-experiments.mjs`。只在所有棋谱重放与资源指纹通过、complete=true后声称对局完成，验收棋谱不能混入训练期次。
- 生产页面集成：`GOMOKU_UI_PORT`可指定独立Chrome端口（默认9222）；`node tools/check-gomoku-page-integration.mjs`模拟后端避免实际写入，分别验证HTTP/file、全部模型结果上传/积分、模式清盘、新模型双颜色即胜优先、120/180秒读条。`node tools/test-gomoku-training-policy.mjs`验证边缘函数和离线NNUE字节一致性。

- 2026-10-11 V10Exp六场全部完成、棋谱及SHA256复核通过：对Thinker/V10黑白均胜，对Ultra黑胜白负，总5胜1负；103次落子平均7.710秒、最长77.184秒，无180秒超限。尚未双色全面超过Ultra；用户已决定正式积分15分。报告 `docs/gomoku-v10exp-validation/README.md`。HTTP/file://真实神经网黑白搜索、读条和运行中重启取消均通过；生产页面每种来源84个人机结果和588个模型对战组合通过，边缘函数588项离线检查通过。本次未部署远端Supabase，发布时需部署新的边缘函数以接受10.2/10.3及新对手版本。

- 页面顺序由用户指定，V9起为V9、V9Pro、V9Mesa、V9Thinker、V10、V10Mesa、V10Exp、V10Ultra；不要按内部小数版本号排序。前端人机/黑方/白方选择器及独立实验页使用同一顺序。中英文排行榜提示必须包含Mesa与Exp的正式积分。

## 版本与数据边界

- V8 与 V9 是冻结对照，不得为了让新版本获胜而修改其源码、先验或对战规则。
- V9Pro（9.1）与 V9Thinker（9.2）由各自配置调用 `public/gomoku-models/expert-core.js`。共享核心只服务这两个版本；网页必须在两个配置文件之前加载它。
- Pro 保持 6 层、12 候选、25 秒、7 层 VCF；Thinker 保持 7 层、14 候选、40 秒、8 层 VCF。深度是迭代目标：时间耗尽采用上一完整迭代，证明胜负时可提前结束。不要把配置深度当成实际完成深度。
- 所有 `五子棋训练数据<期号>/` 必须保留。运行 `node tools/build-gomoku-training-model.mjs` 累计构建，不能拿最新一期覆盖旧数据。
- V9、Thinker 保留 1008/1009 先验；Pro 冻结在 1012 期，模型对战先验仅取自身视角。1013 及后续期次只更新 V10 与累计归档，不进入旧模型专用先验。累计归档仍保存所有合法模型视角。
- V10 是独立模型，使用全部累计训练期次（包括 1013 及后续），由独立的 `public/gomoku-models/v10-core.js` 和 `v10.js` 加载；不得修改 V8、V9、V9Pro、V9Thinker 或 `expert-core.js` 来提升 V10。V10 专属开局配置与搜索调整只能写入 V10 文件。
- 相同内容的下载副本在新累计模型中去重，源文件不删。V9 构建保留原计数语义，防止新去重逻辑改变冻结版本。
- 现有数据模型只统计前四次 AI 落子，是开局结果先验，不是中盘训练器。先验仅用于同分排序，不能覆盖必胜、必防或专家评分。
- 只有 V9Thinker（9.2）、V10（10）、V10Ultra（10.1）、V10Mesa（10.2）和 V10Exp（10.3）上传训练数据，五者均上传 AI 胜/负/和；V1/V2/V3/V6/V7/V8/V9/V9Pro/V9Mesa 均不上传。玩家投降不上传训练样本。Pro 胜局奖励 10 分，Thinker 与 V10 各奖励 12 分，V10Ultra 奖励 15 分。前端、边缘函数和排行榜 SQL 规则必须一致。
- V10 的速度优化必须只修改 `v10-core.js`：保留 8 层、20 候选、威胁深度 10 和 40 秒配置；允许复用位置键控 TT、立即胜着/静态评估/VCF 缓存和减少无效 aspiration 重搜，但不能修改 V8/V9/V9Pro/V9Thinker 或 `expert-core.js`。
- V10Ultra（训练版本号 10.1）是独立的 Rapfi Mix9 freestyle NNUE Worker，资源放在 `public/gomoku-models/v10ultra/`，含 `worker.js`、`rapfi-single.js`、`rapfi-single.wasm`、约 10 MB `rapfi.data` 与 GPL/CC0 `NOTICE.md`。使用独立 Worker、75 秒单步预算和 15 分胜局奖励；不要把 NNUE 资源替换或混入旧模型。模型对战和人机对战都只能上传 V9Thinker/V10/V10Ultra/V10Mesa/V10Exp 的胜负平。
- `file://` 页面 origin 为 `null`，浏览器不能直接以 `file://` URL 创建 Worker。V10Ultra 在该模式下动态加载可重建的 `v10ultra/file-package.js`，以 Blob Worker 和内嵌二进制运行同一份 Rapfi 引擎；修改 Rapfi 资源或 Worker 后运行 `node tools/build-gomoku-v10ultra-file-package.mjs`。HTTP(S) 继续使用原二进制资源，不加载离线包。浏览器中需分别实测两种来源的黑白落子。
- 积分和上传链路可运行 `node tools/test-gomoku-training-policy.mjs`；真实页面集成可运行 `node tools/check-gomoku-page-integration.mjs`（本地页面服务器4173、Chrome DevTools端口9222），检查积分 RPC、人机结果映射、模型对战颜色/版本、上传白名单及黑白/重启后的 Worker 落子。该工具在导航前模拟后端，禁止把验收样本上传 Supabase。集成报告见 `docs/gomoku-page-integration.json`。单步测试只验证加载链路，不能替代六局完整换色棋力验收。

## 已定位的专家系统问题

- 旧字符串模式把有一个补点的跳四标为活四；现在按包含落点的五格窗口计算不同获胜补点。
- 旧 Thinker 从可变候选数组取前 64 格评估，使同一棋盘评分依赖搜索路径。现在棋型、候选准入和基础评分由棋盘决定；启发式只重排已准入候选。
- 旧静态评分、搜索层数、威胁判定在两个新版本间并不一致。不能假定堆叠 PVS/LMR/aspiration 名称或增加一层就一定更强。
- 使用增量棋型编码、双哈希置换表、PVS、aspiration、保守 LMR、历史/杀手排序和强制防守延伸。撤销必须恢复每项状态。
- VCF 只验证强制应答：进攻后若对方可直接获胜则失败；进攻方有两个不同获胜点则成立；单一获胜点只有唯一必要防守。不要遍历所有无效防守浪费预算。

## 必须验证后再交付

```powershell
node tools/build-gomoku-training-model.mjs
node --check tools/build-gomoku-training-model.mjs
node --check public/data/gomoku-training-model.js
node --check public/gomoku-models/expert-core.js
node tools/test-gomoku-expert.mjs
git diff --check
```

- 完整对战工具：`node tools/gomoku-match.mjs <黑模型> <白模型> <输出.json>`，模型名为 `v8`、`v9`、`v9pro`、`v9thinker`、`v10`。V10Ultra 使用浏览器 Worker，不能伪装成同步 Node 引擎；验收要在真实浏览器中运行 Worker 对局并保存棋谱、版本和颜色。使用生产时间预算和真实时钟，不上传到 Supabase。
- 强度验收至少覆盖 Pro 对 V8/V9、Thinker 对 V8/V9/Pro，全部换色，共十个对局。保存完整棋谱、每步实际深度、时间与代码指纹。
- `node tools/analyze-gomoku-records.mjs 五子棋训练数据1012` 区分下载副本、模型视角与不同棋谱。重复确定性棋谱不能当成独立棋力样本。
- V10 验收棋谱保存在 `docs/gomoku-v10-validation/`，必须覆盖 V10 黑/白对 V8、V9、V9Pro、V9Thinker 的八局；使用 `node tools/gomoku-match.mjs` 的真实生产时钟运行，八局均由 V10 获胜后才能交付。新增训练期次后先运行 `node tools/build-gomoku-training-model.mjs`，检查累计 `gameCount`、`sourceDirectories` 和各期统计，再运行语法与 `git diff --check` 检查。
- 战术/语法通过不等于棋力达标；不得在完整对战没跑完时声称达标。有限对局通过也不能宣称任意开局、任意设备必胜。
- 当前验收资料在 `docs/gomoku-1012-validation/`。测试棋谱不是用户训练数据，不要将其自动混入训练期次。

- 最新规则复核：V10Exp胜局15分、负局0分、平局1分，前端显示与排行榜RPC相同；删除旧的Exp实验计分跳过逻辑，五个白名单模型的全部结果均上传。人机/黑白选择器及实验页顺序已统一，中英文积分提示同步。HTTP/file://每种来源84个人机结果、588个模型对战组合和五个投降例外均验证通过；实验页自身仍不写后台。
