# V10Flash 三层融合（Rapfi + 自研战术层 + 专家系统）验收

## 本次改了什么

把 V10Exp 的"专家战术系统"按同样架构融合进 V10Flash，最终形态是 **Rapfi + 自研战术层 + 专家系统**：

| 层 | 内容 | 来源 |
| --- | --- | --- |
| Rapfi Mix9 自由网 | 90→120 秒单步预算、16 层上限 | 复用与 V10Ultra **相同字节**的引擎与权重 |
| 自研战术层 | 威胁识别（活四/冲四/活三）+ 精确 VCF 连续冲四必胜 | 本项目代码（`public/gomoku-models/v10flash.js`） |
| 专家系统 | V9Thinker 与 V10 两个专家并行搜索 + 独立 VCF 证明器 | 冻结的专家源码，只读复用 |

**与 V10Exp 同构，但完全独立**：V10Flash 使用自己生成的证明核心
（`v10flash/proof-core.js`，工厂名 `createGomokuFlashProofExpert`），
**绝不复用 V10Exp 的 `proof-core.js`，也不共享其离线包**；冻结原核心只读不改。

### 决策顺序

1. 立即连五（`immediate-win`）
2. 自研 VCF 必胜（`vcf-win`，直接落子并跳过引擎与专家）
3. 必防对手立即连五（`forced-block`）
4. 并行启动两个专家与 Rapfi
5. 专家已证明必胜 → 直接采用（`expert-proved-win`）
6. 开局先验可覆盖 Rapfi 落点（`opening-book`，仅前四手）
7. 用独立证明器复核所选落点；被证明为强制败招时改查专家备选（`expert-rejected-forced-loss`）
8. 其余记为 `mix9-expert-checked` 或 `no-proven-safe-alternative`

专家层只做两件有证明依据的事：已证明的必胜提前终止、被证明为强制败招时改查专家备选。
**不平均不可比评分，不声称重新训练或混合权重。**

### 产物

- `node tools/build-gomoku-v10flash.mjs` 生成 `v10flash/proof-core.js` 与含 Rapfi 桥接、
  冻结专家源码、训练先验、证明核心的 `v10flash/file-package.js`（14.38 MiB，供 `file://`）。
- 旧的 `build-gomoku-v10flash-file-package.mjs` 已被其取代并删除。
- 离线包与 HTTP 的引擎/权重字节一致、专家源码等于冻结原文件、证明核心不含 V10Exp 工厂名，
  均由 `node tools/test-gomoku-training-policy.mjs` 校验。

## 验收结果

| 对局 | 黑方 | 白方 | 胜方 | 手数 |
| --- | --- | --- | --- | --- |
| vs V10Ultra | V10Flash | V10Ultra | **V10Flash** | 21 |
| vs V10Ultra | V10Ultra | V10Flash | **V10Flash** | 66 |
| vs V10Exp | V10Flash | V10Exp | **V10Flash** | 53 |
| vs V10Exp | V10Exp | V10Flash | **V10Exp** | 43 |

- **对 V10Ultra：2 胜 0 负**（与融合前一致）。
- **对 V10Exp：1 胜 1 负**（与融合前一致，两局仍都是执黑方获胜）。

用时：对 V10Ultra 均 1.80 秒、最大 10.46 秒；对 V10Exp 均 1.15 秒、最大 11.35 秒。
速度与融合前持平。

## 专家层实际起了多大作用（重要）

| 落子原因 | vs V10Ultra | vs V10Exp |
| --- | --- | --- |
| `mix9-expert-checked`（Rapfi 落点通过证明器复核） | 27 | 31 |
| `vcf-win`（自研战术层证明必胜） | 5 | 5 |
| `forced-block` / `immediate-win` | 9 / 2 | 9 / 1 |
| `opening-book` | 1 | 1 |
| `no-proven-safe-alternative`（Rapfi 落点被证明是强制败招，但专家备选也无一安全） | 0 | **1** |
| `expert-proved-win`（专家证明必胜并提前终止） | 0 | 0 |
| `expert-rejected-forced-loss`（因 Rapfi 落点被证明败招而改用专家备选） | 0 | 0 |

三个结论：

1. **专家系统确实在运行**：两个专家（V9Thinker、V10）每一步都并行搜索并给出观测，
   独立证明器每一步都在复核 Rapfi 的落点（`mix9-expert-checked` 合计 58 手）。
2. **它抓到过一次真实问题**：vs V10Exp 有 1 手 Rapfi 的落点被证明是强制败招，
   专家备选也都没能通过复核，于是保留 Rapfi 落点并如实记为 `no-proven-safe-alternative`。
   也就是说这一手之前是"没有任何预警"的，现在至少被标记出来了。
3. **但它没有带来这场对局的胜率提升**：0 次专家必胜提前终止、0 次因败招改用专家备选，
   最终胜负与融合前完全相同。一个合理解释是：**自研战术层已经先一步吃掉了同一类必胜**
   （两对各有 5 手 `vcf-win`），而 V10Exp 没有这一层，所以它的专家层承担了更多工作
   （同一批对局中 V10Exp 自己出现 6 次 `expert-proved-win`、1 次 `expert-rejected-forced-loss`）。
   两者不是等价对比（引擎不同、棋路不同），但方向一致。

## 结论与局限

- 融合**没有降低棋力**（2:0 / 1:1 与融合前逐手一致），速度持平，且新增了一层
  "证明式"安全网：被证明是强制败招的引擎落点现在会被发现并尝试替换。
- **也没有提高对 V10Exp 的胜率**，仍是 1:1。单组空盘换色不构成 Elo 结论；
  要证明 V10Flash 强于 V10Exp，需要多开局、多局配对（黑白均 >50% 且统计下界 >50%）。
- 专家层在本组对局中未触发提前终止，不代表它在别的局面无用——它只在"专家能证明必胜"
  或"Rapfi 落点被证明败招"时才发言，本组没走到那样的分支。

对局棋谱：`docs/gomoku-v10flash-vs-v10ultra-v3-validation/`、`docs/gomoku-v10flash-vs-v10exp-v3-validation/`。
