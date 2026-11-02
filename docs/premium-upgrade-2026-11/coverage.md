# 精密算法展厅 · 逐路由覆盖与状态边界

日期：2026-11-01。原始记录：[coverage.json](coverage.json)；方向：[direction.md](direction.md)；结论、已完成复核与保留限制：[acceptance.md](acceptance.md)。

## 怎么读这份清单

本轮范围为 **49 个不重复路由 = 45 个当前产品 HTML + 4 个根目录旧版游戏入口**。每个路由均记录以下四种条件下的初始布局观察：

| 列 | 视口与主题 | `L` 的含义 |
|---|---|---|
| 桌面日 | 1440×900，light/day | 该页下述初始状态已测量，无横向溢出；主题 API 已确认 |
| 桌面夜 | 1440×900，dark/night | 同上，不增加登录/业务/完整视觉状态范围 |
| 手机日 | 390×844，light/day | 浏览器手机尺寸，不是实机手机或 iPad 验收 |
| 手机夜 | 390×844，dark/night | 同上，不代表该状态另有截图或全部触摸交互通过 |

**49 × 4 = 196 条初始布局观察，不是 196 份视觉认证。** `L` 不是“全页面视觉通过”，也不代表点击、提交、加载完成、权限分支、长数据表或完整游戏通过。原始 JSON 的浏览器记录没有逐格数值日志；这里只忠实转述其“无横向溢出”结论，不补造像素测量值。Chat 的两个补充状态另有主任务报告的 overflow=0，单独列出。

所有“未覆盖”均指本轮尚无相应证据，不推断功能本身失效。静态源码/VM 测试与真实浏览器操作分开记录。`coverage.json` 不被本次文档任务修改；后续补充观察在本文明确注明来源与范围。

## 1. 首页、错误页与公开阅读/目录（13 路由）

| # | 路由 | 桌面日 | 桌面夜 | 手机日 | 手机夜 | 实际状态范围 | 不在此项覆盖内 |
|---|---|---|---|---|---|---|---|
| 1 | `index.html` | L | L | L | L | Hero/章节代表图；真实下一步；英文全部 5 标签真实点击、状态各异，真实 Play BFS 至 step 7/7 自动停止；指定 768×1024 / 1440×768 溢出 0；当前桌面前台采样已完成 | 计算/键盘/生命周期按 VM 通过记录，不等于全部真实键鼠；全章节×主题×语言×尺寸、原受影响设备及 reduced-motion 实际渲染未验证 |
| 2 | `404.html` | L | L | L | L | 初始错误界面、错误页外层样式 | 服务器真实 404 路由、动态错误配置、全部文案/操作状态 |
| 3 | `bad-gateway.html` | L | L | L | L | 初始错误界面、错误页外层样式 | 真正上游 502 故障、重试成功与恢复链路 |
| 4 | `service-unavailable.html` | L | L | L | L | 初始错误界面、错误页外层样式 | 真正维护/503 故障、服务恢复、动态配置分支 |
| 6 | `public/appmonitor.html` | L | L | L | L | 公开 APPMonitor 目录/版本展示主界面 | 所有动态版本状态、真实下载及外站资源可用性 |
| 8 | `public/changelog.html` | L | L | L | L | 公开更新日志主内容/标题初始布局；无提交操作 | 全部历史条目展开、网络失败/弱网/离线兜底及全语言矩阵 |
| 11 | `public/club-features.html` | L | L | L | L | 公开功能目录主界面；桌面日夜修复后截图已替换并获独立复核通过 | 全部目的页业务状态、收藏/搜索所有真实交互分支 |
| 18 | `public/events.html` | L | L | L | L | 公开活动/公告主界面与标题；未提交业务数据 | 日历/列表全部交互、报名、远端长公告、登录后状态 |
| 23 | `public/guide.html` | L | L | L | L | 公开指南/阅读主界面 | 全部内容与语言、长文滚动、全部链接目的流程 |
| 26 | `public/join.html` | L | L | L | L | 公开申请表单初始布局；未提交申请 | 真实提交、校验/失败/成功态、后端保存；`after/join-*` 是首页章节而非本路由截图 |
| 35 | `public/password-reset.html` | L | L | L | L | 公开重置密码请求/表单初始界面；未提交 | 真实密钥、邮件/账号、重置成功/失败及登录恢复 |
| 40 | `public/search.html` | L | L | L | L | 搜索主界面/表单初始布局；未提交 | 真实查询、长结果/无结果/错误态、所有结果链接 |
| 45 | `public/visualization-lab.html` | L | L | L | L | 公开实验室目录主界面 | 所有子实验交互、算法正确性及所有语言/长内容状态 |

