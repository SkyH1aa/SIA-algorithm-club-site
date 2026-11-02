# 前端升级验收记录 · 2026-11-01

## 交付结论与边界

本轮已完成本地 UI、交互、首页前景构图与动效更新。用户指定的原 Hero 文案、CTA 顺序、链接和 APPMonitor 入口保持；Stage Track、深链接与四项统计删除，作品预览只在作品章。共享界面采用纯色表面和更清楚的文字层次，阅读、操作、探索页面区分密度。Chat、助手、平台游戏分别对齐外围样式。

这是有明确覆盖范围的本地交付，不是全站全部账号状态与设备的发布认证。没有 commit、push、部署或数据库操作。五子棋模型、权重、搜索参数、训练期次、积分和上传策略未因本轮 UI 改造而调整。

## 功能与源码验证

本轮执行并通过的相关检查：

- 首页：`test-home-scene-startup`、`test-scene-lifecycle`、`test-scene-field-equivalence`。等价测试包括 2,592 个场点、2,592 组六采样法线、648 条完整 42/64 步射线，最大绝对误差 0；这不等于逐 GPU 像素证明。
- UI：`check-ui-tokens`、`test-theme-system`、`test-club-common`、`test-club-shell-interactions`、`test-club-launcher-favorites`。
- 词典与资源：`test-i18n-dict`、`version-static-assets --check`、`test-asset-versions`。31 个哈希资源，125 个引用匹配。中文词典继续内联，英文按需加载。
- 助手与 Chat：`test-assistant-launcher`、`test-chat-core`、`test-chat-thinking`、`test-chat-admin`；管理员测试为 179 个模拟请求，零付费调用、零测试网络请求。
- 页面契约：`test-notifications`、`test-member-profile`、`test-club-donations-ui`、`test-club-donations-page`、`test-error-pages`、`test-404-page`、`test-site-search`、`test-seo`、`test-brand-mark`、`test-pwa`。
- 45 个内联脚本语法检查通过；`git diff --check` 通过，Git 另提示仓库已有的 LF/CRLF 转换规则。

捐赠页回归最初因测试未读取页面内 `DONATIONS_PAGE_DICT` 而失败；测试现合并页面真实注册的词典，并按语义链接验证新目录入口，保留原权限、安全、转义、主题和 SQL 契约断言。修复后通过。

共享交互测试已接入 CI。它覆盖显式路由分类、启动器模态焦点与开合竞态、收藏/语言刷新、活动标签页及减少动态效果；轻量 DOM 测试不能替代所有真实浏览器交互。

收尾修正作品焦点释放事件：有作品时发送 `kind: work`，离开/失焦/离页/换章时发送 `kind: none`，使既有 SceneDirector 回到默认焦点值，不更改渲染器。对实际处理器片段执行 VM 验证：指针离开、键盘焦点优先、blur、pagehide、章节释放均通过；随后重跑资源与首页三项回归通过。

按仓库要求重建训练模型并检查语法；产物没有内容差异。8 个历史目录仍保留，累计模型 83 局、V9 边界 22 局、Champion 全档案 166 局、Flash 102 局。未添加验收棋谱到训练目录。


## 视觉证据

`coverage.md` 是 41 个公开页面的实现覆盖清单，不是 41 页逐状态截图合格证。

已实际查看的代表截图：

| 画面 | 范围 |
|---|---|
| before/home-dark-1440.png | 首页对照基线 |
| after/home-dark-1440.png、home-light-1440.png | 桌面 Hero 亮暗 |
| after/home-light-390.png、menu-light-390.png | 手机 Hero 与展开菜单 |
| after/capabilities-dark-1440.png | 能力章与图结构 |
| after/works-dark-1440-fixed.png、works-dark-390-fixed.png | 修正后的桌面/手机作品预览 |
| after/features-dark-390.png | 手机功能目录 |
| after/labs-light-768-fixed.png、labs-light-768-end-fixed.png | 平板实验目录与末尾 |
| after/labs-light-768-en.png | 英文长文案/换行，词典加载完成后的实际画面 |
| after/guide-light-768.png | 阅读页 |

