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

## 6.1 模块启动器（Ctrl/⌘ + K）

启动器是跨页面共享的个人化入口，**收藏固定置顶、最近使用紧随其后，然后才是学习与资源/AI 与游戏/社员空间/管理后台四个固定分组**（用户明确要求“收藏”置顶一个分类）。

- **数据归属账号**：登录后读写的唯一来源是 `club_launcher_items` 表（经 club-drive 的 `launcher_*` 动作），本机 `localStorage` 只作为缓存与未登录回退。两个键 `algorithm-club-launcher-favorites` / `algorithm-club-launcher-recents`（后者沿用历史键名，旧版仅存 href 的记录会在读取时归一化迁移），另有 `algorithm-club-launcher-owner` 记录缓存属于哪个账号。
- **同步策略**：登录/切换账号时以服务端返回为准覆盖缓存；本设备首次登录会把登录前攒下的访客收藏合并进账号（只补不删，`launcher_items_merge`）；退出登录清空本账号缓存，避免下一个账号继承。网络失败时保留本地结果不阻断操作。
- **存稳定条目键而非路径**：`page:<href>` / `root:<href>`。同一模块从首页与 `/public/` 页打开时 href 不同（`../index.html` vs `index.html`），路径无法复用。
- **收藏**：条目右侧星标点击切换；键盘为 `Ctrl/⌘ + Enter`（焦点始终停在搜索框，星标不进入 Tab 序列，避免打断“输入→回车打开”的主流程）。上限 24 个，数据库侧同样裁剪；收藏项不会在下方分类里重复渲染。
- **最近使用**：打开启动器条目、直接访问/刷新任一已登记页面都会记录；上限 6 个；首页不占最近位，当前页不在自身的最近列表显示（仍会保存，离开后可用）；可一键清除。
- **状态**：空收藏显示“点击条目右侧星标”引导；搜索时收藏区只显示命中项。跨标签页通过 `storage` 事件同步。
- **样式**：`.club-launcher-group` 为 flex 头（右侧可放“清除”），`.club-launcher-star` 默认淡出、悬停/当前项/已收藏时显现，触屏 `@media (hover: none)` 常显；星标用 `--club-warn` 着色，亮暗双套自动生效。守卫工具会检查该区不得引入新的 `club-*` keyframes 或硬编码主题色。

## 7. 守卫与验收

- `node tools/check-ui-tokens.mjs`：令牌真源唯一、字体栈接入、keyframes 注册表、main 骨架（FAIL）；断点/时长残留（WARN）。改动任何 club-page 页面后必须跑。
- 资产版本：改 CSS/JS 后跑 `node tools/version-static-assets.mjs`（哈希化引用同步）。
- 截图验收：亮/暗 × 1280/390（`tools/ui-shot.mjs`，需静态服务器 + Chrome 9222；**必须用全新 Chrome profile**，SW 会缓存旧资产）。
- 固定套件：`test-club-common / test-club-launcher-favorites / test-i18n-dict / test-theme-system / test-brand-mark / test-seo / test-404-page / test-error-pages / test-pwa / test-asset-versions / test-site-search`。

## 9. 弹层动效与微交互（第四轮约定）

