# 全站 UI 第三轮升级计划（2026-10-25 · 模板层收敛与交互态补全）

> 第一轮（同日凌晨）建立字体与组件质感层；第二轮完成语义令牌、断点阶梯与 45 页接入收敛（见 `ui-upgrade-plan-2026-10-round2.md`）。
> 第三轮定位：**体系已经建成，但"体系内的完成度"不足**——组件四态有缺口、模板组件有人用没人管、字号仍有半档孤值、chat 岛与主体系存在可见色差。本轮不新增体系，只把既有体系的执行率从 ~60% 拉满。
>
> 约束（沿用用户要求）：不动首页 3D 背景与翻页交互；不改任何业务逻辑；不碰游戏棋力/训练数据/SQL。

## 一、诊断结论（量化）

四路并行审计（T1 横向一致性 / chat 岛 / 动效交互 / 排版层级）得出的核心数字：

| 维度 | 现状 |
|---|---|
| 页头模式 | 视觉已统一（eyebrow/h1/lead 全局类），但 `.club-page-head` 仅 1/25 页采纳；h1 负字距 `-0.01em` 与自家注释矛盾 |
| 工具栏 | 9 套命名并存；`.list-toolbar` 在 2 页各自复制 CSS，donation/signup 工具栏 CSS 写在页内 |
| 门禁图标 | `.gate-icon` CSS 在 **16 个页面逐字复制**（每页 3 行） |
| 表格 | th 字号 club 11.5px vs **6 页本地复制 11px** 打架；备注列 `.cell-desc` 2 页本地复制；长文本截断无约定（clamp/限宽/anywhere 三种并存） |
| 空态/加载 | 三套并存（listState 10 页 / club-empty 7 页 / 自写 .empty 14 页）；骨架屏 **1/41 页**采纳；主要列表加载态全是"文字+转圈" |
| 组件四态 | `.btn:disabled`、`.row-button:active`、danger/ghost `:active`、`input/select/textarea:disabled`、`.chip` hover/active、`.club-tabs:active` 全部缺失 |
| 动效采纳 | `club-num-pulse` **0 次使用**（死代码）；`data-reveal` 仅 changelog 1 页；首页 19 处 transition 全字面值、0 处令牌 |
| 排版 | 受审 27 页硬编码字号 31 处，61% 在 7 档之外；`club-prose` **0 页采纳**；行高 7+ 档流通 |
| 信息层级 bug | `resources.html:55` h2 以 `</strong>` 闭合（真实标签错误）；notifications/search 把 h1 埋进 panel；appmonitor 双页脚叠加 |
| 中文排版 | 首页 5 处标题负字距（最重 `.title-glow` -0.055em 作用于"算法社"） |
| chat 岛 | chat.css 是 club 色板近似复刻（15 个 token 精确同值），但 ok/warn/danger 3 个语义色、ease、阴影与 club 微差；**launcher 亮色完全脱轨**（暖奶油系 vs 全站冷白系）；chat-admin.css 98 处 hex 手工对齐 |
| index 排版 | body 无 club-page（设计如此），但 4053 行中 1732 行内联 CSS 的过渡时长全字面值 |

## 二、五维优化方向

1. **视觉语言**：消灭"同角色微差色"——chat 岛语义色、launcher 亮色、chat-admin 高频 hex 全部等值对齐 club 令牌；中文标题负字距全站归零（含 club-ui 自身 h1）。
2. **布局体系**：工具栏、门禁图标、表格备注列三块"页面私有 CSS"上收为共享组件；表格密度（th 字号、长文本策略）统一。
3. **交互动效**：组件四态补全（按压/禁用/悬停），让每个可点元素都有物理反馈；`club-num-pulse` 从死代码变成实际微动效；加载态从"文字转圈"升级为骨架屏。
4. **组件一致性**：16 页复制的 gate-icon、2 页复制的 list-toolbar、6 页复制的 th 覆盖全部删除，真源唯一；空态向 `club-empty`/`listState` 收敛。
5. **信息层级**：h1 回到 main 顶层（notifications/search）；修复破损标签；`club-prose` 在真正的长文场景（更新日志条目）落地；`data-reveal` 在静态内容页增量启用。

## 三、分阶段实施

### 阶段 1 · 设计系统层（club-ui.css + club-common.js）
- [x] `.gate-icon` / `.list-toolbar` / `.cell-desc` 上收 club-ui.css（§新组件段）
- [x] th 字号 11.5→`var(--club-fs-xs)`，消灭 11.5 半档（badge/status-pill/profile-item small 等同步归档）
- [x] h1 `letter-spacing` 归零；移动端 28px 并入 display token 下限（渲染等价）
- [x] 四态补全：disabled 组扩展到 .btn/.secondary-action/.row-button；danger/ghost/row-button `:active`；`input/select/textarea:disabled`（亮暗双套）；chips hover/active/transition；`.club-tabs button:active`
- [x] `ClubCommon.pulse(el)` 数值脉冲助手

### 阶段 2 · 页面层迁移（纯展示层，无业务逻辑）
- [x] 16 页删 gate-icon 本地复制；2 页删 list-toolbar；6 页删 th 覆盖；mall-admin 删 cell-desc
- [x] 骨架屏替换初始加载占位（仅"整块 innerHTML 被替换"的容器）
- [x] h1 层级修复（notifications/search）；resources 破损 h2 修复；appmonitor 双页脚修复
- [x] changelog 条目挂 `club-prose`；静态内容页增量 `data-reveal`

### 阶段 3 · chat 岛视觉对齐（不加 club-page，变量等值，零布局风险）
- [x] chat.css：3 个暗色语义色 + 4 个亮色微差 + ease + shadow 等值对齐，注明与 club-ui 同步维护
- [x] assistant-launcher.css：亮色 6 变量对齐 club 亮色（冷白系）；跨岛 `--chat-ease` 引用改为自持有
- [x] chat-admin.css：`--chat-admin-*` 对齐同角色 club token；高频等值 hex 换 var()

### 阶段 4 · 首页排版与动效（不碰 3D / 翻页）
- [x] 5 处中文标题负字距归零
- [x] 19 处 transition 字面时长 → 首页自有 `--dur-fast/--dur/--dur-slow/--ease`（值与 club 令牌一致）

### 阶段 5 · 文档 · 守卫 · 验证迭代
- [x] design-system.md 升 v3（新组件、四态矩阵、chat 岛对齐约定）
- [x] changelog.json 增条目并重建快照
- [x] `check-ui-tokens` / `version-static-assets` / `node --check` / 固定测试套件 / `git diff --check`
- [x] 亮暗 × 桌面截图抽查（新 Chrome profile）

## 四、明确不做（豁免维持）

- 首页 3D 背景、章节飞行、翻页交互（用户约束）
- platformer / 根目录中文孤儿页 / chat 页挂 body.club-page（高风险，chat 元素级穿透有 5 个可复现破损点，见第二轮审计）
- `setMessage` 17 页复制合并进 ClubCommon（触及页面脚本结构，收益/风险比不足，留待第四轮）
- 业务逻辑、引擎、训练数据、SQL 一律不动
