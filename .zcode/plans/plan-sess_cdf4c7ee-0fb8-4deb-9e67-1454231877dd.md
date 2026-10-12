## 一、V10Flash 积分 14 → 15

先说一个核实结果：**边缘函数 `gomoku-training/index.ts` 完全不涉及积分**（只校验版本白名单、结果枚举、棋谱合法性），SQL 里也只有 `p_win_points between 1 and 15` 的范围校验——15 本来就在范围内。所以这次积分改动落在前端映射、提示文案、注释和测试上，边缘函数与 SQL 函数体都**无需改逻辑**。

- `public/gomoku.html`：`getModelWinPoints(10.4)` 由 `14` 改为 `15`。
- `public/i18n-dict.js`：中英文 `gomoku.lbHint` 由"V10Mesa / V10Flash 得 14 分，V10Exp / V10Ultra 得 15 分"改为"V10Mesa 得 14 分，V10Flash / V10Exp / V10Ultra 得 15 分"。
- `supabase-gomoku-schema.sql`：顶部注释同步为"V10Mesa 胜局 14 分；V10Flash、V10Exp 与 V10Ultra 均为 15 分"（函数体不动，仍幂等）。
- `tools/check-gomoku-page-integration.mjs`：`expectedPoints['10.4']` 由 `14` 改为 `15`。

## 二、首页代际 8 → 10

`index.html` 两处同一事实，一起改（否则自相矛盾）：
- 第 1577 行指标条 `<strong>8</strong> 代五子棋 AI` → `10`；
- 第 1594 行证明带 `<strong>8</strong> 代五子棋 AI 迭代` → `10`。

## 三、强度排序建议（V10Flash 放到 V10Exp 之前）

现有可比数据：

| 对局 | 结果 |
| --- | --- |
| V10Flash vs V10Ultra | **2:0**（Flash 黑白双胜） |
| V10Flash vs V10Exp | 1:1（双方各胜执黑局） |
| V10Exp vs V10Ultra（你的实测，与我的记录一致） | 1:1（双方各胜执黑局） |

理由：三者里只有 V10Flash 对**共同对手** V10Ultra 拿到 2:0，V10Exp 对同一对手是 1:1；而 V10Flash 与 V10Exp 直接交手 1:1，没有分出高下。用共同对手作比较，把 V10Flash 排在 V10Exp 之前是当前证据能支持的最强主张。

新顺序：`V9、V9Pro、V9Mesa、V9Thinker、V10、V10Mesa、V10Flash、V10Exp、V10Ultra`（内部数组 `[1,2,3,6,7,8,9,9.1,9.3,9.2,10,10.2,10.4,10.3,10.1]`）。

改动：`public/gomoku.html` 与 `public/gomoku-experiments.html` 的选项列表和 `MODEL_VERSIONS`；`tools/check-gomoku-page-integration.mjs` 与 `tools/check-gomoku-experiment-page.mjs` 的 `expectedOrder`；`AGENTS.md`、`MEMORY.md` 的顺序说明。

**这只是显示顺序**——三者积分现在都是 15 分，所以不影响任何计分。如果你认为该保持 V10Exp 在前，说一句我立刻改回。

## 四、为什么 V10Ultra（纯 Rapfi）打不过 metool 上的"神之一手"（也是 Rapfi）

这是分析题，不改代码。结论：**同引擎 ≠ 同配置，差距几乎全在"给引擎多少算力"**。我们这边的实测数据正好能证明：

- V10Ultra 是 `rapfi-single.wasm`，**单线程**编译版（线程数无法超过 1）；对方很可能用多线程构建。
- V10Ultra 的 `MAX_DEPTH = 12`，而且**实测每步均值只有 0.34 秒**——说明它几乎总是"撞到 12 层就停"，根本没把时间用掉。
- 我上一轮把深度上限提到 20 时，同一引擎出现 **85–120 秒**的着法：也就是说引擎**愿意**搜得远比 12 层深，是我们把它截断了。这直接说明当前配置处于"深度饥饿"状态。
- 权重也不同：我们用的是 Mix9 自由网（约 10MB）；Rapfi 还有更大档位的网络，对方可能用更强的档位。
- 对方很可能还开了开局库（Rapfi 的 `USEDATABASE`），我们没启用。

一句话：对方是"多线程 + 更深 + 可能更大网络 + 开局库"，我们是"单线程 + 12 层 + 0.34 秒/步"，属于同一引擎的不同档位。

**可验证的实验**（我可以做）：让 V10Ultra 在 `depth 12` 与 `depth 20`（或不限时间搜 30 秒）两种配置在仓库内对战，直接量化"加深到底强多少"。这样就能把"我们被打败是因为配置"从推断变成数据。

## 五、执行与验收

```bash
node --check public/i18n-dict.js && node --check public/gomoku.html 2>/dev/null
node tools/test-gomoku-training-policy.mjs
node tools/check-gomoku-page-integration.mjs    # 需 4173 静态服务器 + 9222 Chrome
node tools/check-gomoku-experiment-page.mjs     # 需 4173 + 9224
git diff --check
```

不涉及引擎/权重/先验改动，因此**不需要**重建 `v10flash/file-package.js`，也不需要重跑对局验收。