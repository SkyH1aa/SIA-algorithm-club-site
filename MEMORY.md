# 五子棋维护记忆

## 独立Ultra NNUE训练（2026-10-11，用户维持生产原版）

- 用户明确停止修改V10Ultra；生产 `public/gomoku-models/`、网页、Supabase、原NNUE及训练先验全部维持原样。训练入口只读生产资产，下载/环境/教师副本/自对弈/检查点/候选全部放 `training/gomoku-nnue/`，绝不自动部署或替换。训练前后核对全部模型文件与先验SHA256，报告 `cache/isolation.json`。该目录不得作为公开网站训练资产发布。
- 已下载官方NNUE训练器到 `training/gomoku-nnue/trainer/`（commit `ed6ff57cbd9d31bc5217ecbdf0de2a004c6be374`），官方Rapfi250615原生引擎到 `engine/`，来源/指纹在两个source.json。重建 `python tools/setup-gomoku-nnue.py`；Windows独立`.venv`复用主Python CUDA PyTorch，额外依赖独立，非容器级环境。已编译官方C++编码扩展；本路线避免Windows不兼容的KeOps全模型自动导入，无修改上游文件。
- 原网没有原mapping MLP `.pt`，不能假称恢复完整训练检查点。当前实现 `gomoku_nnue_model.py` 逐字节导入量化网，冻结原码本、棋型映射和深度卷积，复用官方量化感知Mix9s策略/价值头，训练146,596头参数，导出同格式bin.lz4。未训练导入/导出的解压字节完全一致，GPU梯度与原生黑白加载检查通过。新候选仍须浏览器速度和完整棋力验收才能发布。
- `tools/train-gomoku-ultra-losses.py`扫描所有训练期与独立自战，只有新独立完整合法Ultra10.1败局触发；副本/重复轨迹/不同视角不重复训练。教师固定当前初始权重、更深原生搜索缓存标签，85%搜索分数转换WLD+15%实际结果，难例3倍混入普通历史样本；教师搜索动作而非玩家败招做策略标签。`--watch`是用户自行运行本机监听，尚未启动后台任务。
- `tools/train-gomoku-ultra-selfplay.py`不同随机合法开局、完整自战、累计标签、训练、保留独立验证最优；游戏级/对称共享中盘分组防泄漏，当前头训练忽略公共前六手。训练目录数据不能移到网页训练期次或上传Supabase。初始权重永远冻结，所有run另存。
- 用户自行执行100局入口：`& .\tools\train-gomoku-ultra-100.ps1`，100条新完整非重复自战+2000训练步，之后候选对初始网换色各一局（75秒/12层），报告 `runs/<时间戳>/initial-comparison.json`。`--skip-arena`仅跳过额外24场择优，不跳过这两局；没有长期训练/100局运行、没有强度提升结论。训练验证未改善时best可能是baseline，双色观察用实际训练last并注明，避免用原版自己对战冒充提升。
- 多轮内部择优只有验证损失改善+至少12组不同开局换色完整对局+黑白均>50%+配对Hoeffding下界>50%才更新本地 `runs/champion.json`，不能承诺全局最优或每次训练更强，绝不据此自动改网站。详细操作 `training/gomoku-nnue/README.md`；检查 `tools/test-gomoku-nnue.py`只短流程/合成2步训练，不是完整棋力验收。
- 已新增只读诊断工具/16项双方颜色D4强制杀证书。实测第14手前48个深度比较（16样本×12/18/24）均返回同一对称败招并报-M12；加层不能据此修复。第8手18/24已报负杀，备选白(3,10)之后Rapfi报黑+M7，不能当安全标签。更早开局诊断因用户要求停止，早期对比报告是未完成，不得称完整验收。

## Ultra 1013 新败局诊断（分析，未升级）