- **弹层语言统一**：进场 `club-pop`、出场 `club-pop-out` + 遮罩 `club-fade-out`（注册表 keyframes，180/160ms）。启动器与通知面板用 `.is-closing` 态 + JS 190ms 定时隐藏（`closeLayerWithAnimation`），重开必须 `cancelLayerClose` 取消未完成的出场定时器。club-common 的确认框/撤销条走 **WAAPI**（`animateOut`）：真实浏览器播完再移除，桩环境/旧浏览器无 `element.animate` 立即回调——保持「dismiss 后节点已不在 DOM」的同步契约（test-club-common 依赖它）。assistant 面板同法。
- **注入 CSS 的 keyframes 不得用 club- 前缀**：club-common 注入样式用 `common-pop-in/common-fade-in/common-undo-in`（club-* 注册表只许 club-ui.css 定义，守卫强制）。
- **按压反馈**：所有可点元素至少具备「过渡 + :active」。顶栏四控件/导航链接组/share/transfer-cancel/event-calendar 的补全在 club-ui.css §31；排行榜翻页在 theme.css 文件尾（**theme.css 新增规则一律放文件尾**，见地雷 1）。
- **丝滑三件套**：长列表条目用 `content-visibility:auto + contain-intrinsic-size`（changelog）；tabpanel/视图切换出现时播 `club-enter 200ms`；club 页锚点平滑滚动走 `html:has(body.club-page)` 渐进增强 + `[id]{scroll-margin-top:topbar+12px}`。
- **backdrop-filter 预算**：常驻模糊 ≤12px、不加 saturate（顶栏与 chat 顶栏已降）；新增毛玻璃先问是否常驻。
- **动态列表 stagger**：fetch 后渲染的卡片/行加 `data-reveal style="--reveal-delay:Nms"`（40ms 步进、封顶 240ms；用 `Math.min(index,6)*40`）。**reveal 观察器对“启动时无静态 data-reveal 的页面”也会挂 MutationObserver（setupReveal 不再因空集提前返回）**。频繁重渲染的列表（notifications 行）不要加，避免每次更新重播动画。
- **死代码清理**：club-ui.css 的死组件段（如旧 `.club-toast-*`、`.club-skip`）删除前必须全仓 grep 确认零引用。

## 9.1 质感专项（第五轮约定）

- **display 渐变文字**：`--club-grad-text`（暗色顶部提亮 + 底部 12% accent 染色；亮色弱染色保对比度），只作用于 `body.club-page main > h1`，用 `@supports (background-clip:text)` 包裹，不支持时回退纯色。新增 h1 不要再自带 color/gradient。
- **瓦片质感层**：surface-2 瓦片（.info-list li / .club-feature-group / .member-card-block / .theme-option / .event-calendar-day / .site-search-group li）统一 `inset 0 1px 0 var(--club-highlight)`；面板级容器（table-wrap/file-list/club-admin-side/resource-card）补 `--club-grad-surface` + 高光，**但亮色 §20 用 background 简写 !important 平涂，容器组渐变必须限定 `html:not([data-theme="light"])`**（§33 现成写法）。
- **chip 基类**：`body.club-page .chip`（§34）是唯一基类；`.club-notify-filters .chip` 与 `.events-view-toggle .chip` 只保留各自的 is-active 差异。新组件用 chips 直接用基类。
- **badge 语义**：补齐 `.badge.warn/.badge.info`（亮色例外在 §20 追加行）；状态语义一律用 badge，不许页面自造彩色文字（drive 邀请状态已收敛为 badge used/off）。
- **数字列**：表格数字单元格用 `td.num` 或 `.points-value`（右对齐 + tabular-nums）；新表格数字列禁止左对齐混排。
- **小件基类**：`kbd`（键帽）、`:not(pre)>code`（行内表面）、`hr`（细线）在 §34；launcher 内两处 kbd 已再声明保持原样，改 launcher 键帽只动那两条。
- **岛对齐**：platformer 不加载 theme.css（避免全站 !important 误伤游戏组件），选区色/滚动条页内自补；chat 亮色底 `--chat-bg: var(--bg)` 跟随全站暖白；平台游戏主按钮已接 `--club-grad-primary`（其 token 副本含质感层）。
- **P0 教训**：guide.html 曾整段属性引号写成全角弯引号 `”`，半页组件裸奔——批量修 HTML 属性时只替换「前导 `=` 或后随 ASCII」的引号位，正文中文引号不动。

## 8. 已知地雷（改前必读）

1. theme.css 亮色覆盖含大量 `!important`，且尾部有「朱砂暖白 V2」段会覆盖前段 —— 新增亮色规则放 V2 段之后。
2. club-ui.css §20 亮色覆盖块必须与新质感同步（改 token 后检查该节）。
3. 词典 zh 顶层 `lab:` 段在文件中部（4 空格缩进），文件头插入同名段会被覆盖；en 词典注入含 `'` 的文案用弯引号 `’`。
4. 运行时状态行（`#statusLine`、`.status`、日志区）**不能挂 `data-i18n`**——apply() 会覆盖动态文案。
5. `file://` 下不能 fetch 本地 JSON、不能用 contentWindow.eval；共享层全部走样式注入/postMessage 兼容。
6. QA 用全新 Chrome profile；SW 缓存旧资产会造成"改动没生效"假象。
