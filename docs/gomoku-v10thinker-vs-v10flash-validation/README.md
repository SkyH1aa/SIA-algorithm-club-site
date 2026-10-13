# V10Thinker 上架验收（对 V10Flash）

V10Thinker 固定 16 层后作为**内部版本号 10.5** 上架（正式页与实验页排在最后一位，胜局 16 分）。

## 换色验收

| 对局 | 黑方 | 白方 | 胜方 | 手数 |
| --- | --- | --- | --- | --- |
| 1 | V10Thinker | V10Flash | **V10Thinker** | 37 |
| 2 | V10Flash | V10Thinker | **V10Flash** | 39 |

**1 胜 1 负，各胜自己执黑的一局。**

用时：V10Thinker 均 0.64 秒、最长 7.05 秒；V10Flash 均 0.96 秒、最长 10.74 秒。

V10Flash 的落子原因分布：开局先验 1、Rapfi+专家复核 23、必防 8、自研 VCF 必胜 4、立即连五 1、
`no-proven-safe-alternative` 1。

## 上架后与其余对手的验收（同一配置，此前已跑）

| 对手 | 结果 |
| --- | --- |
| V10Ultra（12 层） | 1:1 |
| V10Exp | 1:1 |
| V10Flash | 1:1 |

## 结论与必须说明的一点

- 三对全部 1:1，**12 局里每一局都是执黑方获胜**。这个换色协议无法区分这几个引擎
  （详见 `docs/gomoku-v10thinker-depth-validation/README.md`），因此**没有任何证据表明
  V10Thinker 是这几个里最强的**；把它排在最后一位、给 16 分是用户的排序决定，不是数据结论。
- V10Thinker 与 V10Ultra、V10Flash 共用同一份 Rapfi 引擎与 Mix9 权重字节，
  差别只在深度上限（16 层 vs 12 层）以及 V10Flash 另有的战术层、开局书与专家系统。
- 要真正排出高下，必须改用"固定开局、双方各执一次、多开局统计"的协议。

对局棋谱：`docs/gomoku-v10thinker-vs-v10flash-validation/`。