编号沿用 `coverage.json` 的原始顺序，分组不改动路由总数。

## 2. 社员、资源与登录门禁（10 路由）

| # | 路由 | 桌面日 | 桌面夜 | 手机日 | 手机夜 | 实际状态范围 | 不在此项覆盖内 |
|---|---|---|---|---|---|---|---|
| 12 | `public/donations.html` | L | L | L | L | 游客门禁 / 标题外壳 | 真实社员捐赠表、管理员表单、二维码管理、检索/导出/权限 |
| 15 | `public/drive.html` | L | L | L | L | 游客门禁 / 标题外壳 | 登录后文件列表、传输、目录操作、配额/邀请及 WebDAV |
| 28 | `public/member-center.html` | L | L | L | L | 游客登录表单；桌面日夜/亮色手机图已替换，外层门禁材质修复获独立复核通过 | 真实注册/登录、身份绑定、个人中心/积分表、所有注册标签状态 |
| 29 | `public/member-checkin.html` | L | L | L | L | 游客门禁 / 标题外壳 | 真实签到兑换、课程/待审/记录表与管理员操作 |
| 30 | `public/member-messages.html` | L | L | L | L | 游客门禁 / 标题外壳 | 登录后留言列表、发送/编辑/删除及审核权限 |
| 31 | `public/member-points.html` | L | L | L | L | 游客门禁 | 真实积分表、管理员编辑、刷新/分页及长名单 |
| 32 | `public/member-profile.html` | L | L | L | L | 游客门禁 | 真实资料卡、积分/捐赠/对局/签到、隐私与设置保存 |
| 34 | `public/notifications.html` | L | L | L | L | 游客门禁 / 标题外壳 | 真实通知列表、筛选、全部已读/单条已读及跳转 |
| 37 | `public/points-mall.html` | L | L | L | L | 游客门禁 / 标题外壳 | 登录后商品列表、兑换、库存/积分变化与权限分支 |
| 38 | `public/resources.html` | L | L | L | L | 游客门禁 | 已授权资源正文、PDF/外部下载、真实绑定与权限 |

**门禁布局不验收门后的表格。** 本轮没有可据以认证这些真实账号工作区的授权与数据证据；模拟 Chat 也不能填补本组缺口。

## 3. 管理入口（7 路由）

| # | 路由 | 桌面日 | 桌面夜 | 手机日 | 手机夜 | 实际状态范围 | 不在此项覆盖内 |
|---|---|---|---|---|---|---|---|
| 5 | `public/admin-hub.html` | L | L | L | L | 游客授权门禁 | 真实管理员统计/权限/站点配置/重置/绑定表及写操作 |
| 9 | `public/chat-admin.html` | L | L | L | L | 游客授权门禁 | 已登录服务商/模型/配额/访问名单/用量与知识库管理；未调用上游 |
| 14 | `public/drive-admin.html` | L | L | L | L | 游客授权门禁 | 真实配额列表、用户用量与配置保存 |
| 17 | `public/events-admin.html` | L | L | L | L | 游客授权门禁 | 公告/活动编辑、报名列表与发布/删除 |
| 25 | `public/join-admin.html` | L | L | L | L | 游客授权门禁 | 真实申请表、搜索/导出/刷新及权限变化 |
| 27 | `public/mall-admin.html` | L | L | L | L | 游客授权门禁 | 商品与兑换表、库存/价格编辑、真实写入 |
| 33 | `public/members-admin.html` | L | L | L | L | 游客授权门禁 | 真实成员名单、头像/排序/介绍编辑、发布/导出 |

本组仅授权门禁布局有四档观察。源码测试即使通过，也不能写作真实管理员表格视觉或 CRUD 流程已验收。

