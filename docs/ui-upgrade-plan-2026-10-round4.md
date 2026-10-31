# 第四轮 UI 升级计划（2026-10 · 质感与丝滑专项）

> 定位：前三轮完成了体系收敛（令牌/模板组件/四态/骨架屏/chat 岛对齐）。本轮不再做结构级收敛，
> 专攻「高级感 + 丝滑感」的最后一公里：弹层动效完整性、交互反馈零死角、渲染成本、微动效一致性。
> 约束沿用：不碰 index 3D 背景与翻页、不碰业务逻辑/引擎/训练数据、守卫套件必须全绿。

## D1 诊断结论（2026-10-30）

四路审计（1 代理 + 定向扫描核实），关键事实：

- **弹层动效断层是当前最大质感损伤**：启动器/通知面板只有进场没有出场（`display:flex→none` 硬切）；
  全站唯一确认通道（club-common dialog）和撤销条完全无动效；AI 助手面板展开收起硬切。
- **交互反馈零死角**：`.club-notify-button`、admin-rail/section-nav/admin-side/crumb、share-option、
  leaderboard-pagination（theme.css）、transfer-cancel、顶栏四控件（launcher/back/lang/theme/to-top）、
  event-calendar-item —— 共 13 组可点元素缺 hover 过渡或缺按压态。
- **渲染成本**：changelog 53 条无 content-visibility；顶栏 backdrop blur(18px)+saturate 常驻（chat 页双常驻）；
  sorting-lab 柱状图用 height 过渡（每步 layout）；三处宽度过渡（chat/drive/gomoku）。
- **微动效不一致**：resource-card 悬停无阴影变化；theme-option transition 列表缺 transform（与 theme.css
  hover 位移撕裂）；动态列表（points-mall/events/drive）无 stagger；tabpanel/events 视图切换硬切；
  is-loading 不覆盖 .row-button；View Transitions 只在 club-ui.css，chat/assistant 不加载 club-ui.css。
- **死代码**：club-ui.css `.club-toast-*` 整段（约 60 行）无任何引用（线上用 club-common 注入版）。
- **锚点**：club 页无 scroll-behavior:smooth、无 scroll-margin-top；.club-section-nav 样式存在但无页面使用。
- 已达标不再动：changelog stagger、toast in/out、四态矩阵、reduced-motion 三重兜底、回到顶部。

## S1 弹层动效体系（最高价值）

统一「进场 club-pop / 出场 club-pop-out + 遮罩 club-fade-out」语言，时长 180ms（动效令牌内）：
- [x] club-ui.css 注册表新增 `club-pop-out`、`club-fade-out` keyframes（club-* 只许在此定义）。
- [x] 启动器：`.is-closing` 态 + 190ms 延迟后隐藏；reduced-motion 直接隐藏；重开时清定时器。
- [x] 通知面板：同法（club-shell.js closeNotify）。
- [x] club-common 确认框：注入自有 keyframes（`common-pop/common-fade`，不用 club- 前缀），in/out 完整。
- [x] club-common 撤销条：底部滑入/滑出。
- [x] assistant-launcher 面板：transform-origin 右下 + scale/opacity 过渡，收起播完再 hidden。

## S2 交互反馈补全（低风险大面积）

- [x] `.club-notify-button` 补 transition + :active。
- [x] admin-rail / section-nav / admin-side / crumb 链接补过渡。
- [x] share-option / share-cancel 补过渡 + active。
- [x] club-common 确认框按钮按压态。
- [x] theme.css `.leaderboard-pagination button` hover/active/transition（放 V2 段之后）。
- [x] `.transfer-cancel` 四态。
- [x] 顶栏四控件（launcher-button/back/lang/theme/to-top）补 :active 按压。
- [x] `.event-calendar-item` hover + `.has-events` 响应。

## S3 丝滑度（渲染成本与连贯性）

- [x] changelog `.entry` 加 `content-visibility:auto; contain-intrinsic-size`。
- [x] tabpanel 与 events 列表↔日历切换加 `club-enter`（200ms，注册表现有动画）。
- [x] `html:has(body.club-page)` smooth 滚动 + `body.club-page [id]` scroll-margin-top（渐进增强）。
- [x] 顶栏 backdrop-filter 18px+saturate → 12px（去 saturate）；chat 顶栏/侧栏同步降档。
- [x] resource-card 悬停补阴影变化；theme-option transition 列表补 transform。
- [x] is-loading 选择器组补 `.row-button`。
- [x] `@view-transition` 上移 theme.css（覆盖 chat/assistant；index 已自带 opt-out 不受影响）。

## S4 列表 stagger 与死代码

- [x] points-mall 商品卡 / events 公告活动卡 / drive 文件行渲染模板补 `data-reveal` + 阶梯延迟（≤270ms 封顶，
      沿用 ClubReveal MutationObserver 基建；notifications 行为避免频繁重播不加）。
- [x] 删除 club-ui.css 死的 `.club-toast-*` 段（核实零引用）。
- [x] drive.html 裸 table 补 .table-wrap（graph-lab 的表格是实验室演示件，豁免）。

## S5 验证迭代

- [x] 守卫套件：check-ui-tokens / version-static-assets / test-asset-versions / test-club-common /
      test-club-launcher-favorites / test-i18n-dict / theme / pwa / seo / 404 / brand / training-policy。
- [x] 浏览器实测：亮暗 × 桌面/手机截图（全新 profile + 禁缓存），弹层 in/out 手动链路。
- [x] design-system.md 增补第 9 节动效/弹层约定；changelog 增条目。

## R5 滚动迭代（2026-10-30 同日第二批，已落地）

- [x] theme.css 尾部补全局 `:focus-visible`（:where 零特异性）——chat/assistant 不加载 club-ui.css，
      此前键盘导航无焦点环；亮色自动映射 --day-brand。
- [x] theme.css 补全局 `::selection`（暗色青、亮色朱砂），club 页保持自己的 accent-soft 版本。
- [x] gomoku 氛围层触屏降负：`@media (pointer:coarse)` 下 orb blur 72→48、opacity .18→.14、隐藏 pointer-glow
      （纯 CSS、reduced-motion 兜底不变，不碰 3D 与引擎）。
- [x] 核实 eyebrow 全站一致（::before 短划线即截图中所示），无需改动。
- [x] gomoku 集成契约复验：file:// 侧 108 人机 + 972 模型对战 + 黑白/重置落子全过
      （检查器 HTTP 侧模型初始化失败经 stash 双向验证与本轮改动无关，为临时测试服务器环境问题）。

## 评估后明确不做（记录结论，避免反复重查）

- **宽度过渡改 scaleX**（chat-context-fill / drive-usage-bar / gomoku 胜率条）：三处面积都很小，
  改造需要同步改 JS 写入逻辑，收益/风险比不划算。
- **sorting-lab 柱状图 height→scaleY**：标签定位与柱体绑定 height，改造会破坏现有视觉，收益不足。
- **member-points 全量渲染改 ClubCommon.paginate**：触及列表渲染语义（排序/合计），属页面逻辑边界，留给业务侧。
- **滚动条统一**：核查后 club-ui/chat/chat-admin 已全覆盖（index/platformer/appmonitor 均加载 club-ui），无缺口。
