# 五子棋维护记忆

## 版本与数据边界

- V8 与 V9 是冻结对照，不得为了让新版本获胜而修改其源码、先验或对战规则。
- V9Pro（9.1）与 V9Thinker（9.2）由各自配置调用 `public/gomoku-models/expert-core.js`。共享核心只服务这两个版本；网页必须在两个配置文件之前加载它。
- Pro 保持 6 层、12 候选、25 秒、7 层 VCF；Thinker 保持 7 层、14 候选、40 秒、8 层 VCF。深度是迭代目标：时间耗尽采用上一完整迭代，证明胜负时可提前结束。不要把配置深度当成实际完成深度。
- 所有 `五子棋训练数据<期号>/` 必须保留。运行 `node tools/build-gomoku-training-model.mjs` 累计构建，不能拿最新一期覆盖旧数据。
- 1010 及以后期次只进入 Pro 数据边界。V9、Thinker 保留 1008/1009 先验；Pro 的模型对战先验仅取自身视角。累计归档仍保存所有合法模型视角。
- 相同内容的下载副本在新累计模型中去重，源文件不删。V9 构建保留原计数语义，防止新去重逻辑改变冻结版本。
- 现有数据模型只统计前四次 AI 落子，是开局结果先验，不是中盘训练器。先验仅用于同分排序，不能覆盖必胜、必防或专家评分。
- 只有 V8/V9/9.1/9.2 上传，四者均上传胜负平；玩家投降不上传训练样本。Thinker 胜局奖励 11 分。前后端规则必须一致。

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

- 完整对战工具：`node tools/gomoku-match.mjs <黑模型> <白模型> <输出.json>`，模型名为 `v8`、`v9`、`v9pro`、`v9thinker`。使用生产时间预算和真实时钟，不上传到 Supabase。
- 强度验收至少覆盖 Pro 对 V8/V9、Thinker 对 V8/V9/Pro，全部换色，共十个对局。保存完整棋谱、每步实际深度、时间与代码指纹。
- `node tools/analyze-gomoku-records.mjs 五子棋训练数据1012` 区分下载副本、模型视角与不同棋谱。重复确定性棋谱不能当成独立棋力样本。
- 战术/语法通过不等于棋力达标；不得在完整对战没跑完时声称达标。有限对局通过也不能宣称任意开局、任意设备必胜。
- 当前验收资料在 `docs/gomoku-1012-validation/`。测试棋谱不是用户训练数据，不要将其自动混入训练期次。