- 2026-10-11新增1013败局 `gomoku-20261011121404834-5ea23e88-c0a2-4b8b-b7b4-29e01d2ae80a.json`：玩家黑、Ultra白、31手，合法黑胜。第14手白(7,6)，坐标1起始，之后黑棋有已独立复核的连续冲四杀，11半回合形成双胜点、13半回合到最终连五；当前Ultra配置12层/75秒，实际深度未记录，不能直接断言只需加层即可修复。白(3,10)未被20层VCF找到黑必胜，但不等于证明安全。见 `docs/gomoku-ultra-1013-analysis/README.md` 与 `audit.json`。
- 1014中有同败局的字节相同副本，源目录/文件都保留，训练时去重；不能把副本或Ultra自战败方当成独立玩家败局。此次仅分析，没有重建先验或改权重/参数。
- 当前Ultra自由网Git blob SHA `af04ad2bbb1d95aa5721921627294ef30fdbb0b2` 与官方 `dhbloo/rapfi-networks`当前同名freestyle网一致，没有找到直接换文件即升级的更大官方自由网。真正训练参考 `dhbloo/pytorch-nnue-trainer`，量化推理bin-lz4不能当.pt检查点；构建开局先验脚本不训练NNUE。升级先做独立候选、真实depth/PV/nodes计时、同预算加深及威胁复核，再做教师标注和足量双颜色自战训练，冻结其他模型。

## Mesa、V10Exp 与 V10Flash 正式版本

