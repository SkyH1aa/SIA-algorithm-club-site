# 五子棋训练数据维护规则

## 持续累加训练期次

- 每一期训练数据必须保留在独立的 `五子棋训练数据<期号>/` 目录中。不要删除、移动或覆盖旧期目录，也不要只把最新一期复制成唯一数据源。
- 构建网页模型时运行 `node tools/build-gomoku-training-model.mjs`。脚本会扫描仓库根目录下所有名称以 `五子棋训练数据` 开头的目录，并把所有合法的 `gomoku-*.json` 样本合并到 `public/data/gomoku-training-model.js`。
- `五子棋训练数据1010/` 及后续新期次仅用于铭星V9Pro；V9Thinker（9.2）沿用不含1010及后续期次的 V9 专用先验。构建文件同时保留完整累计归档模型，并生成 V9Pro 专家模型：普通人机样本作为基础，模型对战样本只进入对应的 `model_version`，避免 V8 或对手版本的胜负污染 Pro 开局先验；V9Thinker 专家模型与 V9 专用模型保持相同数据边界。同时生成不包含1010及后续期次的 `GOMOKU_V9_TRAINING_MODEL`。`public/gomoku-models/v9.js` 只读 V9 专用模型，`v9pro.js` 读取 V9Pro 专家模型，`v9thinker.js` 读取 V9Thinker 边界模型，禁止新期次改变 V9 或更早版本的先验。
- 新增一期数据后必须重新运行上述脚本，并检查输出的 `gameCount`、`sourceDirectories` 和各期局数，确认历史期次仍被包含。
- 生成模型文件是可重建产物；更新脚本或训练数据后可以重建它，但禁止用单期数据覆盖累计模型。提交时保留训练数据目录和生成模型的变更。

## AI 胜负平数据链路

- `public/gomoku.html` 根据模型代际上传 AI 的 `win`、`loss` 或 `draw`：玩家胜对应 AI `loss`，玩家负对应 AI `win`，和棋对应 AI `draw`；仅 V8、V9、V9Pro（训练版本号 9.1）和 V9Thinker（训练版本号 9.2）上传，四个版本均上传 AI `win`、`loss`、`draw`；V1/V2/V3/V6/V7 不上传训练数据。
- V9Thinker 的搜索参数固定为最多 7 层、14 个候选、40 秒迭代加深预算和 8 层活四威胁证明；它读取专用的 `GOMOKU_V9THINKER_TRAINING_MODEL`（当前与 V9 数据边界一致），不得把 V9Pro 专用新期次先验混入其中。
- 玩家主动投降的对局不上传训练数据；仍正常提交排行榜负局和 0 分。投降与 AI 实际获胜须在上传控制上区分。
- `supabase/functions/gomoku-training/index.ts` 必须校验并原样保存 `win`、`loss`、`draw` 三种结果；按模型版本过滤上传时不可改写结果枚举或结果含义。
- 训练模型要同时适配 AI 黑棋和白棋，并使用局面历史生成键。训练先验只能作为排序辅助，不能压过立即连五、必防等硬战术。

## 铭星五子棋版本

- `Past-Gomoku-Model/` 保存历史模型源文件。当前页面默认模型为铭星V9；可挑战版本为已有的 V1、V2、V3、V6、V7、V8、V9、铭星V9Pro（训练版本号 9.1）和独立的铭星V9Thinker（训练版本号 9.2），缺失的 V4、V5 不补造。不得为优化 V9Pro/V9Thinker 覆盖或删除 V9 和历史版本。
- 新增/调整可挑战版本时，同步维护 `public/gomoku-models/` 中供页面调用的历史模型文件、`public/gomoku.html` 的模型选择项和训练上传字段；页面展示名称统一为“铭星V<版本号>”。
- 玩家战胜铭星Vx 时记 x 分；铭星V9Pro（版本号 9.1）胜局记 10 分，铭星V9Thinker（版本号 9.2）胜局记 11 分；负局 0 分、和棋 1 分。前端显示分数、排行榜 RPC 参数和数据库函数 `record_gomoku_result` 必须同步维护。部署前端后还要在 Supabase 执行更新后的 `supabase-gomoku-schema.sql`。
- `supabase/functions/gomoku-training/index.ts` 校验并保存所挑战的模型版本；AI 结果仍按 `win`、`loss`、`draw` 原样保存；V1/V2/V3/V6/V7 的结果请求全部拒收，V8、V9、V9Pro（9.1）与 V9Thinker（9.2）接收全部三种结果。
- 所有可挑战版本都保存版本号；V1、V2、V3、V6、V7 不上传训练数据，V8、V9、V9Pro、V9Thinker 上传 AI 的 `win`、`loss`、`draw` 全部结果。前端和边缘函数都必须校验此规则。
- 页面通过 `file://` 打开时 iframe 的 origin 为 `null`，跨窗口调用不得使用 `contentWindow.eval`；历史模型须用 `postMessage` 接收棋盘并返回落点，支持 `*` 目标 origin，同时校验消息来源窗口及 requestId。

## 变更后的检查

至少运行：

```bash
node tools/build-gomoku-training-model.mjs
node --check tools/build-gomoku-training-model.mjs
node --check public/data/gomoku-training-model.js
git diff --check
```

检查前端上传结果映射、边缘函数结果校验，以及生成模型的累计期数；不要为了清理工作区而恢复或删除用户已有的训练数据。
