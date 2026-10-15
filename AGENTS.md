# 五子棋训练数据维护规则

专家核心、数据边界和完整棋力验收方法见 `MEMORY.md`。语法测试和少量合法落子不能代替换色完整对局验收。

最新用户决定：SlowRenju正式为V10Mesa（10.2，120秒，胜局14分，全胜负平上传），GomokuZero正式为V9Mesa（9.3，120秒，胜局9分，不上传）。新增V10Exp（10.3，180秒）为V9Thinker/V10专家+原Ultra Mix9自由网决策融合，正式胜局15分；新增V10Flash（10.4，120秒，16层，Mix9，Rapfi+自研战术层+专家系统）正式胜局15分；V10Bru·我非我Champion（10.6，V10Ultra同款Rapfi配置+全量先验开局书）已全面开放，正式胜局15分，人机/模型对战均上传自身视角胜负平全部结果。旧模型源码、配置、权重冻结；详见MEMORY.md。实验页所有对局仍保持本地，不上传排行榜/训练数据。

新增 **Gomoku-Satori（版本号 11，原名 V11Ge）为展示版**：从零自研的纯 JavaScript 引擎（`public/gomoku-models/satori/`），不使用 Rapfi、WASM、神经网络或任何训练先验，也不借鉴其它模型的参数与配置。它**可参与人机对战与模型对战**（正式页与实验页均排在列表最后），但**不计积分、不上传训练数据、不写排行榜**——前端 `isExhibitionVersion(11)` 先拦一道，边缘函数 `acceptsResult` 白名单不含 11 作第二道；版本号 11 本身是合法值，因此它仍可作为模型对战的对手，此时只有对手视角按各自规则上传。诚实记录：它对 V9Thinker、V10Ultra 的双色与固定开局验收全败（各 0:12），是搜索引擎与手写评估的展示样例，不是强度对手。改 `satori/engine.js` 或 `satori/worker.js` 后必须重跑 `node tools/build-gomoku-satori-file-package.mjs`；验收工具为 `node tools/test-gomoku-satori.mjs` 与 `node tools/verify-gomoku-satori-vcf.mjs`。

决策剖析实验室 `public/gomoku-satori-lab.html`：把 Satori 每一步决策完全摊开（威胁普查、候选排序及各项得分、迭代加深逐层结果、搜索树、VCF/VCT 证明序列、步骤回看、实时对战）。为此 `satori/engine.js` 增加了**默认关闭**的埋点：只有调用 `setTrace()` 才记录，关闭时不执行任何埋点计算，生产对局的走子结果与耗时完全不变（已有断言校验 trace 开关不改变落子）。改埋点后需重建离线包并重跑 `node tools/check-gomoku-satori-lab.mjs`（HTTP 与 file:// 两侧，含立即连五/必防/VCF 三个战术演示）。

## 持续累加训练期次

- 每一期训练数据必须保留在独立的 `五子棋训练数据<期号>/` 目录中。不要删除、移动或覆盖旧期目录，也不要只把最新一期复制成唯一数据源。
- 构建网页模型时运行 `node tools/build-gomoku-training-model.mjs`。脚本会扫描仓库根目录下所有名称以 `五子棋训练数据` 开头的目录，并把所有合法的 `gomoku-*.json` 样本合并到 `public/data/gomoku-training-model.js`。
- `五子棋训练数据1010/` 至 `1012/` 用于铭星V9Pro；`1013/` 只更新 V10 和完整累计归档，不改变旧模型先验；`1014/` 及后续期次不再并入累计归档或 V10。V10Flash 先验取材为 1008 至 1014 全部期次中 `model_version` 属于 V9Thinker（9.2）、V10（10）、V10Exp（10.3）、V10Ultra（10.1）的对局，外加 1014 及后续期次的全部对局。V9Thinker（9.2）沿用不含1010及后续期次的 V9 专用先验。构建文件同时保留冻结在1013期的完整累计归档模型，并生成冻结在1012期的 V9Pro 专家模型：普通人机样本作为基础，模型对战样本只进入对应的 `model_version`，避免对手版本的胜负污染 Pro 开局先验；V9Thinker 专家模型与 V9 专用模型保持相同数据边界。同时生成不包含1010及后续期次的 `GOMOKU_V9_TRAINING_MODEL` 和只按上述规则取材的 `GOMOKU_V10FLASH_TRAINING_MODEL`。`public/gomoku-models/v9.js` 只读 V9 专用模型，`v9pro.js` 读取 V9Pro 专家模型，`v9thinker.js` 读取 V9Thinker 边界模型，`v10flash.js` 读取 V10Flash 开局先验。
- 新增一期数据后必须重新运行上述脚本，并检查输出的 `gameCount`、`sourceDirectories` 和各期局数，确认历史期次仍被包含。
- 生成模型文件是可重建产物；更新脚本或训练数据后可以重建它，但禁止用单期数据覆盖累计模型。提交时保留训练数据目录和生成模型的变更。
- 验收与实验棋谱不得写入 `五子棋训练数据<期号>/`，也不得混入先验；它们只保存在 `docs/` 下的验证目录。若要做先验实验，用 `node tools/import-gomoku-match-as-sample.mjs <对战.json> <引擎> <输出目录>` 显式转换并记录，实验结束后按结论决定去留（负面结论应回退，样本可另存到 `docs/`）。

