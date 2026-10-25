# 前端体验整体升级计划 · 第二轮（2026-10-25 诊断）

> **状态：已全量实施（2026-10-25）。** 四批次全部落地；验收记录见 docs/ui-shots-round2/，体系约定以 docs/design-system.md 为准。

> 定位：2026-10-25 已完成第一轮 P0–P5 全量改造（62 文件：自托管字体、`--club-*` token 组件层、质感层、toast/骨架屏/空态、进场动效）。本计划建立在其之上，主题从「组件级统一」推进到「体系级收敛」：token 化剩余硬编码、消灭多真源、建立排版/动效/断点尺度、把半接入页面收编进共享体系。
> 约束：只动前端视觉/交互层，不碰引擎、模型、训练数据、SQL、业务逻辑；`file://` 必须可用；i18n 动态文案走 `refreshXxx + club:langchange` 约定。

---

## 一、诊断结论（本轮实测数据）

### 1.1 页面接入分层（45 页）

| 层级 | 页面数 | 范围 | 状态 |
|---|---|---|---|
| T1 完全接入 | 26 | member×7 / admin×6 / 内容文档×9 / 错误页×3 / chat-admin | 高度一致，页内 0 硬编码 hex |
| T2 游戏页 | 4 | gomoku、gomoku-experiments、tetris、snake | `club-page` 在，但页内推翻 main 版式与亮色，自绘 panel/按钮 |
| T3 半接入 | 10 | 8 个 lab（ds/dp/graph/heap/tree/search/sorting/visualization）+ satori-lab + appmonitor | 自绘顶栏、旧变量映射（`--cyan/--panel`）、页内 `:root` 镜像全套 `--club-*`，每页 40–80 处硬编码 hex |
| T4 孤岛 | 5 | index、platformer、chat、assistant、（chat-admin 外置 CSS） | index 1732 行内联且缺 club-common；platformer 缺 theme.css/Shell/i18n 最游离；chat 体系 47 个自建变量 |

### 1.2 量化债务（grep 实测）

- **排版**：27 种离散字号（9.5–30px，0.5px 粒度混用，12px×177/13px×121）；无任何字号/行高/间距 token；13 种硬编码圆角约 110 处（radius token 覆盖率约 35%）；12 个页面字体栈未接 token（4 个根目录中文游戏页 + 9 个 lab/tool 页 + platformer）。
- **动效**：12+ 种过渡时长（200ms×43、0.16s×58、0.15s×14…）；token 采纳率仅约 25%（20 处用 `--club-ease/cubic-bezier` vs 34+ 处裸 `ease`）；16 个 `@keyframes` 中 `algoProfileIn`×6、`grid-shift`×5、`drift-orb`×5、`club-shimmer`×2 跨文件重复；无页面切换过渡、无共享滚动 reveal。
- **布局**：25 种断点（含 720/721、760/761、600/601 三胞胎）；容器 max-width 30 种；`--club-max` 仅 3 处引用；无共享页脚；表格两套体系（`.table-wrap` vs `.chat-admin-table`）。
- **架构**：theme.css 528 处 `!important`（亮色"类名修补"层）+ club-ui.css 111 处；17 个页面各带本地 `html[data-theme="light"]` 覆写块；`--club-*` 存在 3 处真源（club-ui.css、appmonitor.html:20、platformer.html:39）。
- **信息层级**：notifications:48,56 / member-profile:48,65 / member-center:54,126 双 h1；assistant/chat 无 h1；中文排版细节全站 0 处（无 `text-wrap:pretty/balance`、无正文阅读宽度约束，标题负字距对中文有挤压风险）。
- **健康面**（保持）：字体资产与 font-display 已到位；42/42 页有 `<main>`；顶栏注入一致性约 90%；tabular-nums、焦点环、reduced-motion（club-page 作用域）、skip-link 已铺。

---

## 二、五个维度的优化方向

1. **视觉语言**：token 从「组件层」补全到「语义层」——字号/行高/间距/阴影/z-index 阶梯；亮色从「528 处类名修补」演进为「token 驱动」，消灭 3 处 token 真源与 17 页本地亮色块。
2. **布局体系**：断点收敛为 4 档（420/640/900/1100），容器收敛为 3 档（720/760/1240）；10 个半接入页统一骨架（Shell 顶栏 + main 容器 + 共享页脚）。
3. **交互动效**：已有动效 token 全量采纳（3 档时长 + 1 缓动）；keyframes 集中注册；共享滚动 reveal（IntersectionObserver）；View Transitions 渐进增强的页面过渡；数据变化微动效。
4. **组件一致性**：门禁四写法→一写法；表格两套→一套；游戏页 main 覆盖统一；加载态统一走 `ClubCommon.listState`；面板/按钮消除页内重定义。
5. **信息层级**：字号 7 档阶梯落地；h1 语义修复；中文排版细节（`text-wrap:pretty`、正文 65ch、标题字距修正）；长文 `.club-prose` 模板；数据表格数字排版。

