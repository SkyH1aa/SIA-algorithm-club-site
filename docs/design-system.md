# SIA 算法社 · 设计系统（2026-11 前端体验升级）

> 本文档是全站前端视觉/交互体系的唯一权威说明；当前约定以 [§9.5「Precision Gallery 当前约定」](#95-precision-gallery-当前约定) 为准，实际共享令牌与组件样式以 [`public/club-ui.css`](../public/club-ui.css) 为唯一代码真源；首页以 [`public/home-showcase.css`](../public/home-showcase.css) 的末尾覆盖为准，独立界面保留各自作用域。根目录 [`DESIGN.md`](../DESIGN.md) 与 [`.impeccable/design.json`](../.impeccable/design.json) 是从当前实现提取的描述性快照与预览扩展，供工具读取，不构成第二套可独立修改的规范；源文档或 CSS 变更后应成对刷新快照。

**当前方向与历史阅读方式**：用户已批准本轮 Precision Gallery「算法精密展馆」。品牌与既有数学场景位于首屏上部，原介绍和 CTA 由内容网格背后的金属功能台承托；不再使用全宽统一玻璃 Hero。普通阅读、工作面板与入口采用不透明金属，登录外壳、精选展品与浮动 chrome 才使用局部玻璃。默认冷暗、亮色暖中性，现有字体与业务不变。方向见 [`precision direction.md`](precision-gallery-2026-11/direction.md)。§9.2、§9.3、§9.4 与第一至第五轮均为历史追溯；冲突的构图、颜色与材质以 §9.5 和当前 CSS 为准，不恢复旧限制。

**字体与入场的当前口径**：保留自托管 `Inter Variable`（西文/数字）、`MiSans VF`（中文）与 `JetBrains Mono`（代码/标识），共享字体栈见 CSS 的 `--club-font` / `--club-mono`，字体声明见 [`club-fonts.css`](../public/assets/fonts/club-fonts.css) 与其同目录的 MiSans 资源；不将系统回退字体描述为主字体。`data-club-surface="operate"` 不自动播放整页阶梯入场，其他共享页面仍保留 `club-enter`；局部状态反馈、标签面板切换与首页章节时间线分别保留各自边界。减少动态效果时内容必须直接可读，首页历史曲线不声称全部统一为共享缓动。

**记录边界**：本次按已批准的刷新/合并范围，只维护本说明、根 DESIGN.md 与侧车；从当前 `club-ui.css` §1/§35 和 `home-showcase.css` 末尾级联提取，不修改代码、更新日志、coverage 或验收文件。未重跑浏览器、真实账号、实机或持续性能测试。最终证据由主任务写入 [`precision-gallery-2026-11/acceptance.md`](precision-gallery-2026-11/acceptance.md)；该路径是验收归属，不代表记录已经写入或本轮已经通过。旧轮次计数与性能不自动继承。

## 1. 体系分层与页面接入

| 层级 | 页面 | 约定 |
|---|---|---|
| T1 完全接入 | member×7 / admin×6 / 内容文档×9 / 错误页×3 / chat-admin | `body.club-page` + 全部共享层，页内零硬编码主题色 |
| T2 游戏页 | gomoku / gomoku-experiments / tetris / snake | `body.club-page` + 页内保留棋局可视化与 `main` 重置覆写（统一模式：`body.club-page main.<本页类> { max-width:none; margin:0; padding:10px; z-index:auto }`） |
| T3 实验室（已收编） | search / sorting / visualization / dp / ds / graph / heap / tree / satori-lab / appmonitor | `body.club-page` + 仅保留实验室可视化专有样式与 lab 专用显示色 |
| T4 豁免体系 | index.html / chat / assistant / platformer | 自成体系，不强制接入；改动需单独评估 |

**新页面接入清单**：`<body class="club-page">` → 标准顶栏（`.topbar > .topbar-inner`，内含 `.brand`、`a.back`、`.topbar-actions`）→ `<main>` → 不写页内 `:root` 主题映射 → 顶栏切换器/站点导航/页脚由 `club-shell.js` 自动注入。

## 2. 令牌（public/club-ui.css §1，唯一真源）

**颜色**：`--club-metal-read/panel/raised/inset/control/hover` 与 material 别名、选择性玻璃 `--club-liquid-*`，以及 `--club-bg/surface/surface-2/surface-3`、`--club-text/text-soft/muted`、`--club-accent(-strong/-soft/-line)/on-accent`、语义色 `--club-ok/warn/danger/info(+soft)`、质感 `--club-highlight(-strong)/grad-surface/grad-primary/glow-accent`。全部亮暗双套，禁止在页面重定义。

**排版**：字号 7 档 `--club-fs-xs(12) / -sm(13) / -md(14) / -base(15) / -lg(17) / -xl(21) / -display(clamp 28–44)`；行高 `--club-lh-tight(1.25) / -body(1.65)`。数据大数字（统计卡 23–30px）不设档，随组件；**标签类小字（th/徽章/统计说明/时间戳）一律 `var(--club-fs-xs)`，不存在 11.5px 半档**。中文标题不加负字距（MiSans 汉字方字面，含 club-ui 自身 h1 与首页大标题）；标题统一 `text-wrap: balance`、正文 `text-wrap: pretty`。

**间距**：`--club-space-1..8` = 4/8/12/16/20/28/40/64px。

**圆角**：`--club-radius-xs(6) / -sm(9) / -md(12) / -(14) / -pill(999)`。≤8px 的微元素（kbd/角标）允许字面值。

**阴影**：`--club-shadow-xs/sm/-/hover/float/inset/press`，另有 `--club-ring`；新液态角色另有 `--club-liquid-shadow/shadow-hover/control-shadow`，当前用法见 §9.5，精确值以 CSS 为准。

**动效**：时长 3 档 `--club-dur-fast(140ms) / -dur(200ms) / -dur-slow(320ms)` + `--club-ease(cubic-bezier(0.22,1,0.36,1))`。transition 一律写 `var(--club-dur*, 200ms) var(--club-ease, ease)`（带 fallback，非 club-page 环境可降级）。循环动画（spin/shimmer/infinite）不受此约束。

**布局**：`--club-max(1240) / -narrow(720) / -read(760) / -topbar(62) / -gap(18)`。

**z-index 阶梯**：`--club-z-sticky(40) < -nav(60) < -overlay(900) < -modal(1200) < -toast(1400) < -skip(2000)`，新增弹层必须取自阶梯。

**断点阶梯（唯一允许的 5 档）**：`420 / 640 / 720 / 900 / 1100`（max-width；min-width 用 +1 补集）。历史断点（560/620/760/820/860/1080…）已归一，新增媒体查询必须取自阶梯。

## 3. 动效体系

- **keyframes 注册表**（只允许 club-ui.css 定义 `club-*` 动画）：`club-spin`、`club-shimmer`、`club-pop`、`club-enter`、`club-num-pulse`。页面私有动画保留在页内，但**不得以 `club-` 开头**（守卫工具强制）。
- **进场**：非 `data-club-surface="operate"` 的共享页面保留 320ms 入场；高频操作页面不自动播放整页阶梯入场（§30）。
- **滚动 reveal**：元素加 `data-reveal`（可选 `style="--reveal-delay:80ms"`），`club-shell.js` 的 ClubReveal 用 IntersectionObserver 触发 `.is-revealed`；只在 `html.club-reveal-ready`（JS 成功启动）后才隐藏元素，无 JS/减少动效时始终可见。当前实值 480ms/14px；空列表也监听新增子树，pagehide 断开 IO/MO 并移除 ready，pageshow 只恢复未展示节点，实时 reduced/初始化失败直接可读，完整生命周期见 §9.3 与 premium motion。
- **页面切换**：`@view-transition { navigation: auto }` 渐进增强（Chrome/Edge 交叉淡入，其余浏览器无感）。
- **数据微动效**：数值更新后对元素 `add('club-num-pulse')`，600ms 高亮脉冲；配合全局 `tabular-nums`。
- **reduced-motion**：club-ui.css 的 html 作用域兜底只影响加载该文件的文档；CSS 动画/过渡缩短与即时滚动不替代 JS 定时器/观察器/GSAP 清理。首页与独立界面按自身 CSS/脚本处理，详见 premium motion。

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

> 历史记录：非冲突行为继续对照源码；以下玻璃“不加 saturate”等材质限制由 §9.3 取代，reveal 回收与实时偏好处理以当前 motion 为准。

- **弹层语言统一**：进场 `club-pop`、出场 `club-pop-out` + 遮罩 `club-fade-out`（注册表 keyframes，180/160ms）。启动器与通知面板用 `.is-closing` 态 + JS 190ms 定时隐藏（`closeLayerWithAnimation`），重开必须 `cancelLayerClose` 取消未完成的出场定时器。club-common 的确认框/撤销条走 **WAAPI**（`animateOut`）：真实浏览器播完再移除，桩环境/旧浏览器无 `element.animate` 立即回调——保持「dismiss 后节点已不在 DOM」的同步契约（test-club-common 依赖它）。assistant 面板同法。
- **注入 CSS 的 keyframes 不得用 club- 前缀**：club-common 注入样式用 `common-pop-in/common-fade-in/common-undo-in`（club-* 注册表只许 club-ui.css 定义，守卫强制）。
- **按压反馈**：所有可点元素至少具备「过渡 + :active」。顶栏四控件/导航链接组/share/transfer-cancel/event-calendar 的补全在 club-ui.css §31；排行榜翻页在 theme.css 文件尾（**theme.css 新增规则一律放文件尾**，见地雷 1）。
- **丝滑三件套**：长列表条目用 `content-visibility:auto + contain-intrinsic-size`（changelog）；tabpanel/视图切换出现时播 `club-enter 200ms`；club 页锚点平滑滚动走 `html:has(body.club-page)` 渐进增强 + `[id]{scroll-margin-top:topbar+12px}`。
- **backdrop-filter 预算**：常驻模糊 ≤12px、不加 saturate（顶栏与 chat 顶栏已降）；新增毛玻璃先问是否常驻。
- **动态列表 stagger**：fetch 后渲染的卡片/行加 `data-reveal style="--reveal-delay:Nms"`（40ms 步进、封顶 240ms；用 `Math.min(index,6)*40`）。**reveal 观察器对“启动时无静态 data-reveal 的页面”也会挂 MutationObserver（setupReveal 不再因空集提前返回）**。频繁重渲染的列表（notifications 行）不要加，避免每次更新重播动画。
- **死代码清理**：club-ui.css 的死组件段（如旧 `.club-toast-*`、`.club-skip`）删除前必须全仓 grep 确认零引用。

## 9.2 2026-11 当前视觉与交互约定

> 历史快照，已被 §9.3 取代。保留本节原文供追溯：以下纯色、渐变为 none、高光透明的描述已不代表当前运行时；其余行为须对照最新源码和 §9.3。

本节当时取代下方历史约定中涉及渐变文字、静态投影与常驻玻璃的建议；代码令牌仍只有 `club-ui.css` 一个真源。保留已有品牌强调色和自托管字体。

- **纯色表面**：暗色背景/表面为 `#101214/#181b1f/#202428/#292e34`，文字为 `#edf0f2/#cbd1d6/#a0a9b2`；亮色沿用现有品牌。渐变兼容令牌为 `none`、高光为透明、光晕为 `none`。按钮显式提供纯色背景与文字，标题不使用透明文字裁切。
- **密度**：`club-shell.js` 按已知路由设置 `data-club-surface`。`read` 收紧阅读列并展开为单列；`operate` 紧凑面板/标题且不自动播放整页入场；`explore` 保留目录浏览层级。未知路由不猜测。
- **字号**：小字更新为12/13/14px，正文15px；触屏控件44px目标只在 coarse pointer 下扩展，保护紧凑桌面工作区与游戏几何。
- **弹层与标签**：模块启动器包含Tab焦点、关闭后立即返回触发点，并处理重开及语言刷新；通知仍是非模态。活动列表/日历使用共享键盘标签系统，减少动态效果时使用即时滚动。
- **首页**：`home-showcase.css/js` 管理首页专属构图及DOM交互；七章控制、WebGL几何与启动调度留在原代码。原Hero文案/CTA按用户要求保留，建设轨道和统计移除。真实游戏预览只在作品章节出现。
- **独立界面**：chat、assistant-launcher、chat-admin、platformer中的令牌副本同步；平台游戏脚本/ID不改。独立界面的断点因JS配合需要保留其原值，不盲目映射共享断点。
- **验证边界**：详见 `design-upgrade-2026-11/acceptance.md`。源码/模拟测试不等于真实账号或实机完整对战，截图不等于持续运行性能。

## 9.1 质感专项（第五轮历史约定，视觉部分先由9.2、再由9.3取代）

- **display 渐变文字**：`--club-grad-text`（暗色顶部提亮 + 底部 12% accent 染色；亮色弱染色保对比度），只作用于 `body.club-page main > h1`，用 `@supports (background-clip:text)` 包裹，不支持时回退纯色。新增 h1 不要再自带 color/gradient。
- **瓦片质感层**：surface-2 瓦片（.info-list li / .club-feature-group / .member-card-block / .theme-option / .event-calendar-day / .site-search-group li）统一 `inset 0 1px 0 var(--club-highlight)`；面板级容器（table-wrap/file-list/club-admin-side/resource-card）补 `--club-grad-surface` + 高光，**但亮色 §20 用 background 简写 !important 平涂，容器组渐变必须限定 `html:not([data-theme="light"])`**（§33 现成写法）。
- **chip 基类**：`body.club-page .chip`（§34）是唯一基类；`.club-notify-filters .chip` 与 `.events-view-toggle .chip` 只保留各自的 is-active 差异。新组件用 chips 直接用基类。
- **badge 语义**：补齐 `.badge.warn/.badge.info`（亮色例外在 §20 追加行）；状态语义一律用 badge，不许页面自造彩色文字（drive 邀请状态已收敛为 badge used/off）。
- **数字列**：表格数字单元格用 `td.num` 或 `.points-value`（右对齐 + tabular-nums）；新表格数字列禁止左对齐混排。
- **小件基类**：`kbd`（键帽）、`:not(pre)>code`（行内表面）、`hr`（细线）在 §34；launcher 内两处 kbd 已再声明保持原样，改 launcher 键帽只动那两条。
- **岛对齐**：platformer 不加载 theme.css（避免全站 !important 误伤游戏组件），选区色/滚动条页内自补；chat 亮色底 `--chat-bg: var(--bg)` 跟随全站暖白；平台游戏主按钮已接 `--club-grad-primary`（其 token 副本含质感层）。
- **P0 教训**：guide.html 曾整段属性引号写成全角弯引号 `”`，半页组件裸奔——批量修 HTML 属性时只替换「前导 `=` 或后随 ASCII」的引号位，正文中文引号不动。

## 9.3 精密算法展厅

> 上一轮历史快照，已由 §9.4 取代；以下保留原记录，尤其 8–12px 预算、仅导航玻璃与首页空观看区不再指导当前升级。非冲突行为仍须对照当前源码。

本节记录当轮用户已批准并在源码实现的系统变化，取代 §9.2 的扁平限制与 §9/§9.1 中冲突的材质建议。CSS 是运行时真源；本节解释当轮用法，DESIGN.md/frontmatter 与侧车只能随源刷新。

### 调色板与材质令牌

共享默认暗色为冷炭蓝：`bg/surface/surface-2/surface-3` = `#101419/#191f26/#202833/#2a3441`；`text/text-soft/muted` = `#edf2f7/#cbd5df/#a5b1bf`；`line/line-strong` = `rgba(177, 196, 216, 0.17)/rgba(177, 196, 216, 0.34)`。亮色为冷白工程纸：背景 `#f0f3f7`，三级表面 `#ffffff/#f5f7fa/#eaf0f6`，三级文字 `#182330/#35465a/#5b6a7c`，边界 `#d9e1eb/#b9c6d5`。动作色保留暗色青 `#3ad4e6`、亮色朱砂 `#c2410c` 与各自 strong/soft/on-accent；成功、警告、危险、信息仍用独立语义色。

| 运行时 `--club-material-*` | 暗色 | 亮色 | 用途 |
|---|---|---|---|
| read | `var(--club-surface)` | 继承同一别名 | 正文、表格、表单、权限、分析、排行的不透明阅读层 |
| raised | `#202731` | `#ffffff` | 入口、功能、资源，结合 light 和 sm 阴影 |
| inset | `#141a21` | `#eaf0f6` | 工具栏、图例、指标、选项、面包屑，结合 inset 阴影 |
| control | `#222c37` | `#f8fafd` | 输入与次动作 |
| hover | `#293541` | `#f1f6fb` | 可操作入口的悬停表面 |
| glass / glass-fallback | `rgba(25, 31, 38, 0.90)` / `#191f26` | `rgba(255, 255, 255, 0.92)` / `#ffffff` | 导航与短暂浮层的渐进增强 |
| scrim | `rgba(5, 10, 16, 0.68)` | `rgba(24, 35, 48, 0.34)` | 模态遮罩 |
| edge / edge-strong | `rgba(213, 231, 248, 0.09)` / `rgba(213, 231, 248, 0.15)` | `rgba(255, 255, 255, 0.85)` / `#ffffff` | 内缘高光，不能替代边界 |

`material-light` 为 145deg 有限表面提光：暗色 `rgba(184, 213, 240, 0.055)` → 同 RGB 的 0 alpha，亮色 `rgba(216, 229, 243, 0.34)` → 透明白，均在 52% 收束。`grad-surface/highlight/highlight-strong` 是该材质层别名；`grad-primary` 为 180deg 白色提光（暗 .12、亮 .08 → 0）。`grad-text` 和 `glow-accent` 仍为 `none`，`bg-glow-a/b` 仍透明。按钮保有明确底色和文字，不恢复渐变文字或整页品牌光晕。

### 深度与玻璃预算

七档阴影由同一令牌组控制，精确双主题值同步在侧车 `extensions.shadows`。暗色 `xs` 为 `inset 0 1px 0 var(--club-material-edge), 0 1px 2px rgba(0, 0, 0, 0.16)`；`sm` 加 2/4px 接触阴影及 8/20/-12px 扩散，默认层为 3/8px + 18/42/-16px，hover 为 4/10px + 20/40/-16px，float 为 8/20px + 28/72/-20px。亮色保留相同层次、改用低 alpha 的 `(29, 48, 72)`。inset 表达凹槽，press 表达按压，ring 仍为 3px accent-soft 焦点环。

局部玻璃方向预算 8–12px；共享实值是 `material-blur:10px`，支持 backdrop-filter 时 `blur(var(--club-material-blur)) saturate(1.12)`。此值取代 §9 的“不加 saturate”。顶栏、章节导航和通知浮层可用 chrome；启动器只模糊一次 scrim，面板用 raised，不能叠加第二层模糊。不支持时 chrome 为不透明 fallback、filter 为 none；`prefers-reduced-transparency:reduce` 同样强制不透明。该双主题共享规则并非夜间专属；首页保留自有顶栏 8px，文件传输遮罩另有既有 3px，不描述为全站只有一种 blur。

### 页面与组件边界

| 表面 | 当前处理与所有权 |
|---|---|
| `read` | 已知路由采用阅读密度、68ch/1.78 长文；正文、步骤与指南禁止透底模糊 |
| `operate` | 紧凑标题与面板，不自动播放 main 阶梯入场；门禁可见性由原 active/hidden 状态控制，材质不得揭开登录区 |
| `explore` | 入口和资源可用 raised/light/sm、hover -2px；表格与数据仍为 read，图例与指标为 inset |
| `premium-read/form/table/gate/analysis/leaderboard` | 不透明 read，background-image:none、backdrop-filter:none、xs 阴影 |
| `premium-inset/toolbar/legend/metrics/options/breadcrumbs` | inset + shadow-inset；profile 为 read + 单内缘，steps/guide 为 read 且无 blur |
| `premium-entry/feature/resource` | raised + material-light + line-strong + sm；可点击 entry/feature 在 hover:hover 下抬升，focus 有 2px 轮廓、3px 偏移，active 归零位移并用 press |
| 首页 | `home-showcase.css/js` 的专属调色与构图，原七章/ScrollBus/数学星系保留；首屏文案、链接和 CTA 顺序不改，不放作品、轨道、深链接条或四项统计 |
| 实力章 | 五类固定本地教学样例：Dijkstra、成员代码路径、α–β、邻接矩阵、BFS；可逐步/有限播放/重置，文字推演与输入始终可达，不冒充实时棋力或服务状态 |
| 游戏与实验室 | 材质只处理壳层、说明、分析与排行，不改变棋盘/画布几何、搜索参数、训练边界或质量策略 |
| 独立界面与旧入口 | chat/assistant/chat-admin/platformer、旧游戏适配层保留各自样式与 JS 耦合断点；不把 `--club-*` 直接强塞到这些作用域 |

共享按钮底色 + 有限提光，次按钮采用 control/light/xs，输入用 control/inset，focus 切 read 并叠 ring；入口卡片采用 raised/light，按压/禁用/键盘焦点与触屏规则保持。粗指针主要控件至少 44px，精确指针保持紧凑。

首页专属 paper 暗色 `rgba(8,14,26,.93)`、亮色 `rgba(255,253,250,.94)`；边缘 `rgba(188,220,240,.13)` / `rgba(112,87,65,.18)`，投影 `0 22px 54px rgba(0,3,12,.28)` / `0 18px 44px rgba(63,44,27,.09)`。数学场景保留自己的青/紫/粉/金色；不能与共享文字/UI palette 混为一套。亮色通用 `theme.css` 尾部采用冷白与朱砂/靛蓝映射；组件旧规则主要排除 club-page，共享 §20 再用作用域覆盖页面背景/伪元素，专用算法状态规则仍需逐页检查。

### 时序、回收与验证边界

140/200/320ms 与 `cubic-bezier(0.22, 1, 0.36, 1)` 仍为控件节奏；reveal 实际为 480ms、14px，不能概括成只有三档时长。非 operate 主内容 320ms、延迟 45/90/120ms；面板切换 200ms、数值反馈 600ms、浮层进/出 180/160ms 等按组件保留。CSS 减少动态效果规则只在加载对应样式的文档生效，不替代 JS 定时器/场景生命周期。

新 `home-motion.js` 使用本地固定 **GSAP 3.14.2**，许可证为 **Standard "No Charge" GSAP License，不是 MIT**，见 [`vendor LICENSE`](../public/vendor/gsap/LICENSE)。只有首页内层 DOM/SVG 编排：paused timeline 由 ScrollBus seek，隐藏/pagehide 回收订阅与 context，pageshow 幂等重建，phone/reduced 不启用，不新增滚动控制者或 RAF。实力章播放器 1400ms 一步，结束不循环；隐藏、离章、离视口、失焦、pagehide、偏好变化暂停，恢复须用户继续。reveal 使用独立 IO/MO，空初始列表也监听新增子树，pagehide 断开并移除 ready、pageshow 只恢复未展示节点；已展示节点不重播，动态 reduced 和构造失败保持内容可读。完整说明见 [`motion.md`](premium-upgrade-2026-11/motion.md)。

这些记录是实现与文档对应关系，不是全站验收。主任务负责 coverage/验收，源码、模拟生命周期测试和文档一致性检查均不能代替真实账号流程、实机性能或完整棋力对局。

## 9.4 Liquid Glass 当前升级

> 历史快照，已由 §9.5 取代。以下全宽双半 Hero、普遍液态入口、20px 外壳/12px 动作与亮色冷白仅记录上一轮，不再指导当前实现；本节标题保留以维持旧链接。

### 用户锁定方向与官方参考

本轮直接沿用用户批准的 iOS 26 风格局部磨砂、主题指针光、镜面边缘和控件细节，保留品牌、Inter Variable / MiSans VF / JetBrains Mono、双主题与业务行为。官方摘要与原链接见 [`references.md`](liquid-glass-2026-11/references.md)：Apple HIG Materials 强调功能层与内容层分工、稀疏使用材质并保护文本对比；Vercel Geist Materials 强调整套圆角/填充/描边/投影预设、采用足够区分的最低层级。本站只实现 CSS 透底模糊、静态提光与交互光照，不声称 Apple 原生材质、真实光学折射或新增 3D 效果；原数学星系与章节脚本仍由原实现负责。参考文件的读取日期沿用其记录，本次未重新访问官网。

### 共享材质与角色优先级

`club-ui.css` §1/§35 是共享代码真源。新 `--club-liquid-*` 与既有 `--club-material-*` 并存；选定共享液态材质为 **16px blur / saturate(1.3)**，表面圆角 20px、普通动作 12px，胶囊仍 999px。默认不透明 fallback，只有支持 backdrop-filter 才启用 glass/filter；详细双主题色、阴影及例外见 [`materials.md`](liquid-glass-2026-11/materials.md)。旧 chrome 仍为 10px/1.12，不能将选定新材质写成已统一全站。

| 角色 | 当前源码合同 |
|---|---|
| 静态入口与外壳 | card/resource/quick-link/lab-entry、premium-entry/feature/resource、auth-shell、guide/steps 获得 wash、边缘和投影；静态外观不等于已启用 blur |
| `club-liquid-surface` | 标记才启用共享 fill/filter 与局部指针光；面板限有内边距的主要内容外壳，候选祖先只保留一层采样 |
| `club-liquid-control` | 纯色/gloss/局部光斑，**无 backdrop-filter**；普通动作 12px、筛选/语言/主题/章节链接保持 pill |
| 阅读与业务内部 | premium-read/form/table/analysis/leaderboard 强制不透明 read、无 blur；auth-card 不透明，标题与 gate 外框不采样，权限仍由原状态控制 |
| 嵌套 | 液态表面或 chrome/启动器/通知中的后代液态表面退回不透明且无 filter；不得新增第二层模糊 |
| 背景 | 已知 read/operate/explore 路由使用静态 ambient background-image；不新增全屏滤镜、伪元素覆盖层或游戏背景所有权 |

按钮保留 accent/on-accent 与 danger/ghost 语义，光斑在文字下绘制；focus-visible 为 2px 轮廓、3px 偏移，按压/disabled/aria-disabled 保持明确。输入仍 control/inset，聚焦 read/ring；不得把表单内部改成玻璃。原 6/9/12/14px 圆角令牌仍有效，新 20/12px 为液态角色覆盖。

功能目录采用有界作用域修复：featured-lab 为单一玻璃外框，内部 feature-entry 透明、无边框与投影，directory-entries 行距为 `--club-space-4`（16px）。标记入口的 hover 显式恢复 background-image，避免后载入页内样式的 background 简写重置光斑与 wash；这些是组件覆盖修复，共享令牌未变。

### 首页全宽与独立界面

`home-showcase.css` 尾部将 `.hero` 收为单列，`.hero-copy` 占满既有章节内容宽度（仍受 `--max:1200px` 约束），隐藏 `.hero-art-space`。宽屏同一玻璃表面左右两半：左眉题/品牌，右归属/官网提醒/介绍/原 CTA/更新链接；720px 以下按原 DOM 阅读顺序堆叠。保留原文案、链接与 CTA 顺序，不添加作品、统计或轨道来填首屏。原七章、ScrollBus 与场景几何不变。

首页外壳圆角 24px，当前 filter 为 **16px/1.12**；实力章只有 orbit-matrix 承担 blur，标题、教学与说明列为不透明 home-read；作品说明与二维码内部不再采样。chat/assistant、chat-admin、platformer 与 legacy-premium 自有样式当前多数为 **16px/1.22**，保留各自变量、断点与 iframe/游戏边界；assistant 仅 head 与独立 ball 采样，panel/frame 不采样，chat 输入与菜单、排行内部保持稳定阅读层。这些是实际源码差异，不能用共享 1.3 覆盖描述。

### 指针委托、已集成选择器与降级

`club-liquid-lighting.js` 独立于 shell/业务启动，静态标记与指针增强分离。共享 quick-link、premium-resource、premium-guide、premium-steps 已加入候选，连同原 card/resource/lab-entry/premium-entry/feature/auth-shell、club-page panel、首页主要外壳及多个 island，完成本轮选择器集成。实际 panel-block 均同时具有 panel 类，已由现有候选覆盖；独立 club-panel 当前无实际 markup，仅保留显式标记后的样式支持，不作自动映射。候选仍受祖先去重、语义排除与阅读角色优先级约束；入选不等于每个节点都获得 blur。

文档级 passive pointerover/move/out/cancel 委托只追踪当前最近的合法标记；一次 RAF 合并事件，每次实际 render 只读取该目标一次 rect，并写元素内 **px** 坐标与 active=0/1。无移动不排帧、不递归 RAF；不增加逐卡监听或全屏追光层。MO 处理动态插入、重挂与指定状态属性；hidden/inert/aria-hidden、禁用、棋盘/canvas/table/pre、模型菜单与 assistant frame 不跟踪，SVG 按钮图标仍归属按钮。

仅 fine+hover 且无 reduced-motion/reduced-transparency 时启用鼠标追踪；触摸/笔事件清除追光。离开目标、pointercancel、失焦重置；隐藏/pagehide 取消待执行 RAF、移除追踪监听、断开 MO，pageshow/可见恢复幂等重新标记。无能力或 MO 构造失败保留可读静态外观。共享 reduced-motion/coarse/no-hover 禁追光和抬升，reduced-transparency 回退不透明且无 filter；共享 forced-colors 使用系统色，print 去材质。JS 本身未订阅 forced-colors，不能将 CSS 降级描述为监听器已停。

### 本轮记录与验收归属

此处是 Liquid Glass 前轮的记录归属，不再维护其阶段性计数或性能状态。该轮证据只查阅 [`liquid-glass 验收`](liquid-glass-2026-11/acceptance.md)；本轮最终证据归 [`precision-gallery 验收`](precision-gallery-2026-11/acceptance.md)，两轮不得互相代替。

当轮维护过 DESIGN.md、侧车、本说明与 materials.md；当前刷新仅限三个获准设计文件，不修改 materials.md、CSS/HTML/脚本，不运行 versioner 或浏览器。`tools/test-club-liquid-lighting.mjs` 的模拟测试可验证调度/回收合同，不能替代实际 GPU 帧率或完整业务流程验证；上一轮 coverage/acceptance 不自动继承为本轮通过。

## 9.5 Precision Gallery 当前约定

### 来源与方向

本节合并 2026-11-02 当前实现与已批准的「算法精密展馆」方向，取代 §9.4 的全宽玻璃 Hero 与普遍液态外壳。提取范围为 `club-ui.css` §1 的双主题令牌、面板/按钮/输入/章节导航/chip 与 §35 最终覆盖，以及 `home-showcase.css` 的字体、容器、主题变量和末尾 Precision gallery 覆盖。实际级联优先于早期同名选择器与历史文档；不新建字体、品牌或第二份运行时令牌。

默认冷暗金属、亮色暖中性。品牌与原数学场景主导首屏上部，下部金属功能台承托原介绍和 CTA；普通阅读、工作面板与入口保持不透明，玻璃只分配给登录外壳、精选展品与浮动 chrome。**`club-liquid-surface` 是光照标记，不是玻璃授权。**

### 当前共享双主题值

| 令牌组（`--club-` 前缀） | 默认冷暗 | 亮色暖中性 |
|---|---|---|
| bg / surface / surface-2 / surface-3 | `#101419` / `#191f26` / `#202833` / `#2a3441` | `#eae7e1` / `#fcfaf6` / `#f2efe9` / `#e6e2da` |
| text / text-soft / muted | `#edf2f7` / `#cbd5df` / `#a5b1bf` | `#282b2e` / `#454b50` / `#64645f` |
| line / line-strong | `rgba(177, 196, 216, 0.17)` / `rgba(177, 196, 216, 0.34)` | `#d6d0c6` / `#b8afa2` |
| metal-read（surface 别名） | `#191f26` | `#fcfaf6` |
| metal-panel / metal-raised | `#1c2530` / `#232e3b` | `#f1eee8` / `#f7f4ee` |
| metal-inset / metal-control / metal-hover | `#131a22` / `#242f3c` / `#2c3a49` | `#e5e1d9` / `#f7f4ee` / `#fffdf8` |
| material-glass / glass-fallback | `rgba(25, 31, 38, 0.90)` / `#191f26` | `rgba(252, 250, 246, 0.90)` / `#fcfaf6` |
| material-scrim | `rgba(5, 10, 16, 0.68)` | `rgba(40, 38, 33, 0.34)` |
| liquid-glass / liquid-fallback | `rgba(18, 29, 44, 0.65)` / `#162231` | `rgba(255, 253, 250, 0.80)` / `#fffdfa` |
| accent / accent-strong / on-accent | `#3ad4e6` / `#7ce7f2` / `#04141a` | `#c2410c` / `#9a3412` / `#ffffff` |

`material-read/raised/inset/control/hover` 分别映射对应 metal 角色，不再沿用 §9.3/§9.4 的旧字面值。`metal-finish` 为 112deg 有限方向提光，read-finish 更安静，control-finish 为 180deg 控件提光；精确渐变、双主题阴影及 filter 保留在侧车 extensions。`material-light` 映射 metal-finish，`grad-text/glow-accent` 仍为 none。ok/warn/danger/info 与品牌动作色保持原值，不能用高光冒充状态。

### 材质所有权与组件

| 角色 | 当前源码合同 |
|---|---|
| panel / section / panel-block / club-panel | opaque metal-panel + finish + line + shadow-xs，默认 14px；标记光照也不 blur |
| card / resource-card / quick-link / lab-entry / premium-entry / premium-resource | opaque raised + finish，14px/shadow-sm；精确指针 hover 用 metal-hover/line-strong，入口位移 -1px，padding 随路由 |
| premium-read/form/table/analysis/leaderboard/guide/steps、read 路由 panel/entry | opaque read + read-finish，禁止 blur；guide-grid 只负责布局，不再套卡片 |
| toolbar / legend / metrics / options / breadcrumbs、输入 | inset/control；输入 focus 切 read/ring，控件不采样 |
| club-auth-shell / featured-lab / premium-exhibit | 共享展品玻璃完整集合：20px、liquid-fill/wash/line/shadow，支持时 16px blur / saturate(1.3)；auth-card 内部 opaque |
| topbar / club-topbar / club-section-nav 与原浮层 chrome | 保留 material-chrome/filter，支持时 10px/1.12；章节导航 pill，不能逐按钮采样 |
| 嵌套、权限与回退 | 第二层外壳不采样；标题/gate 不 blur，active/hidden 权限不变；不支持或 reduced-transparency 用 opaque fallback，forced-colors/print 按 CSS 降级 |

§35 将普通动作最终覆盖为 **9px**，不是仍存在的 liquid-control-radius 12px；次动作使用 material-control/metal-control-finish。主/危险/ghost 语义保持，focus-visible 2px/3px，active 下移 1px/press。disabled/aria-disabled 是 **opacity 1** 的 inset 背景、muted 文字、line 边界，无投影/位移，不沿用 .45 透明度。输入 9px、padding 9px 12px、min-height 40px，placeholder opacity 1，disabled 不透明 inset；胶囊仍 999px/1.1，粗指针主要控件至少 44px。

功能目录不再是玻璃卡片墙：featured-lab 单玻璃外框，内部 feature-entry 透明且无边框/投影；普通 directory-entries 为 **row-gap:0** 的阅读行，单下边线、无圆角/投影/blur，hover/focus 只作行反馈且不抬升。

### 首页：品牌与场景在上、金属功能台在下

原 Hero DOM、文案、链接、CTA 顺序、七章/ScrollBus/数学场景保留，不新增作品或数字填首屏，不移动 DOM 重做业务。`.hero-art-space` 隐藏不等于场景被删除，原画布层仍负责场景。

`.hero-copy` 自身透明、无边框/投影/blur；grid 前两行为 eyebrow、brand，其后为 `affiliation address`、`description actions`、`description release`。**`::before` 用 `grid-area:3 / 1 / -1 / -1` 定位到内容网格背后**，绘制 18px opaque home-metal 功能台，不铺到品牌/场景观看区。仍受 `--max:1200px` 和原边距约束，不是无边距铺满视口。宽屏下部 1.15fr/.85fr；900px 以下原顺序单列，640px 以下独立手机字号/留白/CTA 换行和 14px 功能台；1600px 宽屏和短高视口各有覆盖，不沿用旧 720px 全宽 Hero 合同。

中文品牌默认 `clamp(86px,9vw,128px)` / 850 / 1.08，英文另为 `clamp(64px,7vw,100px)` / 1.06；保留中文零负字距与首页副标题专属规则，不升级共享字号阶梯。

首页专属材质不混入共享 palette：home-read 暗/亮为 `#111922` / `#faf9f6`；home-glass 为 `rgba(17,26,38,.74)` / `rgba(255,253,249,.82)`，fallback `#111a26` / `#f8f6f2`；home-edge 为 `rgba(174,198,219,.24)` / `rgba(113,103,87,.24)`。home-metal 暗色为 `linear-gradient(145deg,#202b37 0%,#131d28 38%,#101822 100%)`，亮色为 `linear-gradient(145deg,#fffefa 0%,#f3f2ed 45%,#e9e9e4 100%)`；精确 shadow/inset 同步在侧车。

### 不同章节的不同层级

- **实力**：透明标题与分隔细线；orbit-matrix 是 18px 玻璃展桌，fallback 优先，支持时 **12px/1.12**；内部 cap-exhibit 为 10px opaque home-read，不重复 blur。桌面 160px/flexible/242px 三列，1100px 以下两列、640px 以下单列。
- **作品**：五子棋主展位、方块/贪吃蛇副展位，16px 金属外框，900px/640px 分别重排，不复用实力玻璃展桌。
- **成员**：1.3fr/1fr/1fr 主次列，首位更大头像/标题；1100px 以下两列、640px 以下单列横向成员条。
- **项目/活动**：分栏条目与日期/正文时间线，各由金属承托；移动端日期在正文上方，不套首屏功能台模板。
- **加入**：说明区透明独立，加入卡和二维码承托行动，原文字与目的地保留。

### 字体、动效与证据边界

沿用 Inter Variable / MiSans VF / JetBrains Mono 与共享字号/间距/容器。原 ScrollBus 和外层场景变换保持唯一所有权；共享 140/200/320ms、一次 reveal 与原内层编排沿用既有合同。本次未重审脚本、独立 island 全部级联、模型或实际交互，静态高光与事件调度不构成 GPU 性能证明。

本次仅验证三个设计文件、令牌提取与八个静态预览的源码一致性，不声称浏览器布局、键盘、真实账号、实机或持续性能通过。最终证据由主任务稍后写入 [`precision-gallery-2026-11/acceptance.md`](precision-gallery-2026-11/acceptance.md)，写入前不填写通过状态或沿用旧轮次计数。历史 materials/motion/acceptance 仅按各自轮次和非冲突范围追溯。

## 8. 已知地雷（改前必读）

1. theme.css 亮色覆盖含大量 `!important`，且尾部有「朱砂暖白 V2」段会覆盖前段 —— 新增亮色规则放 V2 段之后。
2. club-ui.css §20 亮色覆盖块必须与新质感同步（改 token 后检查该节）。
3. 词典 zh 顶层 `lab:` 段在文件中部（4 空格缩进），文件头插入同名段会被覆盖；en 词典注入含 `'` 的文案用弯引号 `’`。
4. 运行时状态行（`#statusLine`、`.status`、日志区）**不能挂 `data-i18n`**——apply() 会覆盖动态文案。
5. `file://` 下不能 fetch 本地 JSON、不能用 contentWindow.eval；共享层全部走样式注入/postMessage 兼容。
6. QA 用全新 Chrome profile；SW 缓存旧资产会造成"改动没生效"假象。