## 4. Chat、助手与当前游戏（7 路由）

| # | 路由 | 桌面日 | 桌面夜 | 手机日 | 手机夜 | 实际状态范围 | 不在此项覆盖内 |
|---|---|---|---|---|---|---|---|
| 7 | `public/assistant.html` | L | L | L | L | 初始 UI / 外壳 | 真实身份、助手工作区全部状态、知识检索/回复、上游服务；不继承 Chat 补充观察 |
| 10 | `public/chat.html` | L | L | L | L | 原始四档初始 UI；主任务另检查 1440×900 暗色模拟工作区及 390×844 亮色真实点击设置，见下表 | 真实登录、上游/付费、发送/流式/附件/扣额/持久化与完整四档工作区矩阵 |
| 19 | `public/gomoku-experiments.html` | L | L | L | L | 初始对战 UI / 控件 | 模型双方完整换色对局、倒计时全过程、重放/资源指纹；实验不上传不计分的策略另验 |
| 21 | `public/gomoku.html` | L | L | L | L | 初始棋盘 / 模型控件 UI | 完整人机/模型对战、全部版本黑白落子、计分/上传/排行榜端到端 |
| 36 | `public/platformer.html` | L | L | L | L | 初始 UI / 登录或游戏外壳 | 真实账号、完整关卡、移动触控、PK 联机/经济与排行榜 |
| 41 | `public/snake.html` | L | L | L | L | 初始游戏 UI / 棋盘外壳 | 完整人机局、暂停/结束/投降、触控与计分/排行榜 |
| 43 | `public/tetris.html` | L | L | L | L | 初始游戏 UI / 棋盘外壳 | 完整游玩/AI 对战、结束/投降、移动操作及计分/排行榜 |

### Chat 的额外状态观察

这两项来自主任务的真实浏览器操作摘要，现有两张本轮截图对应下述状态；本次文档任务未重新打开页面，不扩大为四档工作区/所有弹层认证。

| 路由 / 条件 | 实际观察 | 结果与边界 |
|---|---|---|
| `public/chat.html` · 1440×900 · dark | 使用模拟身份/数据展示主工作区；[截图](after/chat-mock-dark-1440.png) | 主任务记录横向溢出 **0**；不是生产身份/真实上游验证 |
| `public/chat.html` · 390×844 · light | 在模拟工作区通过**真实设置按钮点击**打开设置；[截图](after/chat-mock-settings-light-390.png) | 主任务记录横向溢出 **0**；仅该设置状态，不代表所有弹层或手机主题组合 |

没有付费请求，没有上游模型调用；模拟工作区与真实认证、真实回复链路必须分开。没有把这两项扩展给 `assistant.html` 或 `chat-admin.html`。

## 5. 算法实验室初始状态（8 路由）

| # | 路由 | 桌面日 | 桌面夜 | 手机日 | 手机夜 | 实际状态范围 | 不在此项覆盖内 |
|---|---|---|---|---|---|---|---|
| 13 | `public/dp-lab.html` | L | L | L | L | 初始控件、项目/公式/表格区域 | 算法运行/逐步/重置、自定义输入、完整 DP 表、错误与结束态 |
| 16 | `public/ds-lab.html` | L | L | L | L | 初始结构选择、控件与图示 | 所有结构增删查、动态树/列表、非法输入及结束态 |
| 20 | `public/gomoku-satori-lab.html` | L | L | L | L | 初始回放/分析控件与图示 | 战术演示、实时对战、证明树/回看全过程及 HTTP/file 双侧验证 |
| 22 | `public/graph-lab.html` | L | L | L | L | 初始图/矩阵和算法控件；桌面日夜修复后图获独立复核通过 | 所有算法/预设运行、逐步最短路、输入错误与完成结果 |
| 24 | `public/heap-lab.html` | L | L | L | L | 初始数组/树形区域与控件 | 插入/排序等操作全过程、自定义数组、逐步和错误状态 |
| 39 | `public/search-lab.html` | L | L | L | L | 初始搜索/迷宫图示与控件 | 各算法、随机/自定义迷宫、遍历全过程及无路径状态 |
| 42 | `public/sorting-lab.html` | L | L | L | L | 初始排序柱形图与控件 | 各算法运行、自定义数据、逐步/重置、完整统计与结束态 |
| 44 | `public/tree-lab.html` | L | L | L | L | 初始树形图、模式与操作控件 | 全部树算法/字典/增删、缩放、逐步及自定义/错误状态 |