## AI 胜负平数据链路

- `public/gomoku.html` 根据模型代际上传 AI 的 `win`、`loss` 或 `draw`：玩家胜对应 AI `loss`，玩家负对应 AI `win`，和棋对应 AI `draw`；人机和模型对战仅 V9Thinker（9.2）、V10（10）、V10Ultra（10.1）、V10Mesa（10.2）、V10Exp（10.3）、V10Flash（10.4）、V10Thinker（10.5）、V10Bru·我非我Champion（10.6）上传三种结果；其他版本一律不上传训练数据。
- V9Thinker 的搜索参数固定为最多 7 层、14 个候选、40 秒迭代加深预算和 8 层活四威胁证明；它读取专用的 `GOMOKU_V9THINKER_TRAINING_MODEL`（当前与 V9 数据边界一致），不得把 V9Pro 专用新期次先验混入其中。
- 玩家主动投降的对局不上传训练数据；仍正常提交排行榜负局和 0 分。投降与 AI 实际获胜须在上传控制上区分。
- `supabase/functions/gomoku-training/index.ts` 必须校验并原样保存 `win`、`loss`、`draw` 三种结果；按模型版本过滤上传时不可改写结果枚举或结果含义。
- 训练模型要同时适配 AI 黑棋和白棋，并使用局面历史生成键。训练先验只能作为排序辅助，不能压过立即连五、必防等硬战术。
- V10Flash 的决策顺序固定为：立即连五（`immediate-win`）→ 自研 VCF 连续冲四必胜（`vcf-win`，证明成功即直接落子并跳过引擎与专家，省下全部思考预算）→ 必防对手立即连五（`forced-block`）→ 并行启动两个专家（V9Thinker、V10）与 Rapfi → 专家已证明必胜则直接采用（`expert-proved-win`）→ 开局先验可覆盖 Rapfi 落点（`opening-book`，仅前四手，且仅在 Rapfi 落点没有先验支持时）→ 用独立证明器复核所选落点，被证明是强制败招时改查专家备选（`expert-rejected-forced-loss`）。其余情况记录为 `mix9-expert-checked` 或 `no-proven-safe-alternative`。每步的威胁普查记录在 `lastSearch.threats`，专家观测记录在 `lastSearch.experts`。
- V10Bru·我非我Champion（内部版本号 10.6，**已全面开放**）＝ V10Ultra 的 Rapfi 配置（同引擎、同 Mix9 权重、同 12 层上限与 75 秒预算）**加上覆盖 1008 至最新期次全部对局的开局先验**（`GOMOKU_V10CHAMPION_TRAINING_MODEL`，与其它导出并列、互不影响）。它在正式页与实验页均可挑战、可作模型对战双方，**胜局 15 分**，并加入上传白名单（接收胜负平全部结果）。资源自包含于 `public/gomoku-models/v10champion/`（引擎与包字节等于 V10Ultra），file:// 离线包由 `node tools/build-gomoku-v10champion-file-package.mjs` 生成。换色验收：对 V10Ultra、V10Thinker 各 1:1（均 complete=true）。
- V10Thinker（内部版本号 10.5）是 V10Ultra 的 Rapfi 配置副本，固定 16 层深度上限、沿用 75 秒单步预算，胜局 16 分，已上架（正式页与实验页最后一位，排在 V10Ultra 之后）。它复用 V10Ultra 同一个 Rapfi 引擎与 Mix9 权重字节（`v10thinker/worker.js` 通过 `../v10ultra/` 引用，绝不另存一份引擎或权重），只把深度上限变成可调参数（`window.GomokuV10ThinkerFactory({depth,timeMs})`，默认实例 `window.GomokuV10Thinker` 深度 16、75 秒）。包装器必须在模块加载时算一次 `MODEL_BASE`：工厂会被其它页面的内联脚本调用，那时 `document.currentScript.src` 为空，否则 worker 路径会退化成页面目录而 404。`file://` 离线包由 `node tools/build-gomoku-v10thinker-file-package.mjs` 生成，改 worker 或引擎资产后必须重建。对战页另注册了 `v10thinker14/16/18` 三个深度变体供对比，正式页面用的是默认实例（16 层）。
- V10Flash 是三层融合，与 V10Exp 同构但完全独立：Rapfi Mix9 自由网（复用与 V10Ultra 相同的引擎与权重字节）+ 自研战术层（威胁识别与精确 VCF）+ 专家系统（冻结的 V9Thinker/V10 专家源码）。专家层只做两件有证明的事——已证明的必胜提前终止，以及被证明为强制败招时改查专家备选；不平均不可比评分，不声称重新训练或混合权重。融合规则与 V10Exp 一致，但 V10Flash 使用自己生成的证明核心，绝不复用 V10Exp 的 `proof-core.js`，也不共享其离线包。
- V10Flash 专家资产由 `node tools/build-gomoku-v10flash.mjs` 生成：从冻结的 `v10-core.js` 派生带 `proveForcing` 的 `v10flash/proof-core.js`（工厂名 `createGomokuFlashProofExpert`），并生成含 Rapfi 桥接、冻结专家源码、训练先验与证明核心的 `v10flash/file-package.js` 供 `file://` 使用。原核心只读不改；改动 `v10flash/worker.js`、`expert-worker.js` 或专家资产后必须重建，只改包装器则不需要。`node tools/test-gomoku-training-policy.mjs` 会校验离线包与 HTTP 路径的引擎/权重字节一致、专家源码等于冻结原文件、且证明核心不含 V10Exp 的工厂名。
- V10Flash 的搜索预算是单步 120 秒、深度上限 16 层。深度上限在常规局面远早于时间上限生效（实测均值约 1–2 秒、最大约 14 秒），因此响应速度不受提高预算影响；把深度上限提到 20 层实测会让部分着法用满 85–120 秒，已否决。Rapfi 编译内核不可改，`HASH_SIZE` 等选项单位未经证实，不得盲改。VCF 层只搜索"冲四"这一种强制着法，属精确证明，因此只可能加快或持平；`活三/VCT` 只做检测与上报，不直接落子，因为活三是否必胜取决于双方是否有更快的线路，硬性规则不成立。威胁检测与 VCF 的单元测试和真值交叉验证见 `node tools/test-gomoku-flash-threats.mjs`（用 V10Exp 证明器作为独立真值，凡声明必胜必须被其确认）。

