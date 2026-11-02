# 精密算法展厅 · 范围化验收记录

日期：2026-11-01。本文依据本轮现存产物、当前源码及主任务提供的观察摘要整理，不新增浏览器验收。配套逐路由清单见 [coverage.md](coverage.md)。

## 结论：限定范围验收通过，非全站无保留放行

**本轮有证据支持的就绪范围是：49 个公开入口在指定桌面/手机、日夜主题下的初始页面布局测量，以及有明确状态边界的代表画面和局部交互。** `coverage.json` 中四列均记录无横向溢出、主题 API 已确认；这构成 49 × 4 = 196 个初始布局观察，不构成 196 份逐画面视觉合格证，更不构成全部账号、设备、语言、业务状态的端到端认证。

独立审查提出的标题背景条、社员中心外层门禁材质、首页公告全文挤占预览三项问题，已由修复代理 `3ac5` / `fa52` 落到当前源码；主任务已收到 **10 张修复后代表截图复核通过**，三项修复及活动详情 CTA 问题在该范围内关闭。列名回归已由主任务实际运行通过，首页前台性能采样也已完成。**公开初始布局、指定代表画面/修复、已记录局部交互及当前桌面持续运行观察达到本轮限定验收范围**；预存 club-drive 部署包检查失败仍保留，真实身份/设备/完整游戏缺口仍在，不能宣称“CI 全绿 / 全站全部状态通过 / 原卡顿设备已修复”。

本记录任务仅创建并更新本文件和 `coverage.md`；不修改产品源码、更新日志、数据或配置，不提交、推送或部署，也不打开、切换、激活浏览器标签。浏览器操作与回归执行由主任务完成；本文依据实际产物及其完成结果摘要更新。

## 依据与追溯