网页验收使用正式内置浏览器；未使用技能自带 Playwright/CDP 脚本绕过宿主能力。部分真实 click/press 自动化出现超时；能力标签点击有实际成功，部分键盘/菜单/章节状态另用页面事件验证。这些合成事件结果不冒充真实键鼠端到端通过。Chat 截图两次遇到宿主 capture/preparation 超时，完整登录工作区视觉矩阵没有通过本轮验收。

## 独立截图审查

官方 impeccable-finish-reviewer 不可用，使用只读 general-purpose 代理作为独立替代审查。初次审查覆盖九张代表图，给出 FIX → RECAPTURE；临时 MotionSites 评分平均 7.7/10，媒体集成 6.5/10，未达到其平均 8、最低 7 的门槛。此分数没有因修复而自动上调。

两项实质问题已修复并补拍：

1. 五子棋最大预览原为空盘。现引用真实实验页 V9/V9Pro 对局截图 `gomoku-match.webp`，显示黑白棋子与末手标记。仅裁切、缩放、压缩，无添加棋子；不计分、不上传，不作为棋力验证。
2. 768px 目录原右侧入口与悬浮助手竞争。≤900px 改为说明下方左对齐入口，补拍原区域与目录末尾。截图中助手处于已保存位置，不能据此宣称验证了所有默认/拖拽位置。

最终复核限定于四张 `*-fixed.png`，原两项问题在该范围内关闭；不扩展为全站、账号流程或动效性能认证。

## 持续运行与画质

完整机器可读记录见 `performance.json`。

本地 HTTP、1440×900、热加载环境：DOMContentLoaded 约 245.1ms。采样器在约 performance.now 2362.7ms 启动，持续请求帧 330000ms，之后停止；稍后读取时 elapsed 598696ms 不能写成十分钟采样。

- 帧计数 23244，每 30 帧保留一个间隔，共 774 个样本。
- retained 样本 p50 约 4.2ms，p95 约 4.3ms，最大约 17.3ms。
- hiddenSamples=0，读取时 document.hidden=false。
- 该观察窗口内 PerformanceObserver 未记录长任务；它不覆盖冷启动前段。
- 结束时质量策略 high、pixelRatio=1.15；两画布 backing 为 1655×1035，client 为 1430×900。画质不是全程连续记录。

帧回调间隔不是 GPU 渲染时间或输入延迟。没有依据将当前机器结果外推为用户此前整机五分钟卡顿已经修复。当前四技能升级没有改动 SceneDirector.js；主场景/启动调度与升级前源码对照保持，既有采样、几何、质量策略未为 UI 调整而降低。更早的启动修复另见 `../homepage-startup-performance-2026-11-01.md`。

## 保留的检查异常与未覆盖项

Taste lint 实际退出码 1：45 FAIL、14 WARN。分类包括 2 个等宽字体、8 个渐变、19 个阴影匹配（包含 none 声明）、15 个细边框、1 个 eyebrow，以及字体/玻璃/框体警告。四技能规则互斥，项目批准方向优先；用户钉定的 Hero eyebrow 明确保留，既有 3D/辅助动效及技术代码字体也不因通用风格禁令降质。尚未逐项消除这些历史/方向例外，所以不报告全绿。

仍没有完整证据的范围：全部七章节×主题×语言×尺寸、暗色手机 Hero、减少动态效果实际渲染、早晚动效帧对照、iPad 实机、file:// 浏览器、完整登录/社员/管理员状态、所有加载/错误/空态、手机 Chat/平台游戏视觉矩阵、原卡顿设备复现。英文已补拍实验目录，仍未完成全站英文矩阵。相关契约与源码检查通过不能填补这些视觉和设备证据缺口。

## 设计与素材文档

- `direction.md`：已批准方向与用户钉定内容。
- `motion.md`：章节、触发、打断、恢复和减少动态效果。
- `assets.md`：真实素材来源与处理。
- `coverage.md`：页面实施覆盖。
- `../../DESIGN.md` 与 `../../.impeccable/design.json`：提取快照/面板展示；权威约定仍为 `../design-system.md`，运行时令牌唯一真源仍为 `public/club-ui.css`。