## 铭星五子棋版本

- `Past-Gomoku-Model/` 保存历史模型源文件。当前页面默认模型为铭星V9；可挑战版本为已有的 V1、V2、V3、V6、V7、V8、V9、V9Pro（9.1）、V9Thinker（9.2）、V10（10）、V10Ultra（10.1）、V9Mesa（9.3）、V10Mesa（10.2）、V10Exp（10.3）、V10Flash（10.4）、V10Thinker（10.5）、V10Bru·我非我Champion（10.6）及展示版 Gomoku-Satori（11），缺失的 V4、V5 不补造。不得为了优化新模型覆盖或删除 V9 和历史版本。
- 新增/调整可挑战版本时，同步维护 `public/gomoku-models/` 中供页面调用的历史模型文件、`public/gomoku.html` 的模型选择项和训练上传字段；页面展示名称统一为“铭星V<版本号>”。
- 玩家战胜铭星Vx 时记 x 分；V9Pro 胜局记 10 分，V9Thinker 和 V10 各记 12 分，V10Ultra 记 15 分，V9Mesa记9分、V10Mesa记14分、V10Flash记15分；V10Exp记15分；V10Thinker记16分；V10Bru·我非我Champion记15分；负局 0 分、和棋 1 分。前端显示分数、排行榜 RPC 参数和数据库函数 `record_gomoku_result` 必须同步维护。部署前端后还要在 Supabase 执行更新后的 `supabase-gomoku-schema.sql`。
- `supabase/functions/gomoku-training/index.ts` 校验并保存所挑战的模型版本；AI 结果仍按 `win`、`loss`、`draw` 原样保存；仅 V9Thinker（9.2）、V10（10）、V10Ultra（10.1）、V10Mesa（10.2）、V10Exp（10.3）、V10Flash（10.4）、V10Thinker（10.5）、V10Bru·我非我Champion（10.6）接收全部三种结果，其他版本的上传请求全部拒收。
- 所有可挑战版本都保存版本号；人机和模型对战均仅上传 V9Thinker、V10、V10Ultra、V10Mesa、V10Exp、V10Flash、V10Thinker、V10Bru·我非我Champion 的 AI `win`、`loss`、`draw`。前端和边缘函数都必须校验此规则。
- 页面通过 `file://` 打开时 iframe 的 origin 为 `null`，跨窗口调用不得使用 `contentWindow.eval`；历史模型须用 `postMessage` 接收棋盘并返回落点，支持 `*` 目标 origin，同时校验消息来源窗口及 requestId。
- 页面通过 `file://` 打开时也必须能运行 V10Ultra：不能直接创建指向 `file://` 的 Worker，应运行 `node tools/build-gomoku-v10ultra-file-package.mjs` 生成离线包，并使用 Blob Worker 加载同一份引擎及权重；HTTP(S) 仍使用原二进制路径。更改 Worker/引擎/权重后必须重建离线包，并分别在 `file://` 和 HTTP(S) 页面验证黑白落子。