---

## 三、分阶段实施

### 阶段 0 · 诊断（已完成）
本轮产出：45 页接入分层、量化债务清单、行号级证据（见上文与探索记录）。后续无需重新审查。

### 阶段 1 · 设计系统与布局体系（第一批，纯加法低风险起步）

**S1.1 token 语义层补全（club-ui.css，纯新增）**
- 字号：`--club-fs-xs:11px / -sm:12.5px / -md:13.5px / -base:15px / -lg:17px / -xl:21px / -display:clamp(30px,4.2vw,44px)`，映射现有高频值；行高 `--club-lh-tight:1.25 / -body:1.65`。
- 间距：`--club-space-1..8`（4/8/12/16/20/28/40/64px）。
- 阴影补 `--club-shadow-xs`；z-index 阶梯 `--club-z-sticky:40 / -nav:60 / -overlay:900 / -modal:1200 / -toast:1400 / -skip:2000`。
- 圆角决策一次到位：10px→`--club-radius-sm`、12px→`--club-radius`（或新增 `-md:12px`），grep 清单驱动全站替换。

**S1.2 断点与容器收敛**
- 断点定 4 档：420 / 640 / 900 / 1100（例外保留 `hover:none`、`prefers-reduced-motion`、`print`）；消灭 720/721、760/761、600/601 三胞胎与 767/761/721 孤值。
- 容器：`--club-narrow:720px / --club-read:760px / --club-wide:1240px`；各页 main 逐一对齐（lab 页已写 1240，成本最低）。

**S1.3 多真源消灭**
- appmonitor.html:20-22 与 platformer.html:38-41 的 `:root` 镜像改为引用共享层（挂 `club-page` 或仅保留页内特有变量）。
- 17 页本地亮色覆写块：随 S1.4 收编逐页删除；theme.css 新规则今后只允许写 token（写入 S4 守卫）。

**S1.4 T3 半接入页收编（最大风险项，逐页进行）**
- 8 个 lab + satori-lab + appmonitor：挂 `body.club-page`；删除页内 `--cyan/--panel` 旧映射（club-ui.css:1897-1909 已有兼容映射层，收编后自动获得）；自绘顶栏换 Shell 顶栏（严守三种顶栏形态约定：flex 顶栏切换器必须 `position:static` 行尾）；删除本地亮色块；画布/可视化专有样式保留。
- 顺序：search-lab（33 行最小）→ sorting/visualization → dp → ds/graph/heap/tree（500+ 行）→ satori-lab（需重跑 `node tools/check-gomoku-satori-lab.mjs`，注意该检查器在 main 上已知失败需先解决）→ appmonitor。
- 每页验收：亮/暗 × 1280/390 截图 + 现有 test-* 套件。

**S1.5 组件名实归一**
- 门禁：`.member-gate` 为 canonical（`.gate/.denied` 别名保留），platformer `.auth-gate`、chat `.chat-gate-panel` 二期专项。
- 表格：`.chat-admin-table` 并入 `.table-wrap` 体系或明确豁免。
- 游戏页 4 种 main 覆盖写法统一为一种模式；`game-loading`/自绘 loading → `ClubCommon.listState`。
- index.html 补加载 club-common.js（纯加法）。

### 阶段 2 · 动效体系

- **S2.1 token 采纳**：全站 transition 时长/缓动替换为 `var(--club-dur-fast/dur/slow) var(--club-ease)`；12 种时长收敛为 140/200/320ms 三档（循环类 spin/shimmer 除外）。grep 驱动，机械替换。
- **S2.2 keyframes 注册表**：club-ui.css 集中定义 `club-spin/shimmer/pop/enter` + 新增 `club-fade-up/down`；`algoProfileIn`×6、`grid-shift`×5、`drift-orb`×5 收敛为 lab 专用段或并入注册表。
- **S2.3 共享滚动 reveal**：club-shell.js 提供 `ClubReveal`（IntersectionObserver + `data-reveal` 属性 + 自动 reduced-motion 兜底），用于首页 section、changelog 时间线、lab 档案面板。
- **S2.4 页面过渡**：`@view-transition { navigation: auto; }` 渐进增强（Chrome/Edge 生效，其余浏览器无感），零 JS 成本。
- **S2.5 数据微动效**：数字变更闪烁（`.club-num-flash`）、进度条/用量条已有 transition 复核、倒计时统一样式。
- **S2.6 reduced-motion 全局化**：兜底规则从 `body.club-page` 作用域扩展到 `html` 作用域，覆盖 lab/game/chat 孤岛与 index。

