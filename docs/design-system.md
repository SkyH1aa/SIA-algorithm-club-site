# SIA 算法社 · 设计系统 v3（2026-10 第三轮 UI 升级）

> 本文档是全站前端视觉/交互体系的唯一权威说明。第一轮改造（2026-10-25 凌晨）建立了字体与组件层；第二轮完成体系级收敛：语义 token、动效令牌、断点阶梯、排版阶梯、页面收编与守卫工具；第三轮把体系内完成度拉满：模板组件上收、交互四态补全、骨架屏、chat 岛等值对齐。

## 1. 体系分层与页面接入

| 层级 | 页面 | 约定 |
|---|---|---|
| T1 完全接入 | member×7 / admin×6 / 内容文档×9 / 错误页×3 / chat-admin | `body.club-page` + 全部共享层，页内零硬编码主题色 |
| T2 游戏页 | gomoku / gomoku-experiments / tetris / snake | `body.club-page` + 页内保留棋局可视化与 `main` 重置覆写（统一模式：`body.club-page main.<本页类> { max-width:none; margin:0; padding:10px; z-index:auto }`） |
| T3 实验室（已收编） | search / sorting / visualization / dp / ds / graph / heap / tree / satori-lab / appmonitor | `body.club-page` + 仅保留实验室可视化专有样式与 lab 专用显示色 |
| T4 豁免体系 | index.html / chat / assistant / platformer | 自成体系，不强制接入；改动需单独评估 |

**新页面接入清单**：`<body class="club-page">` → 标准顶栏（`.topbar > .topbar-inner`，内含 `.brand`、`a.back`、`.topbar-actions`）→ `<main>` → 不写页内 `:root` 主题映射 → 顶栏切换器/站点导航/页脚由 `club-shell.js` 自动注入。

## 2. 令牌（public/club-ui.css §1，唯一真源）

**颜色**：`--club-bg/surface/surface-2/surface-3`、`--club-text/text-soft/muted`、`--club-accent(-strong/-soft/-line)/on-accent`、语义色 `--club-ok/warn/danger/info(+soft)`、质感 `--club-highlight(-strong)/grad-surface/grad-primary/glow-accent`。全部亮暗双套，禁止在页面重定义。

**排版**：字号 7 档 `--club-fs-xs(11) / -sm(12.5) / -md(13.5) / -base(15) / -lg(17) / -xl(21) / -display(clamp 28–44)`；行高 `--club-lh-tight(1.25) / -body(1.65)`。数据大数字（统计卡 23–30px）不设档，随组件；**标签类小字（th/徽章/统计说明/时间戳）一律 `var(--club-fs-xs)`，不存在 11.5px 半档**。中文标题不加负字距（MiSans 汉字方字面，含 club-ui 自身 h1 与首页大标题）；标题统一 `text-wrap: balance`、正文 `text-wrap: pretty`。

**间距**：`--club-space-1..8` = 4/8/12/16/20/28/40/64px。

**圆角**：`--club-radius-xs(6) / -sm(9) / -md(12) / -(14) / -pill(999)`。≤8px 的微元素（kbd/角标）允许字面值。

**阴影**：`--club-shadow-xs/sm/-/hover`。

**动效**：时长 3 档 `--club-dur-fast(140ms) / -dur(200ms) / -dur-slow(320ms)` + `--club-ease(cubic-bezier(0.22,1,0.36,1))`。transition 一律写 `var(--club-dur*, 200ms) var(--club-ease, ease)`（带 fallback，非 club-page 环境可降级）。循环动画（spin/shimmer/infinite）不受此约束。

**布局**：`--club-max(1240) / -narrow(720) / -read(760) / -topbar(62) / -gap(18)`。

**z-index 阶梯**：`--club-z-sticky(40) < -nav(60) < -overlay(900) < -modal(1200) < -toast(1400) < -skip(2000)`，新增弹层必须取自阶梯。

**断点阶梯（唯一允许的 5 档）**：`420 / 640 / 720 / 900 / 1100`（max-width；min-width 用 +1 补集）。历史断点（560/620/760/820/860/1080…）已归一，新增媒体查询必须取自阶梯。

## 3. 动效体系

- **keyframes 注册表**（只允许 club-ui.css 定义 `club-*` 动画）：`club-spin`、`club-shimmer`、`club-pop`、`club-enter`、`club-num-pulse`。页面私有动画保留在页内，但**不得以 `club-` 开头**（守卫工具强制）。
- **进场**：`body.club-page main > *` 自动 320ms 上浮淡入 + 阶梯延迟（§30）。
- **滚动 reveal**：元素加 `data-reveal`（可选 `style="--reveal-delay:80ms"`），`club-shell.js` 的 ClubReveal 用 IntersectionObserver 触发 `.is-revealed`；只在 `html.club-reveal-ready`（JS 成功启动）后才隐藏元素，无 JS/减少动效时始终可见。
- **页面切换**：`@view-transition { navigation: auto }` 渐进增强（Chrome/Edge 交叉淡入，其余浏览器无感）。
- **数据微动效**：数值更新后对元素 `add('club-num-pulse')`，600ms 高亮脉冲；配合全局 `tabular-nums`。
- **reduced-motion**：全局兜底在 club-ui.css §31（html 作用域），覆盖实验室/游戏/首页等所有页面；新增动画无需各自写兜底。

## 4. 排版模板