## 变更后的检查

至少运行：

```bash
node tools/build-gomoku-training-model.mjs
node --check tools/build-gomoku-training-model.mjs
node --check public/data/gomoku-training-model.js
node tools/check-gomoku-sql-syntax.mjs   # 改过 SQL 必须跑：pglast 真实语法校验
git diff --check
```

改动 Satori 引擎、包装器或决策剖析实验室时至少再跑：

```bash
node tools/build-gomoku-satori-file-package.mjs   # 改了 satori/engine.js 或 satori/worker.js 后必须重建
node tools/test-gomoku-satori.mjs
node tools/verify-gomoku-satori-vcf.mjs
node tools/test-gomoku-training-policy.mjs        # 含离线包字节一致与“11 不在上传白名单”校验
node tools/check-gomoku-satori-lab.mjs            # 需静态服务器 4173 + Chrome DevTools 9222
```

SQL 改动必须用 `node tools/check-gomoku-sql-syntax.mjs` 校验（需 `pip install pglast`）。
括号配对与关键字检查发现不了被字符串替换挤断的语句（例如 `grant ...` 与 `to ...;` 断成两截），
只有真实 PostgreSQL 解析器能发现，不要用其它检查代替它。

检查前端上传结果映射、边缘函数结果校验，以及生成模型的累计期数；不要为了清理工作区而恢复或删除用户已有的训练数据。

Mesa资源修改后运行 node tools/build-gomoku-experiment-file-package.mjs；Exp独立核心/离线包运行 node tools/build-gomoku-v10exp.mjs。所有新模型都在独立Worker运行，并分别实测HTTP/file://黑白落子和倒计时。

任一模型改动棋力（搜索参数、先验、开局书）后必须重跑换色完整对局验收：`node tools/run-gomoku-model-pair.mjs <模型A> <模型B> [标签]`，仅在棋谱重放与资源指纹全部通过、`complete=true` 后才可声称对局完成。用真人棋谱验证某个模型时用 `node tools/run-gomoku-human-line.mjs <引擎> <棋谱.json> <输出.json>`（脚本方按记录逐手重放，执子颜色不变，另一方实时对弈）；偏离之后脚本方已非针对当前对手，速胜不能当棋力证据。对战页 `tools/gomoku-experiment-browser.html` 的脚本方引擎位名固定为 `script`，颜色由棋谱或 `scriptColor` 指定，普通双引擎对局不受影响。

页面模型按用户指定强度顺序排列，V9起依次为V9、V9Pro、V9Mesa、V9Thinker、V10、V10Mesa、V10Flash、V10Exp、V10Ultra、V10Thinker、V10Bru·我非我Champion、Gomoku-Satori（展示版，排在最后）；不得按小数内部版本号排序。人机、黑方、白方选择器和实验页都保持一致。