### 阶段 3 · 排版模板与信息层级

- **S3.1 字号阶梯落地**：club-ui.css 内部 181 处 font-size 先收敛到 7 档；HTML 内联按 S1.4 收编进度逐页替换（grep 清单驱动）。
- **S3.2 语义 h1 修复**：notifications/member-profile/member-center 双 h1 降级；chat/assistant 补 `.club-sr-only` h1。
- **S3.3 中文排版细节**：标题负字距仅限西文（中文标题 0～0.01em）；`text-wrap: pretty`（标题）/`balance` 渐进增强；正文基准 15px/1.65 token 化。
- **S3.4 长文模板 `.club-prose`**：标题层级 + 65ch 阅读宽度 + 引用/代码块样式，guide/changelog/donations 说明区接入。
- **S3.5 共享页脚**：club-shell.js 注入（品牌 + 快速链接 + i18n），T1–T3 页一次到位；index 保留自有页脚。
- **S3.6 数据排版**：`td` 全局 tabular-nums（当前仅 th，club-ui.css:2921）；ID/hash 列等宽工具类。

### 阶段 4 · 验证与迭代

- **S4.1 守卫工具 `tools/check-ui-tokens.mjs`**：断言 club-page 页面新增代码无硬编码 hex、无断点外 @media 值、无字体栈硬编码；写入 AGENTS.md 变更后检查清单。
- **S4.2 全站基线截图**：tools/ui-shot.mjs 扩展为 ~45 页 × 亮/暗 × 1280/390 矩阵，产出到 `docs/ui-baseline/`，改动前后 diff（注意：必须用全新 Chrome profile 防 SW 旧缓存）。
- **S4.3 固定验收流程**：`node --check` + `git diff --check` + `node tools/test-{club-common,i18n-dict,theme-system,brand-mark,seo,404,error-pages,...}.mjs` + gomoku 页改动跑 `check-gomoku-page-integration` + satori-lab 改动跑 `check-gomoku-satori-lab`。
- **S4.4 设计系统文档 `docs/design-system.md`**：token 表、组件清单、T1–T4 接入层级与豁免清单（chat/assistant/index）、新页面接入指引。
- **S4.5 迭代节奏**：每阶段独立提交 + changelog 条目 + SW VERSION bump；改 token 后必查 club-ui.css 第 20 节亮色覆盖块同步。

---

## 四、排期与风险

| 批次 | 内容 | 风险 | 估时 |
|---|---|---|---|
| ① | S1.1 + S1.2 + S2.1（token 补全、断点归一、时长采纳） | 低（纯加法/机械替换） | 1 个窗口 |
| ② | S1.3 + S1.4（真源消灭、lab 页收编） | 中高（theme.css !important 交互、亮色回归） | 2–3 个窗口 |
| ③ | S2.2–S2.6 + S3（动效体系、排版模板） | 中（i18n 键、reduced-motion 覆盖） | 1–2 个窗口 |
| ④ | S4（守卫、基线、文档） | 低 | 1 个窗口 |

**二期专项（本轮明确豁免）**：chat/assistant 独立体系收敛（47 个自建变量，需专项设计不破坏聊天 UX）；platformer 一次性收编（缺层最多但页面独立）；index.html 深度收敛（用户约束保留 3D 背景与翻页动画，仅做字体/排版/Common 接入微调）；4 个根目录中文孤儿游戏页已 noindex，不投入。

**已知地雷**（实施时必读）：① theme.css 528 处 `!important` 与页面本地亮色块的优先级博弈，改前先在目标页跑亮暗截图；② 词典 zh 顶层 `lab:` 段在文件中部（4 空格缩进），插入同名段会被覆盖；③ 运行时状态行（`#statusLine` 等）绝不能挂 `data-i18n`；④ QA 用全新 Chrome profile；⑤ View Transitions 与 sticky 顶栏需实测避免闪跳。