| 产物 | 能支持的结论 | 不能支持的结论 |
|---|---|---|
| [direction.md](direction.md) | 已批准的“精密算法展厅”方向；45 个当前产品 HTML + 4 个旧版游戏入口；原 Hero 内容与顺序、独立平板布局、原数学场景及画质约束 | 方向写入文档不等于实现及视觉全部通过 |
| [coverage.json](coverage.json) / [coverage.md](coverage.md) | 49 条不重复路由；1440×900、390×844；light/day 与 dark/night 的初始布局；每页实际状态范围 | 门禁不等于登录工作区，初始画布不等于完整游戏或算法正确性 |
| [baseline-manifest.json](baseline-manifest.json) | 85 个基线文件的 SHA-256 与本机临时备份位置；本轮三张 `before/` 图片 | 临时备份位置不是可移植归档承诺，也不是 49 路由完整前后视觉矩阵 |
| [source-contracts.json](source-contracts.json) | 49 个页面的内联脚本、ID、链接契约；7 个冻结依赖；公告预览特定变更的前后哈希与边界说明 | 对应契约检查已实际通过；源码保留仍不等于实机/业务验证 |
| [motion.md](motion.md) | 当前动效、ScrollBus/GSAP 变换所有权、有限教学播放器、共享 reveal 的真实清理与恢复边界 | 不能替代连续性能、真实触摸、完整浏览器交互或减少动态效果视觉验收 |
| [设计系统 §9.3](../design-system.md#93-精密算法展厅) / [DESIGN.md](../../DESIGN.md) | 权威说明与源码提取快照；共享令牌仍以 `public/club-ui.css` 为真源 | 快照/文档不是第二套运行时规范，也不自动产生验收结果 |

旧轮次的 [验收](../design-upgrade-2026-11/acceptance.md)、[覆盖](../design-upgrade-2026-11/coverage.md) 及性能记录仅供历史追溯；旧轮次的通过项、计数、评分与性能数值均不自动转为本轮结果。

## 布局与截图范围

- 49 路由均有 **1440×900 日间 / 夜间、390×844 日间 / 夜间** 初始布局记录；[coverage.json](coverage.json) 四列均为无横向溢出，主题切换使用已确认的主题 API。记录不覆盖所有滚动深度、弹层、加载/错误/空态或长列表。
- 当前目录实际清点有 **3 张基线图、31 张 after 图**；包括新增英文、768×1024 平板尺寸与 1440×768 矮桌面代表图，尺寸已按文件核对。它们是代表画面，不是一条路由四张、也不是全站逐状态认证。
- 首页额外记录 Hero/实力章静态观察及真实“下一步”点击；主任务现已在英文界面用真实 GUI 逐一点击全部 **5 个标签**，确认状态文本各异，并真实点击 BFS 播放，观察到 **step 7/7 后自动停止**。此前自动化超时的缺口在这组真实点击范围内已补齐；计算/键盘/生命周期仍按 VM 通过记录，不扩大为全部真实键鼠端到端通过。
- 补充尺寸仅对应首页/实力章：**768×1024 与 1440×768 横向溢出均为 0**，不是 49 页新增两档矩阵或实机 iPad。浏览器无媒体偏好模拟能力，**reduced-motion 实际渲染仍未验证**，相关 VM/生命周期检查已通过。
- 逐路由真实状态、截图对应和未覆盖状态均列于 [coverage.md](coverage.md)。没有截图的路由仍可有布局测量，但不能据此补出视觉审阅结论。

代表截图索引：

| 画面 | 本轮产物 | 状态限制 |
|---|---|---|
| 首页 Hero | [暗色桌面](after/home-dark-1440.png)、[亮色桌面](after/home-light-1440.png)、[亮色手机](after/home-light-390.png)、[暗色手机](after/home-dark-390.png)、[英文暗色手机](after/home-en-dark-390.png) | 指定主题/语言/尺寸代表图，不扩大为全语言全设备矩阵 |
| 实力章 | [暗色桌面](after/capabilities-dark-1440.png)、[亮色桌面](after/capabilities-light-1440.png)、[暗色手机](after/capabilities-dark-390.png)、[英文亮色桌面](after/capabilities-en-light-1440.png)、[英文亮色 768×1024](after/capabilities-en-light-768.png)、[英文亮色 1440×768](after/capabilities-en-light-short.png) | 静态图与五标签真实点击/BFS 播放分别记证；平板/矮屏为有限补充 |
| 作品 / 成员 / 项目 / 活动 | [作品暗色](after/works-dark-1440.png)、[作品亮色](after/works-light-1440.png)；[成员暗色](after/members-dark-1440.png)、[成员亮色](after/members-light-1440.png)；[项目暗色](after/projects-dark-1440.png)、[项目亮色](after/projects-light-1440.png)；[活动暗色](after/activities-dark-1440.png)、[活动亮色](after/activities-light-1440.png) | 首页各章节代表图；活动桌面日夜图已替换，另有 [亮色手机](after/activities-light-390.png)，纳入限定独立复核 |
| 功能目录 | [暗色](after/directory-dark-1440.png)、[亮色](after/directory-light-1440.png) | 公开目录，不是所有目的页面的业务验收 |
| 图算法实验室 | [暗色](after/graph-dark-1440.png)、[亮色](after/graph-light-1440.png) | 初始算法控件/图形，不是算法运行全过程 |
| 首页加入章节 | [暗色](after/join-dark-1440.png)、[亮色](after/join-light-1440.png) | `index.html#join` 的加入说明/联系二维码，不是 `public/join.html` 申请表截图 |
| 社员中心 | [暗色桌面](after/member-dark-1440.png)、[亮色桌面](after/member-light-1440.png)、[亮色手机](after/member-center-light-390.png) | 游客登录入口，不是登录后个人中心/管理员表格 |
| Mock Chat | [暗色桌面工作区](after/chat-mock-dark-1440.png)、[亮色手机设置](after/chat-mock-settings-light-390.png) | 模拟身份/数据，设置经真实点击打开；无真实认证/上游 |
| 基线 | [首页](before/home-dark-1440.png)、[实力章](before/capabilities-dark-1440.png)、[社员中心](before/member-light-1440.png) | 三张局部对照，不是完整视觉基线 |

## 独立审查与修复证据

主任务转交的独立审查指出三项具体问题；修复代理标识为 `3ac5` / `fa52`，不是 Git 提交号。修复后替换目录/图算法/社员中心桌面日夜图、社员中心亮色手机图，以及活动桌面日夜图并新增活动亮色手机图。**独立复核已对这 10 张代表图给出通过，三项修复与活动详情 CTA 在此范围内关闭**；不推广全部页面/账号/设备，不虚构评分。

复核的 10 张：`directory-dark-1440.png`、`directory-light-1440.png`、`graph-dark-1440.png`、`graph-light-1440.png`、`member-dark-1440.png`、`member-light-1440.png`、`member-center-light-390.png`、`activities-dark-1440.png`、`activities-light-1440.png`、`activities-light-390.png`（均位于 `after/`）。

| 问题 | 当前修复证据 | 关闭范围与剩余核查 |
|---|---|---|
| 标题出现背景条、像被额外框住 | [club-ui.css](../../public/club-ui.css) 的 `.premium-head, .premium-section-head` 明确为透明背景，保留下沿分隔 | 目录/图算法等修复后代表图已获独立复核通过；仅关闭对应主题/状态中的背景条问题，不推广全部标题状态 |
| 社员中心外层门禁额外包覆，削弱内部登录卡片层次 | [member-center.html](../../public/member-center.html) 的 `body.club-page .auth-view.premium-gate` 使用透明背景、无外层投影；内部 auth shell/card 保留 | 桌面日夜/亮色手机游客入口复拍获独立复核通过；仅关闭外围材质问题，不证明身份认证或登录后表格通过 |
| 首页活动/公告把完整正文当成预览 | [index.html](../../index.html) 的 `getActivityExcerpt()` 限制 180 个 Unicode 码点，优先 summary；[home-showcase.css](../../public/home-showcase.css) 的 `.activity-excerpt` 限制三行；分类/状态/地点另列，保留双语“查看详情”及现有全文弹层路径 | [source-contracts.json](source-contracts.json) 记载有意变更的范围和前后哈希；完整正文仍由原详情路径提供；活动桌面日夜/亮色手机复拍及详情 CTA 获独立复核关闭，不宣称全部远端公告/语言/模态交互已实测 |

## Chat 的补充观察：模拟工作区，不是真实上游

主任务已补充检查 `public/chat.html` 的 **1440×900 暗色模拟工作区**，并在 **390×844 亮色通过真实设置按钮点击打开设置**；这两个特定观察状态的横向溢出均记录为 **0**。

这项证据比游客初始门禁多，但范围仍有限：模拟身份/数据不是真实登录；没有付费调用，没有调用上游模型服务；不验证真实发送、流式回复、扣额、附件、代理、权限及持久化链路。该补充也不转移给 `assistant.html` 或 `chat-admin.html`，不补成 Chat 四象限截图矩阵；本轮已有 [暗色桌面模拟工作区](after/chat-mock-dark-1440.png) 与 [亮色手机设置](after/chat-mock-settings-light-390.png) 两张截图。

## 源码与回归检查的状态

以下工具与当前实现/CI 有直接对应关系。**主任务已确认下表全部列名回归检查实际执行通过**，包括共享回归、首页教学/页面契约/reveal、场景启动/生命周期/数学等价、UI token 与资源版本检查；不是待执行清单。本记录任务不重复执行，亦不把 VM 测试冒充真实浏览器验收。独立列出的 club-drive 旧包检查仍失败，整体不能宣称 CI 全绿。

### 主任务已反馈的实际检查与重要失败

- `node tools/build-chat-dashboard-bundles.mjs --check`：Chat 与 Chat API proxy 两个包一致性通过，随后在 [docs/chat-deployment/club-drive-dashboard-index.ts](../chat-deployment/club-drive-dashboard-index.ts) 报 **stale**，因此该命令整体失败；不得写作“CI 全绿”。脚本在失败处抛错，后续 SQL 副本检查也不能据此声称已运行。
- 只读代理核对证明：构建器、相关源文件和现存输出在 HEAD 与工作区相同；过期状态至少在 2026-10-23 的既有提交状态中已存在，与本轮前端改造无关（主任务转交的追溯摘要）。本记录不修改后端或重建该包，保留此可追溯阻塞，不能为了报告通过掩盖它。
- 主任务已生成 58 条更新日志并重建训练模型；训练产物重建后无 Git 内容差异。主任务反馈训练策略/政策检查通过；这些结果来自主任务执行，不是本记录任务新做的源码或数据修改，也不等于完整游戏验收。
- 下表列名回归现已由主任务实际执行并确认通过；该通过范围不包含上述失败的部署包命令，也不包含不可用的真实账号/设备/完整游戏验收。

| 检查组（主任务实际通过） | 已执行入口 | 证据边界 |
|---|---|---|
| 教学与页面保真 | `node tools/test-home-capabilities.mjs`；`node tools/test-premium-page-contracts.mjs` | 本地计算/VM 与 49 页面、7 冻结依赖源码契约；不是视觉或登录业务认证 |
| 共享 UI / 主题 / 生命周期 | `node tools/check-ui-tokens.mjs`；`node tools/test-theme-system.mjs`；`node tools/test-club-common.mjs`；`node tools/test-club-shell-interactions.mjs`；`node tools/test-club-reveal-lifecycle.mjs`；`node tools/test-club-launcher-favorites.mjs` | 令牌、源码及模拟 DOM/生命周期断言；不能替代全部真实键鼠/触摸操作 |
| 首页原场景 | `node tools/test-home-scene-startup.mjs`；`node tools/test-scene-lifecycle.mjs`；`node tools/test-scene-field-equivalence.mjs` | 启动/生命周期与对应数学采样；不证明全部 GPU 像素、整机负载或受影响设备恢复 |
| Chat / 助手 | `node tools/test-chat-core.mjs`；`node tools/test-chat-thinking.mjs`；`node tools/test-chat-admin.mjs`；`node tools/test-assistant-launcher.mjs`；`node tools/test-assistant-knowledge.mjs` | 模拟/源码回归；不能转写为付费上游或真实身份测试 |
| 页面与资源 | `node tools/test-club-donations-page.mjs`；`node tools/test-club-donations-ui.mjs`；`node tools/test-notifications.mjs`；`node tools/test-member-profile.mjs`；`node tools/test-error-pages.mjs`；`node tools/test-404-page.mjs`；`node tools/test-site-search.mjs`；`node tools/test-seo.mjs`；`node tools/test-brand-mark.mjs`；`node tools/test-pwa.mjs`；`node tools/test-i18n-dict.mjs`；`node tools/version-static-assets.mjs --check`；`node tools/test-asset-versions.mjs`；`git diff --check` | 本组列名检查实际通过；资源引用/安全契约通过仍不能填补真实业务及全语言视觉覆盖 |

以上通过项与预存 club-drive bundle 失败同时保留；不为使报告“全绿”改写检查含义，不将源码/VM 回归扩展成未执行的业务、设备与视觉验收。

## 性能：当前桌面前台采样已完成

实际产物：[本轮 performance.json](performance.json)。本地 HTTP 首页 `home` 章，**1440×900、dark、前台**；环境为 Windows x64 / ZCode 3.16.3 / Chromium 146.0.7680.80 / Electron 41.0.3。请求为 330000ms，**实际完成窗口 330002.5ms**（约 5 分 30 秒），`finished=true`。读取时经过的 341493.6ms 不是采样时长，不扩大为更长测试。

| 实际记录项 | 本轮结果与解释 |
|---|---|
| RAF 回调计数 | **79153 帧回调**；每 30 个保留一个间隔，共 **2638 个 retained 样本** |
| retained 间隔 | **p50 4.2ms / p95 4.3ms / p99 4.4ms / sampled max 6.6ms**；最大值仅为保留样本最大，不是全部帧最大 |
| 长任务与可见性 | 窗口内未记录长任务，**hiddenEvents=0**；无导航、主题或视口变化。观察器从采样开始安装，不覆盖初始导航/着色器编译前段 |
| 结束画布实值 | `algorithmScene` 与 `shaderField` backing 均为 **1440×900**，client 均为 **1430×900**；产物另列其余画布，不把所有画布概括为同尺寸 |
| 质量 API | API 返回 **tier=high、pixelRatio=1.15**；API 字段**不是实测画布像素倍率证明**，不能写成实际场景/场按 1.15 倍渲染 |

帧回调间隔不是 GPU 提交/呈现时间、输入延迟或整机响应度。以上只支持**当前桌面、指定首页暗色前台稳态窗口**的观察；没有同设备本轮升级前基线，不声称相对提速，不外推全部章节、手机或其他 GPU。**原受影响设备不可用，其五分钟后卡顿问题仍未验证或排除。**

[方向](direction.md)与[动效说明](motion.md)要求不靠降低几何、粒子、采样或质量策略换取成绩；冻结 `SceneDirector.js` 的契约与已通过的场景回归是源码侧护栏，不是连续实测全部质量档位或原设备恢复的证据。

## 素材来源与复用

真实素材清单沿用实际存在的 [docs/design-upgrade-2026-11/assets.md](../design-upgrade-2026-11/assets.md)；仓库没有需要另造的 `docs/design-upgrade/assets` 目录。本轮首页继续复用三张真实 WebP，不把它们描述成新增生成图或新的对局验收。

| 本轮实际引用 | 来源与处理 | 不可误用为 |
|---|---|---|
| [gomoku-match.webp](../../public/assets/showcase/gomoku-match.webp) | 本地实验页 V9 黑 / V9Pro 白真实盘面，原棋盘区域裁切并缩放/压缩到 720×720；未添加棋子，原始图来源路径见素材清单 | 棋力验收、计分、训练上传或新一轮完整对局证据 |
| [tetris.webp](../../public/assets/showcase/tetris.webp) | 本站 AI 演示界面，裁切/缩放到 620×720，保留盘面、得分、下一块；演示明确不写排行榜 | 排行榜成绩或完整游戏验证 |
| [snake.webp](../../public/assets/showcase/snake.webp) | 本站初始蛇与苹果盘面，裁切/缩放到 720×720 | 已完成游玩或新生成的游戏记录 |

旧空盘 `gomoku.webp` 保留为历史素材记录，当前首页三张作品预览不引用它。成员头像、联系二维码沿用真实既有资源；没有购买或调用付费图片/上游生成服务。素材来源文档记录了本机原始截图位置；该本机路径本身不保证其他机器可访问。

## 明确保留的未验证项

| 范围 | 本轮状态 |
|---|---|
| 真实登录、社员数据表、管理员列表/表单、权限切换、保存/删除/导出 | 真实账号与相应可验证数据状态不可用；**未验证**。门禁与模拟 Chat 不能代替 |
| `file://` / 离线页面及 Worker 路径 | 本轮未执行；**未验证**，历史支持承诺不能补证 |
| 真实 iPad / Safari / 触摸键盘 | 无实机证据；**未验证**。桌面视口及旧轮平板截图不等价 |
| 原受影响设备及整机卡顿复现 | 无该设备本轮记录；**未验证**。已完成的当前桌面采样不替代原设备复现 |
| 五子棋换色完整对局、重放/资源指纹、其他游戏完整流程 | 本轮未提供；**未验证**。初始布局和历史素材不能替代 `complete=true` 验收 |
| 全语言、全部断点、全部弹层与加载/空/错误态 | 未完成全状态矩阵；**未验证**。英文五标签/播放及指定手机/平板尺寸仅覆盖本文登记范围 |
| reduced-motion 实际渲染 | 浏览器没有媒体偏好模拟能力，**实际渲染未验证**；对应 VM/生命周期检查通过，二者不能替代 |
| 限定复核之外的全范围视觉认证 | 三项修复及活动详情 CTA 已在 10 张代表图中独立复核关闭；**不等于**全页面/全部状态复拍认证 |

列名回归、限定独立复核与当前桌面性能观察现已完成，结论为“限定范围验收通过”。预存 bundle 失败与不可用/未验证状态继续公开保留，不授予全站、全账号、全设备无保留发布认证。