上表为 **8 个独立实验室路由**；首页教学播放器仍只计入 #1，章节锚点不另计路由。初始控件可见与无横向溢出，不等于算法交互与所有结果状态已验证。

## 6. 根目录旧版游戏（4 路由）

| # | 路由 | 桌面日 | 桌面夜 | 手机日 | 手机夜 | 实际状态范围 | 不在此项覆盖内 |
|---|---|---|---|---|---|---|---|
| 46 | `俄罗斯方块.html` | L | L | L | L | 旧版初始 UI / 画布外层 | 固定画布配色保留，不声称每个画布像素随主题切换；完整游戏/键鼠/结束态未验 |
| 47 | `俄罗斯方块AI.html` | L | L | L | L | 旧版初始 UI / AI 控件外层 | 固定画布配色保留；AI 自动/逐步/对战、完整游戏与性能未验 |
| 48 | `贪吃蛇.html` | L | L | L | L | 旧版初始 UI / 画布外层 | 固定画布配色保留；完整游戏、暂停/重置、触摸与结算未验 |
| 49 | `贪吃蛇专家系统.html` | L | L | L | L | 旧版初始 UI / 专家外层 | 固定画布配色保留；专家决策全过程、完整游戏与性能未验 |

## 代表截图与路由映射

当前实际清点有 31 张 `after/` 图和 3 张 `before/` 图，均为代表性产物。文件数不等于路由数；多个首页章节仍只属于一个 `index.html`。

| 文件组 | 真正对应的路由 / 状态 | 可用主题与尺寸 |
|---|---|---|
| `after/home-*.png` | `index.html#home` Hero | dark/light 1440×900；dark/light 390×844；另有英文 dark 390×844 |
| `after/capabilities-*.png` | `index.html#capabilities` 教学章 | dark/light 1440×900；dark 390×844；另有英文 light 1440×900、768×1024、1440×768 |
| `after/works-*.png` | `index.html#gomoku` 作品章 | dark/light 1440×900 |
| `after/members-*.png` | `index.html#members` 成员展示章 | dark/light 1440×900；不是 `members-admin.html` |
| `after/projects-*.png` | `index.html#projects` 项目章 | dark/light 1440×900 |
| `after/activities-*.png` | `index.html#activities` 活动预览章 | 修复后 dark/light 1440×900 及 light 390×844；不是 `events.html` 全状态 |
| `after/join-*.png` | **`index.html#join` 首页加入/联系二维码章** | dark/light 1440×900；不是 `public/join.html` 申请表截图 |
| `after/directory-*.png` | `public/club-features.html` 公开功能目录 | dark/light 1440×900 |
| `after/graph-*.png` | `public/graph-lab.html` 初始图算法界面 | dark/light 1440×900 |
| `after/member-dark-1440.png`、`after/member-light-1440.png`、`after/member-center-light-390.png` | `public/member-center.html` 游客登录入口 | dark/light 1440×900；light 390×844 |
| `after/chat-mock-dark-1440.png`、`after/chat-mock-settings-light-390.png` | `public/chat.html` 模拟工作区/真实点击设置 | dark 1440×900 工作区、light 390×844 设置；不含真实认证/上游 |
| `before/home-dark-1440.png`、`before/capabilities-dark-1440.png`、`before/member-light-1440.png` | 对应首页 Hero、实力章、社员游客入口基线 | 三张局部基线，不是完整前后矩阵 |

