# 精密算法展厅 · 动效实现与生命周期

## 权威、范围与许可

本文件解释当前源码已实现的动效，依附于[方向合同](direction.md)及[权威设计系统 §9.3](../design-system.md#93-精密算法展厅)。[旧动效记录](../design-upgrade-2026-11/motion.md)保留历史；其中无标签拓扑能力图已被可推演的教学样例取代。本次仅做文档/源码一致性检查，不新增浏览器、实机、登录区或全站验收结论；覆盖与最终验收由主任务维护[coverage.json](coverage.json)。

首页本地资源固定为 **GSAP 3.14.2**：[gsap.min.js](../../public/vendor/gsap/gsap.min.js) 与 [LICENSE](../../public/vendor/gsap/LICENSE)。许可准确名称是 **Standard "No Charge" GSAP License，不是 MIT**。本地许可记录上游标准许可和 npm 3.14.2 分发来源，生效日期 2025-04-30、最后修改日期 2025-05-30；版权与限制按该文件保留。当前只用 GSAP 核心时间线，不引入 ScrollTrigger、平滑滚动或额外 WebGL。

## 时间与变换所有权

| 层 | 实现与边界 |
|---|---|
| 原章节舞台 | [index.html](../../index.html) 的七章顺序与 ScrollBus 是唯一滚动时间/章节控制者；原场景负责透视、旋转、深度、位移、揭示和粒子，保持几何/采样/质量与启动策略 |
| 首页前景 | [home-showcase.css](../../public/home-showcase.css) / [home-showcase.js](../../public/home-showcase.js) 保留构图和 CSS 章节变量；不把舞台 transform 交给 GSAP |
| GSAP 内层 | [home-motion.js](../../public/home-motion.js) 的 paused 时间线只响应 ScrollBus seek；不增加 scroll 监听、ticker 回调或 RAF |
| 教学播放器 | [home-capabilities.js](../../public/home-capabilities.js) 独立维护离散步骤与单个 setTimeout；演示不驱动舞台，不发送网络请求，不调用游戏引擎 |
| 共享 reveal | [club-shell.js](../../public/club-shell.js) 的 IO/MO 只处理 data-reveal，一次展示后取消观察；不用 GSAP |
| 控件/浮层 | [club-ui.css](../../public/club-ui.css) 的 CSS，及 [club-common.js](../../public/club-common.js) 等既有 WAAPI/关闭逻辑各自管理，不由首页生命周期代管 |

## 时序实值

| 行为 | 当前数值 | 适用解释 |
|---|---|---|
| 共享快/常规/慢 | 140 / 200 / 320ms | `--club-dur-fast/--club-dur/--club-dur-slow`；首页 `--dur*` 同值 |
| 常规缓动 | `cubic-bezier(0.22, 1, 0.36, 1)` | 状态反馈主曲线；首页历史效果继续保有各自曲线 |
| 非 operate 主内容 | 320ms，第二/第三/后续延迟 45/90/120ms | `club-enter`；operate 不自动播放 main 阶梯入场，不等于禁用一切局部 reveal |
| 共享 reveal | 480ms、translateY(14px) | opacity/transform，使用 `--reveal-delay`；列表惯例 40ms 步进、封顶 240ms，频繁刷新列表避免重播 |
| 面板切换 | 200ms | 可见 tabpanel 等既有状态反馈 |
| 数值反馈 | 600ms | 既有 `club-num-pulse`，不是持续动画 |
| 浮层退出 | pop-out 180ms、fade-out 160ms；JS 190ms 后隐藏 | 重开取消尚未完成的关闭计时；确认框/撤销条按既有 WAAPI 完成回收 |
| GSAP 内层 | duration:1，ease:`power3.out`，stagger amount:.14 | 归一化时间线单位，不是 1 秒滚动锁定；y 12→0、opacity .72→1 |
| 教学播放 | 每 1400ms 一步 | 单个 setTimeout 串行调度，终点自动停止；用户可继续、逐步或重置 |

三档共享 token 不能解释为所有动效只有三个时长。CSS 中的 `@view-transition { navigation:auto }` 是渐进增强，不构成第二个页面导航控制器。

## GSAP 前景的启动、清理与恢复

只有 `window.gsap` 和 `window.ScrollBus` 均存在时才安装模块；缺失时直接返回，保持 CSS 默认可读。七章索引固定为 home、capabilities、gomoku、members、projects、activities、join。

动画目标仅为四组内层内容：capabilities 的 `.cap-exhibit-heading, .cap-controls`，gomoku 的 `.planet-copy h3, .planet-copy p`，projects 的 `.project-card h3`，join 的 `.join-list span`。不选择 hero copy、section、chapter-stage、作品行或成员卡，避免与 CSS 的 transform 所有权冲突。

`start()` 先调用 `stop()`：取消旧 bus 订阅，`context.revert()` 恢复模块写入样式，清空时间线，令 `gsap.ticker.sleep()`。若 reduced-motion、document.hidden 或 body.phone-device 成立，保持静态退出；否则在新 gsap.context 中建立 paused 时间线，先 seek 再订阅 bus。`seek()` 优先取有限 smoothProgress，否则取 progress；非有限值不处理，隐藏文档不 seek。每组进度为 `clamp(1 - abs(progress - chapterIndex), 0, 1)`，传入 progress 时抑制回调，每次 seek 后再 sleep ticker。

- visibilitychange：隐藏 stop，重新可见 start。
- pagehide：stop；pageshow：start，包含 bfcache 返回。
- reduced-motion change：start，先回收再决定是否重建。
- 所有时间线保持 paused；没有自动播放 GSAP 循环。

`phone-device` 在每次 start 检查，模块没有单独的 resize/设备类 MutationObserver。不能将恢复叙述为保留了旧 GSAP context；实际是回收后重新创建，并用当前 bus 进度恢复画面。

## 实力章的有限教学播放器

五个 tab 对应真实、固定、本地计算的样例：Dijkstra 最短路、成员展示代码路径、左到右 α–β、无向图邻接矩阵、BFS。α–β 中剪枝分支保留上界，不伪造未搜索结果；成员路径是解释图，不报告实时服务状态。SVG 为 aria-hidden 的图示，文字解释、输入与完整步骤 transcript 提供可读替代。图示和控件的材质/布局见首页 CSS。

`createPlayer()` 保存 step、playing、timer、disposed。next/reset/pause 都先清除 timer；tick 到末步后 stop，不循环。用户在完成后按播放会从 0 开始。切换 tab 先 dispose 旧播放器，再创建新播放器，旧 timer 不继续；方向键/Home/End 切换并移动焦点。动态文案保存 key/vars，`club:langchange` 重新渲染，初始化后 `setTimeout(refresh,0)` 再刷一次，播放器进度无需转为翻译后的字符串。

以下事件仅暂停而不自动恢复播放：document.hidden、pagehide、window blur、sceneprogress 明确离开 capabilities、IO 不相交（threshold .15）、reduced-motion change。播放按钮只在文档可见且 inView 时切换播放。恢复可见、返回本章、bfcache 返回或重新获得焦点后，用户自行继续。初始不自动播放；reduced-motion 变化暂停，代码不禁止用户随后主动播放离散教学步骤。

生命周期实际边界：pagehide 调用 pause 而非 dispose，保留步骤和监听器；IO 未在 pagehide disconnect，页面内用于继续判定 inView，没有新增 pageshow 自动播放钩子。不能声称该模块会移除全部监听器或销毁全部观察器。正常卸载由浏览器回收文档，切 tab 才 dispose 旧播放器。

## 共享 reveal 的新生命周期

`setupReveal()` 通过 revealBound 只绑定一套媒体/page 监听；每次调用 refreshReveal 都先 stopReveal，避免重复活跃观察器。ready 类只在 IO/MO 初始化成功后添加；CSS 只有在 `html.club-reveal-ready` 时才隐藏 data-reveal 元素，无 JS 时内容直接可见。

1. IO 参数为 rootMargin `0px 0px -8% 0px`、threshold .05；相交后添加 is-revealed 并 unobserve。
2. WeakSet 去重，已含 is-revealed 的节点不再观察；完成的入场不因恢复而重播。
3. 初始节点集为空也安装 MO（若支持），监听 body 的 childList/subtree；新增元素本身与全部后代中的 data-reveal 都会注册。只监听新增树，不观察 data-reveal 属性后改。
4. pagehide 标记 suspended，断开 IO/MO、清空引用、移除 ready；此时媒体变化不重装观察器。
5. pageshow 解除 suspended 并 refresh，只重新观察尚未完成展示的节点；包含 bfcache 返回。
6. 动态 reduced-motion（现代 change 或旧 addListener）触发 refresh；开启 reduced 或不支持 IO 时现有节点加 is-revealed，不保留隐藏 gate。该分支无 MO，新节点也因没有 ready 而默认可见。
7. IO/MO 初始化或初始观察抛错时 stopReveal，现有节点可见，不留下 ready 隐藏内容。refresh 级 try/catch 不应描述为捕获所有未来异步回调异常。

共享 reveal 没有 visibilitychange 暂停钩子，不把首页 GSAP 的隐藏回收规则套用给它。[test-club-reveal-lifecycle.mjs](../../tools/test-club-reveal-lifecycle.mjs) 的 VM 测试覆盖空/动态树、去重、完成一次、pagehide/bfcache、实时 reduced、旧媒体接口及构造失败；测试性质为模拟生命周期检查。

## 材质、减少动态效果与验收责任

控件浮起仅局部 -2px，按压回落并使用 press shadow，reduced-motion 时入口变换取消。共享玻璃方向预算 8–12px，运行时为 10px + saturate(1.12)，只在导航/短暂 chrome；无支持或 reduced-transparency 回退不透明，启动器面板不叠 blur，数据和正文不使用玻璃。

club-ui.css 的 reduced-motion 兜底在加载它的文档将 CSS 动画/过渡缩短为 .01ms、迭代一次、滚动改 auto；不代替 JS 清理，也不能假定未加载该 CSS 的文档获得此兜底。首页原场景继续使用原静态/单帧策略，本轮没有以降低几何、粒子或采样来换取结果。

可运行的相关源码检查包括 [test-home-capabilities.mjs](../../tools/test-home-capabilities.mjs)、reveal 生命周期与 [test-club-shell-interactions.mjs](../../tools/test-club-shell-interactions.mjs)。这些工具和本文不证明登录后覆盖、持续 GPU 性能、完整对战或整站视觉验收；实际执行情况与结论由主任务登记，不能由本文列出的工具名推断通过。
