# 液态玻璃升级 · 本地验收记录

## 已完成实现

- 原Hero不改文案/链接/按钮顺序，通过CSS重新构图为既有1200px章节容器内的完整横向玻璃面板。左侧品牌，右侧社团归属、快捷地址、介绍与操作；删除空占位列的显示。手机720px以下堆叠，独立短屏规则保留内容可达。
- 共享卡片与显式主面板采用20px圆角、16px/1.3磨砂、镜面边缘和结构性阴影；按钮12px圆角、光泽、语义主次/危险/禁用/焦点反馈。首页材质为24px圆角、16px/1.12；独立界面保留各自材质作用域。
- 新增独立自启动 club-liquid-lighting.js，49个可见HTML均单次defer接入。仅精确悬停鼠标追光；事件委托、单帧合并、每次只读取当前目标一次矩形、无空闲RAF。触摸/笔、隐藏、失焦、取消及减少动态/透明偏好有回退。
- Chat、助手与启动球、聊天管理、平台游戏外围、旧版游戏、错误页和运行时浮层均有适用材质。密集内容、表格/代码/表单正文与盘面保持实底。
- 功能页实际看图发现并修复主入口双层底板和卡片无行距；主入口子链接透明、外框单层采样、卡片行距16px。另修复页面内联hover背景简写清除指针光斑的覆盖问题。

官方参考及可实现边界见 [references.md](references.md)，当前材质数值见 [materials.md](materials.md)。这是网页CSS实现的磨砂/镜面/局部光照，不声称获得Apple原生光学材质。

## 浏览器证据

[coverage.json](coverage.json) 包含49路由，全部以主题API检查1440×900、390×844的dark/light初始布局，共196项观察，横向溢出为0，lighting全局已加载。统计包括隐藏节点上的材质标记，不能当作同时可见采样层数。

[截图索引](screenshots.json) 保存14张代表画面：2000px首屏及光斑、1440/390首屏、功能卡片、图论、个人中心和模拟Chat。截图是代表视觉证据，不是196份逐画面认证。首页代理还检查了768×1024和1440×600，以及英文较长内容，无横向溢出；该补充与真实iPad实机验收分开。

鼠标实际操作证据：首页2000px局部光照active=1、坐标随指针更新；最终首页主按钮和成员卡片均实际悬停验证，computed background-image包含主题radial-gradient，移出后active归零；功能卡片最终版本active=1且computed background-image包含以元素内坐标为中心、alpha=.11的品牌色radial-gradient。功能页外框blur16px/saturate1.3，内层链接透明无阴影。Chat真实设置按钮可打开抽屉；390px浅色设置无横向溢出。Chat为本地模拟账号/数据，无付费或真实模型调用。

截图中的助手球曾由测试拖到内容处；已通过真实拖动移回边角，不据旧截图位置推断默认位置。首页手机访问提示为既有可关闭提示，部分截图保留其打开状态。

独立视觉复核结论另见 [finish-review.md](finish-review.md)。最终性能只以 [performance.json](performance.json) 的本轮已完成记录为依据。

## 实际测试

本轮通过：

- test-club-liquid-lighting：实际控制器自启动、单次安装、静止无RAF、事件合并、动态插入/重挂/属性变化、父子目标、隐藏/取消/返回/媒体变化与缺能力回退，业务点击不变。
- test-club-shell-interactions、test-club-reveal-lifecycle、test-home-capabilities、test-premium-page-contracts、check-ui-tokens。
- test-club-common、test-club-share、test-error-pages、test-assistant-launcher、test-chat-core、test-chat-admin（179模拟请求）、test-theme-system、test-i18n-dict。
- test-home-scene-startup、test-scene-lifecycle、test-scene-field-equivalence（2592点、2592组法线、648光线，最大绝对误差0）、test-seo、test-pwa。
- build-gomoku-training-model及脚本/模型语法；产物无内容差异。后端、模型、训练目录未修改。
- version-static-assets/test-asset-versions：37项哈希资源、581处引用一致；新增lighting测试纳入CI定义。更新日志源重建为59条快照。git diff --check通过，只有已有LF/CRLF提示。

测试入口均为tools/下相应.mjs。代理另执行CSS解析/属性语法和各自作用域检查；既有@view-transition navigation:auto不被语法库认识，未当作新增错误。风格检测有历史及与用户钉定材质冲突的提示，不声称所有风格lint全绿。

## 保留边界

真实管理员/社员完整业务状态、真实触屏键盘/iPad/Safari、file://、减少偏好的实机渲染及原受影响设备卡顿仍未验证。源码与VM回退不代替这些状态。游戏仅验证原脚本保留和外围UI；没有声称完整换色棋力验收。

上一轮已核实的仓库既有 club-drive-dashboard-index.ts stale 整包检查失败仍保留，本轮未修改后端生成包，不宣称全部远端CI绿灯。

所有修改均在本地；没有提交、推送、部署或数据库操作。已有3D/章节/业务/权限/模型规则保持保护契约。
