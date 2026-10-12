# 老J 击败 V10Ultra 的棋谱，换成 V10Flash 回放

## 来由

`五子棋训练数据1014/gomoku-20261011121404834-5ea23e88-c0a2-4b8b-b7b4-29e01d2ae80a.json`
是真人玩家 **老J**（执黑）在 2026-10-11 击败 **V10Ultra**（执白）的完整记录：AI 结果记为 `loss`，
31 手，老J 在第 9 列连五（0,9–4,9）取胜。

本测试用同一局棋谱，把 AI 一方从 V10Ultra 换成 V10Flash，**执子颜色不变**（老J 仍执黑，AI 仍执白）。

## 方法

- 老J 的走法按记录逐手重放（脚本一方），V10Flash 用真实 Chrome Worker 实时应对。
- 15×15 自由棋，无禁手，黑先白后，五连及长连均胜；空盘开始。
- V10Flash 上限 90 秒 / 16 层。
- 回放后逐步重放校验（合法性、颜色交替、终局一致），并复核资源 SHA256。

```bash
node tools/run-gomoku-human-line.mjs v10flash \
  五子棋训练数据1014/gomoku-20261011121404834-5ea23e88-c0a2-4b8b-b7b4-29e01d2ae80a.json \
  docs/gomoku-v10flash-human-line-validation/laoj-beats-v10ultra-replayed-by-v10flash.json
```

## 结果

| | V10Ultra（原局） | V10Flash（本测试） |
| --- | --- | --- |
| 执白第一手 | 5,4 | **6,6** |
| 结果 | 老J 胜，31 手 | **V10Flash 胜，12 手** |

V10Flash 的第一次应对就与原局不同（6,6 而不是 5,4），此后一路沿 6 行发展，
第 12 手在 6 行连五（6,4–6,8）取胜，其间只有最后一手是引擎的立即连五，其余都是搜索落点。
V10Flash 共 6 次应对，均 2.58 秒，最大 10.99 秒。

## 这说明了什么，没说明什么

**说明的**：V10Flash 不会复制 V10Ultra 在这局里的失败路径。它在第一手就换了落点，
没有走进让 V10Ultra 输掉的那条线。

**没说明的**（重要）：从第一手偏离之后，老J 记录下来的后续走法原本是针对 V10Ultra 那条线下的，
换到 V10Flash 的线路上就不再是合理的应对。所以第 3 手以后"老J 一方"实际上是在盲下，
12 手速胜**不能算作棋力证据**，只能算这条特定线路上的回归检查。要判断棋力必须看
双方都能实时应对的换色对局（见 `docs/gomoku-v10flash-vs-*-validation/`）。

**一个细节**：这次偏离不是开局书造成的。该局面下开局书是沉默的——先验里白棋 5,4 这个点只有
2 局记录，低于 4 局的取材门槛，其它候选点没有数据，因此 `reason` 一直是 `rapfi-mix9-flash`。
差异来自 V10Flash 自身的搜索预算更大（16 层 / 90 秒，V10Ultra 为 12 层 / 75 秒）。

## 产物

- `laoj-beats-v10ultra-replayed-by-v10flash.json`：完整回放棋谱（含每步用时、引擎报告、资源 SHA256）。
- `laoj-beats-v10ultra-replayed-by-v10flash.summary.json`：与原局的逐步对照与差异点。
