# 算法精密展馆 · 本地实施与有界验收

日期：2026-11-02。

**状态：本地实现完成，源码与离线回归通过；完整视觉与持续性能验收未闭环。** 未提交、推送、部署或修改数据库。

## 实施结果

- 首页保留原 Hero DOM、文字、链接与 CTA 顺序；品牌和数学场景在上，介绍与操作由下方金属功能台承托。七章分别采用算法展桌、主副作品、成员主位、项目条目、活动时间线和加入收束。未修改原场景、粒子、章节引擎或画质策略。
- 共享 `club-ui.css` 区分 opaque metal/read/inset/control 与 selective glass。普通卡片/阅读/表单/分析不再因指针标记自动采样；登录外壳、精选展品与浮动 chrome 保留玻璃。暗色冷金属、亮色暖中性。
- 33 个 public 页面修改了页内样式/视觉类，platformer 只改 STYLE；其余可见入口继承共享或独立界面样式。具体范围见 [page-inventory.json](page-inventory.json)，不能把资源版本重写算成独立页面重设计。
- Chat、助手、聊天管理、旧版游戏外围与运行时浮层同步材质。游戏规则、模型、训练、积分、权限和后端保持保护边界。
- 分享浮层补齐 Tab/Shift+Tab 循环、关闭后 opener 恢复及语言重建清理。助手新增手机提示避让、功能目录边缘停靠/预留空间；动态启动器与样式继承版本参数，启动器 JS 纳入资源版本清单。

## 保护与回归

[code-review.md](code-review.md) 是独立源码审查，结论为有界通过。它发现的亮色 Hero 优先级问题已修复：布局选择器降低优先级，高优先级覆盖仅处理材质，手机断点可生效。审查后助手定位和动态缓存属于后续窄范围变更，由相关测试验证，不能扩大原审查指纹的范围。

最终执行通过：

- premium page contracts：49 页原内联脚本、ID、链接与 7 个冻结依赖。
- home capabilities：五项计算、双语、键盘、有限播放、原 Hero 与场景保护。
- liquid lighting、reveal lifecycle、shell interactions、share、assistant launcher、common、service realtime、error pages。
- theme、i18n、home scene startup、scene lifecycle、scene field equivalence、SEO、PWA。
- Chat core 与 Chat admin：179 次模拟请求，无付费或上游网络调用。
- UI tokens、语法检查、资源版本只读检查、`git diff --check`。后者仅有 LF/CRLF 提示，无空白错误。
- 最终资源版本为 **38 个资源、587 处引用**。
- 按仓库要求重建累计训练模型并检查构建脚本/产物语法；未产生训练模型差异，未改变训练期次或棋力。

活动页增加视觉类后，一项测试夹具的完整 body 字符串匹配失效；已改为提取 body 属性并保留必需 body 断言，原行为断言继续运行。分享测试夹具补齐浏览器 location 全局后通过。

## 浏览器覆盖

[coverage.json](coverage.json) 保存原始记录：**49 路由 × 4 主题/尺寸组合 = 196 次测量，另 32 次定点复查**。当前工作区预览使用已核验 CSS 的 4197；4186 的旧样式观测保留为 preliminary，不参与当前结果。

当前覆盖未测到横向溢出、缺失 lighting 或主题应用失败。它只验证初始布局/访客状态，不能代表账号工作区、真实权限写入或完整视觉通过。揭示动画在 IAB 中曾停在 currentTime 0；部分指引/Satori/捐赠/资源可见性读数不确定，捐赠截图及资源后续观测证明内容可以出现，未据此宣判产品回归。

[final-coverage-reconciliation.json](final-coverage-reconciliation.json) 将最终源码与 QA 快照核对。最终清单 **100/100** 匹配磁盘；但 QA 完成后有 57 个文件变化，包含全部 49 页 HTML。缺少历史 QA 字节，不能证明这些 HTML 只改了版本查询串。因此**不声称全部最终字节已重新浏览器验收**。49 页/56 段内联脚本及内容保护仍通过。

实际交互证据包括算法下一步、键盘 End/ArrowLeft 切换、局部鼠标坐标与移出归零、分享真实键盘循环与 Escape 恢复。未获得真实账号、实机 iPad/Safari、file:// 或原受影响设备验收。

## 视觉复核与修复

[截图索引](screenshots.json) 保存前后图及来源。首页桌面/手机双主题四张图为本轮截图；member 手机图早于最后的小幅间距收紧，不能认证其最终像素。实力章日间图另有保存。未完成七章双主题全部最终截图及英文/平板/短屏/大屏矩阵，不将代表图扩大为全站认证。

[finish-review.md](finish-review.md) 由通用代理代行独立 Impeccable finish-reviewer 完成，审查七张代表图。原结论为 **fix**：手机助手压访问提示按钮，功能目录助手压标题。

两处已实施修复并通过定位回归：

- 手机暗色实际测量：ball `(330,656,48,48)`，提示 `(9,715.9167,362,116.0833)`，间隔 **11.9167px**，overlap=false。
- 目录 1280px 实际测量：ball `(1214,818,54,54)`，内容右边界 `1164.3333`，间隔 **49.6667px**，页面横向溢出 0。

修复后重复取景均出现 `browser screenshot surface preparation timed out after 3000ms`，包括新标签尝试。故原复核者没有将两项视觉评分改为 resolved，也没有给 ship；**修复后视觉结论仍未验证**。截图文件保留修复前证据，不用旧图冒充新图。

机械检测保留在 [design-detector.json](design-detector.json)：564 条（495 advisory、69 warning），不报告为 clean。成员中心实际双主题对比度已由页面负责人复核，最低观测为 5.42:1；静态混合主题警告不等于实测通过全站。部分遗留字号、结构、光效启发式警告仍保留。

## 性能

[performance-contended.json](performance-contended.json) 保留并行浏览器操作期间的诊断采样；[performance.json](performance.json) 保留随后独占尝试。

独占尝试请求 330 秒，但发生页面隐藏和 RAF 暂停，超过请求时长仍未完成；连续鼠标命令也曾超时。回调间隔只描述实际执行的回调，不是 GPU 呈现时间。**没有有效持续性能通过结论，没有相对提速或原设备卡顿已解决的声明。** 不继承前轮性能数字，不以降低原 3D/翻页质量换取结果。

## 已观察但未扩大修改的事项

- Chat/assistant 访客状态缺少可见 semantic main。
- member-profile 访客门禁文案引用通知。
- 两个旧版 snake 页面有重复 H1。
- 登录后流程、真实设备/浏览器、完整最终字节矩阵和修复后截图/持续性能仍未验证。
- 既有后端生成包检查问题不属于本轮前端修复；不宣称全部 CI 通过。

设计说明已更新为 [DESIGN.md](../../DESIGN.md)、[design-system.md §9.5](../design-system.md) 与配对侧车。更新日志仍以 `public/data/changelog.json` 为唯一源，快照已重建为 60 条。