截图入口与修复证据详见 [acceptance.md](acceptance.md#布局与截图范围)。独立审查指出标题背景条、社员外层门禁、公告全文预览，代理 `3ac5` / `fa52` 已修复到源码。主任务已收到 **10 张修复后代表图复核通过**：目录 2 张、图算法 2 张、社员中心 3 张、活动 3 张；三项修复与活动详情 CTA 在此范围内关闭，不扩展为全站所有状态认证。素材来源见实际存在的 [上一轮 assets.md](../design-upgrade-2026-11/assets.md)，首页复用真实 `gomoku-match.webp`、`tetris.webp`、`snake.webp`，不是新的完整游戏证据。

## 首页补充交互、尺寸与已完成性能观察

| 补充范围 | 已完成证据 | 仍不覆盖 |
|---|---|---|
| 英文实力章标签 | 主任务真实 GUI 逐一点击全部 **5 个标签**，确认状态文本各异；此前自动化超时不再代表这组真实点击未验证 | 全键盘 E2E、全部输入/算法情形不能由点击样例推出；对应 VM 检查已通过 |
| BFS 播放 | 真实点击 Play，观察到 **step 7/7 并自动停止** | 不代表每种算法/每个标签的全部播放、暂停、恢复与异常分支均实际操作过 |
| 新增代表截图 | [暗色手机 Hero](after/home-dark-390.png)、[英文暗色手机 Hero](after/home-en-dark-390.png)、[英文亮色实力章桌面](after/capabilities-en-light-1440.png)、[英文亮色 768×1024](after/capabilities-en-light-768.png)、[英文亮色 1440×768](after/capabilities-en-light-short.png) | 指定首页/教学章而非新增全站矩阵；平板尺寸不是实机 iPad |
| 补充尺寸测量 | **768×1024、1440×768 横向溢出均为 0**，范围限上述首页/实力章观察 | 不外推其他 48 路由或全部滚动/浮层状态 |
| reduced-motion | VM/生命周期检查通过；浏览器不提供媒体偏好模拟能力 | **实际减少动态效果渲染未验证**，不能以 VM 通过填补 |
| 当前桌面性能 | [performance.json](performance.json)：1440×900 dark 首页前台，实际 **330002.5ms**；**79153** RAF 回调，每 30 个保留间隔，共 **2638** 样本；p50 **4.2ms** / p95 **4.3ms** / p99 **4.4ms** / sampled max **6.6ms**；窗口内无长任务，hiddenEvents=**0** | 当前桌面稳态限定观察；回调间隔不是 GPU/输入延迟，无升级前同设备基线，原受影响设备仍未验证 |
| 结束画质记录 | API tier=**high**；`algorithmScene`/`shaderField` 实际 backing **1440×900**、client **1430×900** | API `pixelRatio=1.15` **不证明实际场景缓冲按 1.15 倍渲染**，不能混同声明值与实测值 |

列名的共享回归、home-capabilities / premium-page-contracts / reveal、场景启动/生命周期/数学等价、UI tokens、主题与资源版本等检查现已由主任务实际执行通过，详见 [acceptance.md](acceptance.md#源码与回归检查的状态)，不再列为待执行。预存 club-drive bundle stale 检查仍失败，因此不宣称全部 CI 通过。

## 覆盖对账与范围外

| 分组 | 不重复路由数 |
|---|---|
| 首页、错误页、公开阅读/目录 | 13 |
| 社员、资源与登录门禁 | 10 |
| 管理入口 | 7 |
| Chat、助手与当前游戏 | 7 |
| 独立算法实验室 | 8 |
| 根目录旧版游戏 | 4 |

**最终对账：13 + 10 + 7 + 7 + 8 + 4 = 49 条不重复路由**，与 `coverage.json` 逐条对应；每条四个 L，共 196 个初始布局观察。没有把锚点、截图或模拟状态增加为新路由。

原始记录明确排除：`public/gomoku-models/*.html`（冻结隐藏引擎依赖）、`Past-Gomoku-Model/`、`tools/`、`docs/`、`gsap-skills-main/examples/`。排除出 UI 路由覆盖不代表冻结依赖可以被改动；另由源码契约约束。

真实身份与管理员/社员表格、`file://`、真实 iPad、原受影响设备、完整游戏、全语言/断点/加载/错误/空态矩阵及 reduced-motion 实际渲染仍为**不可用或未验证**。本轮 [performance.json](performance.json)、列名回归与限定独立复核均已完成，并保持各自证据范围；预存 club-drive bundle stale 失败继续公开。当前结论为**限定范围验收通过，不是全站/全账号/全设备无保留发布认证**。
