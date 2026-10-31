# 第五轮 UI 升级 · 质感专项（2 小时时间盒）

> 输入：三路只读审计（视觉语言/组件微质感/豁免岛）共 ~60 条发现，已亲手复核两处 P0。
> 约束沿用：不碰 index 3D 与翻页、不碰业务逻辑、club-* 真源唯一、theme.css 新增亮色规则放文件尾、守卫套件全绿。

## S1 断裂级修复（最优先，真 bug）
1. **guide.html:58-70 弯引号**：`=”`→`="` 及属性闭合位的 `”`→`"`（仅限属性位：前导为 `=` 或后随 ASCII 的 `”`；正文里的中文引号 `“…”` 不动）。修复后三步卡片、guide-grid 八张 panel、SVG 图标、data-i18n、reveal 全部恢复。全站 grep `=”` 确认仅此一处。
2. **index.html:1679 `0var(--dur-fast)`**：删除 5 处非法 `0` 前缀，恢复主/次按钮的 transform/filter 过渡（不碰 3D）。
3. **亮色 chip 选中态被打穿**：theme.css:1713-1720 的 `html[data-theme=light] .chip !important` 排除 `.is-active`（文件尾追加反制规则亦可，选前者）。
4. **亮色徽章语义色丢失**：club-ui.css:2027-2033 亮色徽章例外清单补 `.badge.cyan/.badge.green`。

## S2 display 质感（本轮"高级感"核心）
5. **`--club-grad-text` + h1 渐变文字**：club-ui.css 新令牌（暗色：text → accent 染色 12% 的纵向渐变；亮色回退纯色保证对比度），`background-clip:text` + `@supports` 降级。只作用于 `body.club-page main > h1`。
6. **index 亮色缝隙**：eyebrow 双线掉漆改 currentColor（:1344-1350）；右侧章节导航刻度亮色覆盖（:108-112）；pc-tip/feed-modal 幽灵按钮对齐 secondary-action 质感（:1222-1231）。
7. **theme.css 亮色主按钮补渐变**（:1676-1691 纯平涂 → day 版三段渐变 + 顶缘高光，追加文件尾）。
8. **切换器激活胶囊色相同源**（index:406-410 + theme.css:845 的 #22d3ee/#818cf8 → cyan/violet 同源渐变）。

## S3 组件质感层补齐（round1 漏掉的组件族）
9. `.table-wrap`、`.file-list`、`.resource-card`、`.club-admin-side` 补 grad-surface + inset 高光（与 .panel 同语言）。
10. 六个 surface-2 瓦片（.info-list li / .club-feature-group / .member-card-block / .theme-option / .event-calendar-day / .site-search-group li）统一补 inset 高光。
11. `.club-tabs` 容器统一为半透明 blur 版（对齐 .club-section-nav）。
12. club-ui 内部 9 处硬编码亮色 hex 清理（#FFFFFF→var(--club-surface)、#7a808a→--club-muted、badge tint → color-mix 现算）。

## S4 岛对齐（豁免但只动 UI 层）
13. **platformer**：字体栈接 --club-font/--club-mono；技能键亮色按压 `#285d78`→color-mix accent；页内补 selection/滚动条两小段（不加 theme.css，避免 ！important 误伤游戏组件）；补齐页内缺的质感令牌。
14. **chat**：`.chat-empty-hint kbd` 改等宽键帽；亮色底色从冷白映射到全站暖白（--chat-bg/-glow 接 --day-* 令牌）；品牌方块杂色紫 #7c5cff 接语义令牌。
15. **appmonitor**：`.download` CTA 补过渡/按压/渐变；`.date` 改 --club-mono；head 补 og/canonical meta 块（照抄 platformer 版式）。
16. **index 杂项**：kbd 字体、chat 品牌紫——并入 13/14。

## S5 小件收编（时间盒允许则做，否则裁掉）
17. `.chip` 两份近拷贝上收为 `body.club-page .chip` 基类；补 `.badge.warn/.badge.info` 并收敛 resources 封面标签、drive 邀请状态两处自造。
18. 数字列右对齐：启用沉睡的 `.club-num`（member-points/member-center/mall-admin 数字列）。
19. 全局小件基类：`kbd` 键帽（抄 chat 版）、`code` 行内表面、`hr` 细线。
20. 圆角/字面量散点：.brand-mark 统一 9px、chip 999px→--club-radius-pill、12px→--club-radius-md 等；drive.html:45 lead 补 class。
21. 阶梯外字号三处（member-checkin 13px、search h3 14px、drive-admin 12px）换令牌。

## S6 验证与文档
- 守卫全套：check-ui-tokens / version-static-assets / test-asset-versions / test-club-common / test-club-launcher-favorites / test-assistant-launcher / test-pwa / theme / seo / 404 / brand / site-search / i18n / git diff --check。
- 浏览器实测：guide 页修复前后对比截图（P0 证据）、index 亮色 UI 抽查（不碰 3D）、changelog/events 亮暗、新增 h1 渐变亮暗截图。
- docs/design-system.md 增补（grad-text 令牌、tile 质感层、chip 基类约定）；changelog 增条目；memory 更新。

## 明确不做（记录结论）
- theme.css 529 处 ！important 架构裁剪（独立大轮次）。
- 空态三代 / 加载态三套统一（涉及多页面渲染函数与 test-club-common 契约，单独轮次）。
- member-center 门禁态双标题（需动页面脚本逻辑）。
- index 3D / platformer 玩法 / chat 业务，一律不碰。
