# Liquid Glass 当前材质合同

本轮为用户直接批准的局部磨砂、主题指针光与精致控件升级。当前说明以 [设计系统 §9.4](../design-system.md#94-liquid-glass-当前升级) 为准；本文件为源码对照，CSS 仍是代码真源。官方参考摘要见 [references.md](references.md)，该文件的访问日期按原记录保留，本次没有重新访问官网。

Apple HIG Materials 提供功能层/内容层分工与可读性边界，Vercel Geist Materials 提供成套层级预设与最低必要深度的参考。本站保留品牌、字体与主题色；CSS 模糊、边缘、投影和局部光照不等于原生 Liquid Glass、真实折射或新增 3D。

## 共享令牌

来源为 [club-ui.css](../../public/club-ui.css) §1、支持/偏好块及 §35。以下 `--club-liquid-*` 为新角色，不删除旧 `--club-material-*`。

| 后缀 | 默认暗色 | 亮色覆盖 |
|---|---|---|
| glass | `rgba(18, 29, 44, 0.65)` | `rgba(255, 253, 250, 0.80)` |
| fallback | `#162231` | `#fffdfa` |
| line | `rgba(151, 192, 218, 0.23)` | `rgba(137, 111, 89, 0.24)` |
| line-hover | `rgba(112, 218, 234, 0.48)` | `rgba(154, 88, 53, 0.44)` |
| rim | `rgba(224, 243, 255, 0.27)` | `rgba(255, 255, 255, 0.96)` |
| rim-low | `rgba(8, 17, 29, 0.52)` | `rgba(114, 98, 79, 0.09)` |
| control | `#253546` | `#f5f3ef` |
| control-hover | `#2e4255` | `#ffffff` |
| radius / control-radius | `20px / 12px` | 继承 |
| blur / saturation | `16px / 1.3` | 继承 |

fill 默认引用 fallback，filter 默认为 none；支持 backdrop-filter 时切换为 glass 与 `blur(var(--club-liquid-blur)) saturate(var(--club-liquid-saturation))`。wash 是 155deg 表面提光，control-gloss 是 180deg 控件光泽；shadow/shadow-hover/control-shadow 组合上下内缘与接触/扩散阴影，精确字符串只从 CSS 提取到侧车 extensions。ambient 是已知共享页面背景上的静态渐变，不新增动画或全屏采样层。

## 角色与差异

- 静态 card/resource/quick-link/lab-entry/premium-entry/feature/resource、auth-shell、guide/steps 使用不透明 fallback、wash、line、shadow；只有 `club-liquid-surface` 标记启用共享采样。不得把静态样式名单当作已覆盖名单。
- 标记外壳可用共享 16px/1.3；嵌套标记或 chrome 中的后代不再采样。控件始终无 backdrop-filter，语义按钮保留明确底色/文字，pill 保留 999px。
- read/form/table/analysis/leaderboard 强制不透明，auth-card 不透明；标题与 gate 外框不采样，门禁状态与业务逻辑保持。
- 旧共享 chrome 仍为 10px/1.12；首页为 16px/1.12、外壳圆角 24px；chat/assistant、chat-admin、platformer 与 legacy-premium 当前多为 16px/1.22。这是当前差异，不宣称全站统一为 1.3。
- 首页全宽指占满既有 1200px 最大章节容器：一个 hero-copy 表面承载原文案左右两半，隐藏 hero-art-space；720px 以下堆叠。保留原文案/CTA/七章/场景，不添加作品、统计或新光学效果。实力章只由 orbit-matrix 采样，教学、标题和说明列为 home-read。
- island 样式自包含：chat 的 prompt/settings-body/menu、assistant 的 panel/frame、platformer 排行与公告内部等保持不透明或无 filter；保留 JS 耦合断点，不强行搬用共享 token。

功能目录的有界 CSS 修复保持同一材质：featured-lab 仅一个玻璃外框，内部 feature-entry 透明且无边框/投影；directory-entries 行距为 `--club-space-4`（16px）。作用域 hover 规则显式恢复 background-image，避免后载入页内 background 简写清掉光斑与 wash；不改变共享令牌。

## 指针与已完成接入

[club-liquid-lighting.js](../../public/club-liquid-lighting.js) 当前通过 document passive 事件委托追踪最近合法标记；事件合并到一个待执行 RAF，一次 render 只读当前元素一次 rect，写入元素内 px 的 `--club-pointer-x/y` 与 0/1 的 `--club-pointer-active`。无事件没有 RAF，无逐卡监听或 idle 动画循环；光斑画在文字下，不改变文字透明度。

tracker 已加入 quick-link、premium-resource、premium-guide、premium-steps，本轮选择器集成已完成。实际 panel-block 均同时具有 panel 类，已由现有候选覆盖；独立 club-panel 无实际 markup，仅保留显式标记样式，不自动映射。MO 对动态插入/重挂/指定属性变化重新标记；候选祖先避免双层标记，数据/画布/iframe/隐藏/禁用目标不追光。候选覆盖仍受阅读角色优先级约束，不表示每个节点都会采样。

fine+hover 且无 reduced-motion/reduced-transparency 才追踪鼠标；触摸/笔、离开、取消、blur 重置。隐藏/pagehide 取消帧并断开追踪与 MO，恢复后幂等启动。共享 reduced-motion/coarse/no-hover 去追光与抬升，reduced-transparency 不透明且无 filter；forced-colors/print 由 CSS 降级，JS 没有 forced-colors 订阅，不能声称其监听器因此停止。

## 验证边界

主任务已报告 49 页均以 standalone defer 接入，196 个布局测量中 overflow 为 0、lighting=true，资产检查为 37 个哈希、581 处引用。本次文档代理仅同步文档与侧车并作针对性一致性检查。主任务已完成330003.4ms前台性能窗口，抽样2638项、p95为4.3ms、无观察到的长任务；方法与限制见 [performance.json](performance.json)，本轮范围化结果见 [acceptance.md](acceptance.md)。上一轮记录不自动作为本轮通过。模拟 lighting 测试的调度/回收断言不等于实机性能或逐页无嵌套采样证明。