- **长文**：`<div class="club-prose">`（guide / changelog / 说明区）——68ch 阅读宽度、1.78 行高、标题/引用/分隔线节奏。更新日志时间轴已收成 `--club-read`（760px）阅读列并逐条挂 club-prose。
- **数据表**：`.table-wrap` 包裹 + 全局 `tabular-nums`（td/th 均生效）；ID/哈希/版本号用 `.club-mono`；长备注列用 `.cell-desc`（club-ui 唯一真源：muted + fs-sm + 280px 限宽 + anywhere 换行）。
- **空态/骨架/toast/确认框**：`ClubCommon.listState / .club-skeleton(-rows) / ClubCommon.toast / ClubCommon.confirm`（club-common.js），不得再造第二套。**列表初始加载用 `.club-skeleton-rows`（配 `club-sr-only` 保留读屏/i18n 加载文案）；运行中状态仍用 listState**。
- **标题语义**：每页恰好一个 `<h1>`，且必须位于 `<main>` 顶层（眉题 eyebrow + h1 + 导语 lead 的全站节奏）；门禁/遮罩/卡片内用 `<h2>`；chat/assistant 用 `.chat-sr-only` h1。
- **数值变化**：数字更新后调用 `ClubCommon.pulse(el)` 触发 600ms 高亮脉冲（积分商城余额已接入）。

## 4.5 第三轮新增约定（2026-10-25）

- **上收组件（页面不得再写本地副本）**：`.gate-icon`（门禁锁形图标，曾在 16 页复制）、`.list-toolbar` + `.list-toolbar .input`（列表工具栏）、`.cell-desc`（表格备注列）。守卫会盯 :root 真源，但这些类名也应直接用共享版本。
- **交互四态矩阵**：全部按钮变体（主/次/危险/ghost/行内）、chips（events-view-toggle / club-notify-filters）、tabs、输入控件均具备 hover / active 按压 / focus-visible / disabled 四态；亮色 §20 覆盖块同步携带（禁用态、悬停均带 `:not(:disabled)` 守卫）。新增可点元素必须四态齐备。
- **胶囊控件行高**：所有 pill 形控件（chips / tabs / 导航胶囊 / 页头胶囊链接）必须显式 `line-height: 1.1`。继承 body 的 1.65 行高会被 CJK 字体的行盒伸展撑歪——flex 居中的是行盒而非字形，表现为文字贴胶囊下缘。
- **chat 岛等值同步**：chat.css / assistant-launcher.css / chat-admin.css 不挂 club-page（结构性风险），但其变量与 club 令牌**逐值同步**（语义色/线/文本/缓动/阴影，亮暗两套）。**改 club 令牌值时必须同步这三处**；launcher 因为注入到非 club 页面，自带令牌副本而非引用 `--club-*`。
- **首页动效令牌**：index.html 自有 `--dur-fast/--dur/--dur-slow/--ease`（值与 club 相同），内联过渡一律用令牌；首页排版（含中文标题零负字距）同样受本体系约束，但 3D 背景与翻页交互豁免。

## 5. 顶栏三形态（沿用第一轮约定）

1. **次级文档页**：`.topbar > .topbar-inner`，右侧 `.topbar-actions` 由 shell 归拢（返回/语言/主题/启动器/通知铃）。
2. **flex 顶栏**（游戏/实验室画布页若保留自绘头）：切换器必须 `position: static` 行尾（`.club-topbar-utils-inline`）。
3. **block 页头**（gomoku）：才允许 `.club-topbar-utils-float` 绝对定位。

## 6. 共享页脚

`club-shell.js` 把 `.club-footer` **追加到 body 末尾**（绝不插入 main 的父节点——游戏页的 main 包在 `.layout` 布局容器里，插进去会挤歪排行榜）。`body.club-page` 是 flex 列 + `.club-footer { margin-top: auto }` 粘性页脚：内容短（登录拦截页）时钉在视口底部，内容长或面板展开时自然跟在最后。游戏页的全屏 shell（100dvh）之下页脚在折叠线外，滚动可见、永不重叠。豁免页与已有自有页脚的页面不注入（`body > footer:not(.club-footer)` 检测）。打印时隐藏。

## 7. 守卫与验收

- `node tools/check-ui-tokens.mjs`：令牌真源唯一、字体栈接入、keyframes 注册表、main 骨架（FAIL）；断点/时长残留（WARN）。改动任何 club-page 页面后必须跑。
- 资产版本：改 CSS/JS 后跑 `node tools/version-static-assets.mjs`（哈希化引用同步）。
- 截图验收：亮/暗 × 1280/390（`tools/ui-shot.mjs`，需静态服务器 + Chrome 9222；**必须用全新 Chrome profile**，SW 会缓存旧资产）。
- 固定套件：`test-club-common / test-i18n-dict / test-theme-system / test-brand-mark / test-seo / test-404-page / test-error-pages / test-pwa / test-asset-versions / test-site-search`。

## 8. 已知地雷（改前必读）

1. theme.css 亮色覆盖含大量 `!important`，且尾部有「朱砂暖白 V2」段会覆盖前段 —— 新增亮色规则放 V2 段之后。
2. club-ui.css §20 亮色覆盖块必须与新质感同步（改 token 后检查该节）。
3. 词典 zh 顶层 `lab:` 段在文件中部（4 空格缩进），文件头插入同名段会被覆盖；en 词典注入含 `'` 的文案用弯引号 `’`。
4. 运行时状态行（`#statusLine`、`.status`、日志区）**不能挂 `data-i18n`**——apply() 会覆盖动态文案。
5. `file://` 下不能 fetch 本地 JSON、不能用 contentWindow.eval；共享层全部走样式注入/postMessage 兼容。
6. QA 用全新 Chrome profile；SW 缓存旧资产会造成"改动没生效"假象。