- 用户已正式命名：SlowRenju=铭星V10Mesa（内部10.2），胜局14分；GomokuZero=铭星V9Mesa（内部9.3），胜局9分。两者独立120秒预算，正式入口 `public/gomoku.html` 支持人机及模型对战和倒计时。V9Mesa不上传，V10Mesa上传AI胜负平全部结果，玩家投降不上传。不要沿用废弃的10.201/10.202实验标识写入后端。
- 铭星V10Exp（内部10.3）已正式接入，180秒预算；用户已决定胜局15分，与V10Ultra相同。人机和模型对战均上传自身视角全部胜负平，排行榜正常记录胜负平及积分。
- 铭星V10Flash（内部10.4）正式接入：原V11候选（Rapfi Mix9 自由网，16层，现120秒单步预算），用户正式命名为V10Flash，正式胜局15分，人机和模型对战均上传自身胜负平全部结果。离线支持运行 `node tools/build-gomoku-v10flash.mjs`。
- V10Flash先验取材规则（2026-10-12用户指定）：取1008至1014全部期次中 `model_version` 属于 V9Thinker(9.2)、V10(10)、V10Exp(10.3)、V10Ultra(10.1) 的对局，外加1014及后续期次的全部对局；由 `GOMOKU_V10FLASH_TRAINING_MODEL` 导出（当前68局，其中四家模型63局、1014期其余版本5局；V10Exp尚无对局记录）。累计归档与V10先验冻结在1013，V9/V9Pro/V9Thinker边界不变。开局书规则：先跑立即连五与必防，再查先验；仅当Rapfi落点在数据中无支持且存在达门槛的数据落点时才改用数据落点，且限前四手；引擎与数据一致时保留引擎。决策记录在 `lastSearch.reason`（`rapfi-mix9-flash`/`opening-book`）与 `lastSearch.book`。阈值 `BOOK_MIN_GAMES=4`、`BOOK_MAX_MOVE=4`，评分沿用V10的 `(win-loss)/(win+loss+draw+6)`。
- 2026-10-12 接入先验并扩大取材后重跑换色验收（全部 complete=true，棋谱重放与SHA256通过）：V10Flash对V9Thinker 2胜0负（21/42手）、对V10Ultra 2胜0负（19/64手）、对V10 2胜0负（25/48手）；对V10Exp 1胜1负（V10Flash执黑47手胜、执白43手负，两局皆黑胜）。三家执白局都在第2手由先验改下6,6（Rapfi原选7,8，数据10局7胜3负）。与V10Exp同档，尚无证据高于V10Exp。报告 `docs/gomoku-v10flash-vs-*-validation/README.md`，工具 `node tools/run-gomoku-model-pair.mjs <A> <B> [label]`。样本仍小，一组空盘换色不等于Elo结论。
- 2026-10-12 先验补强实验（结论：不成立，已回退）：把V10Flash执白负V10Exp那局（43手）经 `node tools/import-gomoku-match-as-sample.mjs <对战.json> <引擎> <输出目录>` 转成训练样本并放入新期次 `五子棋训练数据1015/`，先验从68局/162条变为69局/165条。该败绩把"斜一"等价类（6,6/6,8/8,6/8,8）从10局7胜3负（0.250）压到11局7胜4负（0.176），与"斜二"类并列；开局书并列时取棋盘扫描顺序最先者，白棋应对7,7的落点遂从6,6变为5,5。结果V10Flash执白对V10Ultra由胜（64手）转败（81手），对V10Exp由负43手变为负29手，执黑两局不变；对V10Ultra由2:0变1:1。结论：开局书只覆盖前四手，单条样本跨不过 `BOOK_MIN_GAMES=4` 新增条目、却能改变既有条目评分并整体换点，先验不是强度杠杆。已删除1015期并重建回退（先验68局/162条，开局书回到6,6）；样本另存 `docs/gomoku-v10flash-prior-experiment/imported-sample.json`，实验报告与对照棋谱见同目录与 `docs/gomoku-v10flash-vs-*-1015-validation/`。验收棋谱不得留在训练期次内。
- 2026-10-12 V10Flash搜索改造（预算120秒+自研战术层）：单步预算90→120秒（`THINK_MS`，同步gomoku.html/实验页倒计时与对战页limits），深度上限保持16层——实测提到20层会出现85–120秒的停顿，违反"速度快"要求，已否决。新增自研战术层（`v10flash.js`内，非Rapfi内核）：威胁识别（活四/冲四/活三）+精确VCF连续冲四必胜证明（只搜冲四，对手每步唯一应手，找到即直接落子跳过引擎），决策顺序为立即连五→VCF必胜→必防对手连五→开局先验→Rapfi；每步威胁普查写入`lastSearch.threats`。速度优化：战术扫描只取棋子邻近空点；VCF命中即省掉引擎搜索。Rapfi为编译内核不可改，`HASH_SIZE`/`THREAD_NUM`/`STRENGTH`等单位未经证实，禁止盲改。验收：对V10Ultra 2胜0负（21/66手）、对V10Exp 1胜1负（53/43手，仍皆黑胜），用时均值1.06–1.75秒、最大约11秒；VCF在每对中实际触发5次。战术层正确性用`node tools/test-gomoku-flash-threats.mjs`验证（30个真实局面/6次必胜声明全部被V10Exp证明器确认为真+活四冲四活三静局必败构造用例）。报告`docs/gomoku-v10flash-search-v2-validation/README.md`。活三只检测上报不直接落子，因为其必胜性取决于双方是否有更快线路。
- 2026-10-12 V10Flash三层融合（Rapfi+自研战术层+专家系统）：按V10Exp同构架构融合，但完全独立——使用自己生成的证明核心 `v10flash/proof-core.js`（工厂名 `createGomokuFlashProofExpert`），绝不复用V10Exp的proof-core，也不共享其离线包；冻结原核心只读。决策顺序：立即连五→自研VCF必胜→必防对手连五→并行启动V9Thinker/V10专家与Rapfi→专家已证明必胜则采用(`expert-proved-win`)→开局先验可覆盖Rapfi落点(`opening-book`)→独立证明器复核所选落点、被证明强制败招时改查专家备选(`expert-rejected-forced-loss`)→其余为`mix9-expert-checked`/`no-proven-safe-alternative`。专家层只做两件有证明依据的事（已证必胜提前终止、被证败招时换备选），不平均评分、不声称重训。构建：`node tools/build-gomoku-v10flash.mjs`生成证明核心与含专家源码+训练先验+Rapfi桥接的离线包（14.38MiB）；旧`build-gomoku-v10flash-file-package.mjs`已删除；`test-gomoku-training-policy.mjs`校验离线包与HTTP引擎/权重字节一致、专家源码等于冻结原文件、证明核心不含V10Exp工厂名。验收：对V10Ultra仍2胜0负（21/66手）、对V10Exp仍1胜1负（53/43手），用时均值1.15–1.80秒、最大约11秒，与融合前逐手一致。专家层实际作用：58手通过证明器复核（`mix9-expert-checked`），1手Rapfi落点被证明是强制败招但专家备选也无一安全（`no-proven-safe-alternative`），0次专家必胜提前终止、0次因败招换备选——即新增了证明式安全网，但未提升胜率；合理解释是自研VCF层已先吃掉同类必胜（两对各5次`vcf-win`）。报告 `docs/gomoku-v10flash-fusion-v3-validation/README.md`。
- 2026-10-12 metool「神之一手」同源确认：`public/gomoku-models/v10ultra/NOTICE.md` 已写明这份包就是 metool 上**神之一手**那一档所用的同一个 Rapfi WASM + Mix9 自由网（标题即 "Rapfi Mix9 engine (Divine Move / 神之一手)"），且该构建是**单线程**（glue 里无 pthread/SharedArrayBuffer/Atomics），所以站点也不可能靠多线程取胜；包内**没有任何开局库文件**，Rapfi 引擎层的 `USEDATABASE`/YXDB 需要额外的库文件与格式，我们不具备，因此"开局库"只能是我们自己写的先验书（V10Flash 已有）。站点比我们强只可能来自**给引擎更多搜索量**（时间/深度）。
- 2026-10-12 深度实测（V10Ultra 配置）：同一中局 ply8 上，深度上限 12 给出 -858 并选 6,3，14 层才看出 -M30（已被证明必败）并改选 5,5，代价约 0.9 秒；即 12 层会漏掉 14 层才出现的杀棋。V10Ultra 因此**保持 12 层不变**（用户决定，未修改）；曾一度改为 16 层做实验，已完全回退（`git diff` 为空）。
- 2026-10-12 新建 V10Thinker（暂定名，未接入任何页面）：V10Ultra 的 Rapfi 配置副本，复用同一引擎与 Mix9 权重字节（worker 用 `../v10ultra/` 引用），深度可参数化（`GomokuV10ThinkerFactory({depth,timeMs})`，默认实例深度 16）。包装器的 `MODEL_BASE` 必须在模块加载时算一次——工厂会被其它页面内联脚本调用，那时 `document.currentScript.src` 为空，否则 worker 路径退化成页面目录而 404（已踩过）。对战页注册 `v10thinker14/16/18` 三个变体；接入页面（含 file://）前需运行 `node tools/build-gomoku-v10thinker-file-package.mjs`（尚未生成包）。
- 2026-10-12 深度对比结论（重要方法学）：V10Thinker 14/16/18 分别对 V10Ultra 与 V10Exp 换色共六组，**全部 1:1，且 12 局全部执黑方获胜**——空盘换色协议无法区分这些引擎，1:1 只反映先手优势。深度 12→18 没有改变任何一局结果。此前"V10Flash 2:0 V10Ultra"同属该问题的产物（V10Ultra 被 12 层卡住），把 V10Ultra 提到 16 层后立即变 1:1。因此当前证据**不足以给 V10Flash/V10Exp/V10Ultra/V10Thinker 排序**；要排序必须改用"固定开局双方各执一次、多开局统计"的协议（对战页已有 `script`/`scriptColor` 可复用）。报告 `docs/gomoku-v10thinker-depth-validation/README.md`。
- 2026-10-14 V10Champion（内部10.6，待发布）：按用户要求改为 V10Ultra 同款 Rapfi 配置（同引擎/同 Mix9 权重/12层/75秒）并叠加**全量阵容先验**——新增导出 `GOMOKU_V10CHAMPION_TRAINING_MODEL`，取材 1008–1015 所有期次的全部对局（166局/345条），与 V10Flash 的版本范围取材互不影响，其余导出边界未变。2026-10-14 用户改为**全面开放**：更名“铭星V10Bru·我非我Champion”，加入 `MODEL_VERSIONS`（正式页与实验页均排在最后），可挑战、可作模型对战双方，胜局记 15 分，并加入上传白名单接收胜负平全部结果。资源自包含于 `public/gomoku-models/v10champion/`。换色验收：对 V10Ultra 1:1（21/41手）、对 V10Thinker 1:1（69/29手），complete=true；冠军每步约0.26秒，与 V10Ultra 同速，全量先验书实际触发过 1 手。
- 2026-10-12 V10Thinker上架（用户决定）：固定16层（沿用V10Ultra的75秒预算与同一Rapfi引擎/Mix9权重字节），内部版本号**10.5**，显示名铭星V10Thinker，**胜局16分**（首个超过旧上限的积分，SQL 的 `p_win_points` 已从 1–15 提到 1–16，否则16分会被拒），排序在 V10Ultra 之后（正式页与实验页最后一位），并加入上传白名单（10.5 接收胜负平全部结果，与其余已上架模型一致）。file:// 离线包 `v10thinker/file-package.js` 已生成（14.27MiB），改 worker 或引擎资产后须重跑 `node tools/build-gomoku-v10thinker-file-package.mjs`。上架后换色验收（同配置）：对V10Ultra 1:1、对V10Exp 1:1、对V10Flash 1:1，三对共12局**全部执黑方获胜**——没有任何证据表明它是这几个里最强的，16分与末位排序是用户的排序决定而非数据结论。报告 `docs/gomoku-v10thinker-vs-v10flash-validation/README.md`。
- 2026-10-12 真人棋谱回放：工具 `node tools/run-gomoku-human-line.mjs <引擎> <棋谱.json> <输出.json>`，把某局棋谱的一方逐手重放（脚本方），另一方实时对弈，执子颜色不变；对战页新增 `script` 引擎位与 `script`/`scriptColor` 参数。用1014期老J（执黑）击败V10Ultra（执白，31手）那局测V10Flash：V10Flash执白第1手就改下6,6（原局V10Ultra下5,4）并12手取胜。该局面开局书沉默（5,4点仅2局记录低于4局门槛），差异来自V10Flash的16层搜索（当时预算90秒，现为120秒）。注意：偏离后脚本方走法已非针对当前对手，速胜不能当棋力证据。报告 `docs/gomoku-v10flash-human-line-validation/README.md`。
- 当前正式上传白名单为9.2/10/10.1/10.2/10.3/10.4/10.5/10.6（V9Thinker、V10、V10Ultra、V10Mesa、V10Exp、V10Flash、V10Thinker、V10Bru·我非我Champion），八者全部上传胜负平；其余版本不上传。V9Pro 10分、V9Thinker 12分、V10 12分、V10Mesa 14分、V10Flash 15分、V10Exp 15分、V10Ultra 15分、V10Bru·我非我Champion 15分、V10Thinker 16分、V9Mesa 9分。前端、边缘函数和排行榜RPC必须一致；SQL 的 `p_win_points` 上限已从 15 提到 16（16 分是首个超过旧上限的积分）。
- 页面顺序由用户指定，V9起为V9、V9Pro、V9Mesa、V9Thinker、V10、V10Mesa、V10Flash、V10Exp、V10Ultra、V10Thinker、V10Bru·我非我Champion、Gomoku-Satori（展示版，最后一位）；不得按内部小数版本号排序。前端人机/黑方/白方选择器及独立实验页使用同一顺序。中英文排行榜提示必须包含各模型的正式积分。
- 2026-10-15 Gomoku-Satori 上架（用户决定，原名 V11Ge）：展示版，版本号 **11**，显示名“Gomoku-Satori（展示版）”，排在模型列表最后。纯 JavaScript 自研引擎（线枚举 + 增量棋型评估 + 迭代加深 negamax/alpha-beta/PVS + 置换表 + 杀手着法与 history 启发 + 静止期搜索 + 精确 VCF 与 VCT 证明），**不使用 Rapfi/WASM/神经网络，也不读取任何训练先验**。定位边界：可参与人机对战与模型对战（可作对手），但**不计积分、不上传训练数据、不写排行榜**——前端 `isExhibitionVersion(11)` 返回 0 分并跳过 `record_gomoku_result`（SQL 只接受 1–16 分，0 分会报错），边缘函数 `acceptsResult` 白名单不含 11 但版本号本身合法，因此仍可作模型对战对手。资源：`public/gomoku-models/satori.js` 包装器 + `satori/engine.js` + `satori/worker.js` + 生成的 `satori/file-package.js`（32.58 KiB，file:// 用 Blob Worker；改 engine/worker 后必须重跑 `node tools/build-gomoku-satori-file-package.mjs`）。单步预算 16 秒，页面倒计时同步。诚实棋力记录：对 V9Thinker 与 V10Ultra 的双色空盘均 0:2，16 秒预算下固定开局套件（6 开局×换色）均 **0:12 全败**，说明它与这几代专家引擎差距在评估函数质量而非搜索框架；它没有积分与排序主张，仅作展示。验证工具：`node tools/test-gomoku-satori.mjs`、`node tools/verify-gomoku-satori-vcf.mjs`（VCF 声明须被独立朴素验证器确认）；`tools/test-gomoku-training-policy.mjs` 额外校验离线包引擎字节一致、引擎不含 Rapfi/WASM/先验引用、11 不在任何上传白名单内。
- 2026-10-15 Satori 决策剖析实验室（用户要求“100% 剖析每一个动作和每一个决策”，用于对社员展示）：新增 `public/gomoku-satori-lab.html`，含决策卡（触发原因/深度/节点/评估分/用时）、搜索前威胁普查（双方成五点数、冲四候选、活三候选）、候选着法完整排序表（含被剪掉的候选及进攻/防守/history/中心各分量）、迭代加深逐层结果（每层最佳着法与节点数）、可展开搜索树（真实父子结构，标注轮到谁走、返回值、剪枝与置换表命中原因），以及三种“非搜索”决策的战术演示（立即连五/必防/VCF）；支持棋谱回放与实时对战两种模式。为支撑剖析，`satori/engine.js` 增加**默认关闭**的埋点：不调用 `setTrace()` 即完全不记录、不产生额外计算，生产对局行为与字节不受影响（断言校验 trace 开关不改变落子结果）。事件类型：`threat-scan`/`root-candidates`/`candidates`/`iteration`/`node-open`/`node-close`/`node-prune`/`node-cutoff`/`node-quiescence`/`node-forced`/`decision`；树事件按迭代重置并限流（`treePly`/`treeMax`），候选表只在 `candidatePly` 以内记录，避免数万条事件压垮页面。验收：`node tools/check-gomoku-satori-lab.mjs`（HTTP 与 file:// 各 4 手剖析、威胁普查 4/4、候选表/迭代表/搜索树齐全、三个战术演示分别复现 immediate-win/forced-block/vcf-win、页面不写任何后端）。
- 2026-10-15 剖析实验室的两个真实缺陷（已修，均加了回归守卫）：① **i18n 时序**——本页大量文案由脚本生成，而内联脚本先于 ClubI18n.init() 执行（i18n.js 延迟 boot），首次取到的就是原始 key，页面又没监听 club:langchange 重渲染，于是全页显示 satoriLab.noData 之类。修法：所有动态渲染集中到 refreshLocalizedUi()，注册 club:langchange 并在初始化后 setTimeout 兜底刷一次（与本仓库 ds-lab/heap-lab 的既有约定一致）。② **状态行与变量不能存已译文本**——状态行改为保存「key + 变量」、决策原因保存原始 reasonCode，渲染时才翻译；否则切英文后句子里会残留中文（测试已捕获英文状态行里的中文决策类型）。另修**亮色主题适配**：本页原先硬编码深色组件，亮色下出现白字压白底（threat-card dd 完全不可见）与浅青徽章不可读；改为自定义变量 + html[data-theme=light] 覆盖，遵循全站「默认暗色 + light 覆盖」约定。check-gomoku-satori-lab.mjs 现含 i18n 回归守卫（首次渲染无 key 泄漏、分析后无泄漏、切英文重渲染、英文状态行不含中文）与 runSeq 等待（不依赖状态行文案或用例步数，避免竞态导致的假通过）。入口：五子棋页头部链接、可视化实验室列表（`lab.common.satori*`），并登记 admin-hub（`admin.featureSatoriLab`）。
- Mesa资源保留在 `public/gomoku-models/experimental/`，正式别名在 `mesa.js`。SlowRenju自由棋fflag=0/nosix=0，原24层/60宽度和评估参数不变，独立WASM Worker；初始384MiB内存。GomokuZero使用公开iteration-150已有权重，FP32 ONNX+PUCT最多2000模拟，全合法候选；这不是本项目新训练网络。
- Mesa可重建工具：`python tools/build-gomoku-slowrenju.py --emcc <emcc路径>`、`python tools/export-gomoku-zero.py <checkpoint.pt>`、`node tools/build-gomoku-experiment-file-package.mjs`。训练目录仍持续累加，不能用外部网络覆盖历史先验。
- V10Exp是决策层融合：复用冻结的V9Thinker/V10专家源码，在独立Worker并行搜索；复用V10Ultra相同的Rapfi WASM和10MB Mix9自由网，独立桥接主搜索最多18层/164秒/不限节点。只用专家已证明VCF或立即胜着提前终止；神经网落点由独立12层VCF证明器检查，发现强制败招才查验专家备选。不平均不可比评分、不声称混合/重新训练了权重。未证明败招不等于证明安全。
- V10Exp资源在 `v10exp.js` / `v10exp/`；`node tools/build-gomoku-v10exp.mjs` 从冻结核心生成带proof-only API的独立派生核心和file://源码包，绝不改原核心。HTTP直接引用原NNUE二进制；file://用原Ultra离线包中的同字节资产和Blob Worker。首次准备模型在读条之前，计时不包含资产下载。主线程179秒看门狗只接受完整迭代或已证明的落点，不随机降级；暂停/切换/重启终止所有相关Worker。
- 所有历史模型源码、配置、NNUE权重和训练边界冻结。实验页面 `public/gomoku-experiments.html` 所有对局均不上传、不计分；正式页面实施Mesa与Exp生产计分/上传规则。
- 原12场Mesa对比棋谱在 `docs/gomoku-experiment-validation/`：V10Mesa黑白均胜V9Thinker/V10，对Ultra黑胜白负（5胜1负）；V9Mesa仅黑胜Thinker，其余5负。保留真实旧报告和资源SHA256；新命名不改旧报告结果。
- V10Exp完整六场换色对比在 `docs/gomoku-v10exp-validation/`；工具 `node tools/run-gomoku-experiment-browser.mjs <黑模型> <白模型> <报告路径>`（静态服务器4173、独立Chrome DevTools9223），汇总 `node tools/summarize-gomoku-v10exp.mjs`。12场Mesa汇总工具为 `tools/summarize-gomoku-experiments.mjs`。只在所有棋谱重放与资源指纹通过、complete=true后声称对局完成，验收棋谱不能混入训练期次。
- 生产页面集成：`GOMOKU_UI_PORT`可指定独立Chrome端口（默认9222）；`node tools/check-gomoku-page-integration.mjs`模拟后端避免实际写入，分别验证HTTP/file、全部模型结果上传/积分、模式清盘、新模型双颜色即胜优先、120/180秒读条。`node tools/test-gomoku-training-policy.mjs`验证边缘函数和离线NNUE字节一致性。
- 2026-10-15 剖析实验室的日间/夜间适配（用户反馈“白天看不清棋盘和选择、悬停实验室选择直接变白”）：根因是 **theme.css 有多条全站 `!important` 规则**会覆盖页面自有样式——`html[data-theme="light"] .board { background:#FFFFFF !important }` 把棋盘刷成纯白、`select`/`.btn` 被强制成白底 `#E5E5EA` 淡边。修法：本页用同级选择器 + `!important` 覆盖回自己的棋盘底色（琥珀渐变 + `--lab-grid-line` 明确格线），主按钮接全站强调色但改用更深的 `#C2410C`（全站 `#E07A5F` 配白字只有 2.95:1，不达标；`#C2410C` 为 5.18:1）。另外三处硬编码白色一律改为变量/主题色：`.back-link:hover`、`.btn:hover`、`.mode-tabs button.active` 原本 `color:#fff`，亮色下白字压白底直接消失，改用 `var(--cyan)`/`var(--lab-on-accent)`；白子加 `box-shadow` 深色描边，否则在浅色棋盘上不可见。暗色棋盘原先只靠 1px 网格间隙透底色，格线过弱，现统一由 `--lab-grid-line` 提供。测试要点：**theme.js 在 auto 模式下会按北京时间自动切换主题**，验收必须用 `ClubTheme.setMode(mode,{persist:false,syncRemote:false})` 固定，直接改 `data-theme` 属性会被覆盖导致测不准；`check-gomoku-satori-lab.mjs` 现含主题可读性守卫（两种主题各 14 项对比度 ≥3:1、棋盘保留自有底色、格子有格线、白子有描边）。另注意：写验收脚本时正则不要放进 Node 模板字符串，`\s` `\(` 会被吞掉导致静默误判（本次踩过两次）。
- 2026-10-11 V10Exp六场全部完成、棋谱及SHA256复核通过：对Thinker/V10黑白均胜，对Ultra黑胜白负，总5胜1负；103次落子平均7.710秒、最长77.184秒，无180秒超限。尚未双色全面超过Ultra；用户已决定正式积分15分。报告 `docs/gomoku-v10exp-validation/README.md`。HTTP/file://真实神经网黑白搜索、读条和运行中重启取消均通过；生产页面每种来源84个人机结果和588个模型对战组合通过，边缘函数588项离线检查通过。本次未部署远端Supabase，发布时需部署新的边缘函数以接受10.2/10.3及新对手版本。

- 页面顺序由用户指定，V9起为V9、V9Pro、V9Mesa、V9Thinker、V10、V10Mesa、V10Flash、V10Exp、V10Ultra；不要按内部小数版本号排序。前端人机/黑方/白方选择器及独立实验页使用同一顺序。中英文排行榜提示必须包含Mesa与Exp的正式积分。

## 版本与数据边界

- V8 与 V9 是冻结对照，不得为了让新版本获胜而修改其源码、先验或对战规则。
- V9Pro（9.1）与 V9Thinker（9.2）由各自配置调用 `public/gomoku-models/expert-core.js`。共享核心只服务这两个版本；网页必须在两个配置文件之前加载它。
- Pro 保持 6 层、12 候选、25 秒、7 层 VCF；Thinker 保持 7 层、14 候选、40 秒、8 层 VCF。深度是迭代目标：时间耗尽采用上一完整迭代，证明胜负时可提前结束。不要把配置深度当成实际完成深度。
- 所有 `五子棋训练数据<期号>/` 必须保留。运行 `node tools/build-gomoku-training-model.mjs` 累计构建，不能拿最新一期覆盖旧数据。
- V9、Thinker 保留 1008/1009 先验；Pro 冻结在 1012 期，模型对战先验仅取自身视角。1013 期只更新 V10 与累计归档；1014 及后续期次只进入 V10Flash 先验，不再并入累计归档或 V10。累计归档仍保存所有合法模型视角。
- V10 是独立模型，使用全部累计训练期次（包括 1013 及后续），由独立的 `public/gomoku-models/v10-core.js` 和 `v10.js` 加载；不得修改 V8、V9、V9Pro、V9Thinker 或 `expert-core.js` 来提升 V10。V10 专属开局配置与搜索调整只能写入 V10 文件。
- 相同内容的下载副本在新累计模型中去重，源文件不删。V9 构建保留原计数语义，防止新去重逻辑改变冻结版本。
- 现有数据模型只统计前四次 AI 落子，是开局结果先验，不是中盘训练器。先验不能覆盖必胜、必防。V9/V9Pro/V9Thinker/V10 只把它当同分排序辅助；V10Flash 无内部候选排序，按上面的开局书规则使用（仅前四手、仅当引擎落点无数据支持时生效）。
- 只有 V9Thinker（9.2）、V10（10）、V10Ultra（10.1）、V10Mesa（10.2）、V10Exp（10.3）和 V10Flash（10.4）上传训练数据，六者均上传 AI 胜/负/和；V1/V2/V3/V6/V7/V8/V9/V9Pro/V9Mesa 均不上传。玩家投降不上传训练样本。Pro 胜局奖励 10 分，Thinker 与 V10 各奖励 12 分，V10Mesa 与 V10Flash 各 14 分，V10Exp 与 V10Ultra 各 15 分，V9Mesa 9 分。前端、边缘函数和排行榜 SQL 规则必须一致。
- V10 的速度优化必须只修改 `v10-core.js`：保留 8 层、20 候选、威胁深度 10 和 40 秒配置；允许复用位置键控 TT、立即胜着/静态评估/VCF 缓存和减少无效 aspiration 重搜，但不能修改 V8/V9/V9Pro/V9Thinker 或 `expert-core.js`。
- V10Ultra（训练版本号 10.1）是独立的 Rapfi Mix9 freestyle NNUE Worker，资源放在 `public/gomoku-models/v10ultra/`，含 `worker.js`、`rapfi-single.js`、`rapfi-single.wasm`、约 10 MB `rapfi.data` 与 GPL/CC0 `NOTICE.md`。使用独立 Worker、75 秒单步预算和 15 分胜局奖励；不要把 NNUE 资源替换或混入旧模型。V10Flash（10.4）复用同一份 Rapfi 引擎与 Mix9 权重，代码在 `public/gomoku-models/v10flash.js` 与 `v10flash/`，只是预算改为 90 秒 / 16 层并加开局书；两版共用的引擎与权重字节必须一致。模型对战和人机对战只能上传 V9Thinker/V10/V10Ultra/V10Mesa/V10Exp/V10Flash 的胜负平。
- `file://` 页面 origin 为 `null`，浏览器不能直接以 `file://` URL 创建 Worker。V10Ultra 在该模式下动态加载可重建的 `v10ultra/file-package.js`，以 Blob Worker 和内嵌二进制运行同一份 Rapfi 引擎；修改 Rapfi 资源或 Worker 后运行 `node tools/build-gomoku-v10ultra-file-package.mjs`。V10Flash 同样有 `v10flash/file-package.js`，由 `node tools/build-gomoku-v10flash.mjs` 重建（改 `v10flash/worker.js`、`expert-worker.js` 或专家资产后必须重建；只改包装器 `v10flash.js` 或先验数据则不需要）。HTTP(S) 继续使用原二进制资源，不加载离线包。浏览器中需分别实测两种来源的黑白落子。
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
