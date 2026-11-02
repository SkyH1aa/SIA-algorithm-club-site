# Precision gallery 独立代码审查

日期：2026-11-02。结论：**最终源码有界通过，未发现仍未解决的实质性前端回归**。审查期间发现一处亮色 Hero 响应式选择器优先级回归，同伴已修复，已复核实际文件。此结论是源码与离线测试结论，不替代正在进行的浏览器 QA。

## 范围与基线

- 仅比较本轮相对 `D:/GithubRcj/SIA-algorithm-club-site/docs/precision-gallery-2026-11/baseline.json` 指向的 `C:/Users/ASUS/AppData/Local/Temp/sia-precision-gallery-_xaz8_8q` 备份。清单中全部备份文件 SHA-256 与记录一致。没有用仓库 HEAD 的更大范围差异混充本轮变更。
- 重点检查 `public/home-showcase.css`、共享材质/控件 CSS、页面新增布局规则、运行时样式，以及稳定后的 `public/club-share.js` 焦点修复。无后端审查，无审美评价。
- 未打开或控制浏览器，未修改代码、运行构建或提交；唯一写入文件为本审查文档。测试均为离线/read-only 检查。

## 已修复的审查发现

### 亮色 Hero 的高优先级布局选择器压过移动端断点

初次审查时，`D:/GithubRcj/SIA-algorithm-club-site/public/home-showcase.css:915` 的 `html[data-theme="light"] .home-showcase .hero-copy` 同时声明布局、padding 与材质。其优先级为 `(0,3,1)`，高于后续响应式 `.home-showcase .hero-copy` 的 `(0,2,0)`。因此亮色下 `max-width:900px` 的单列网格及 `max-width:640px` 的 padding 不能覆盖桌面规则；同样问题出现在原第 925 行的 `::before`，压过移动端 inset。该问题可由级联规则直接确定，不依赖视觉偏好。

最终实际文件修复已复核：

- `D:/GithubRcj/SIA-algorithm-club-site/public/home-showcase.css:914` 与第 924 行的布局/伪元素规则使用 `:where(html[data-theme="light"])`，不再增加亮色分支的优先级。
- `D:/GithubRcj/SIA-algorithm-club-site/public/home-showcase.css:499`、第 610 行及第 697 行旧材质分组已移除 `.hero-copy`。
- `D:/GithubRcj/SIA-algorithm-club-site/public/home-showcase.css:931` 的高优先级规则仅含 `background`、`border`、`box-shadow`；第 934 行的伪元素覆盖仅含 `background` 和 `opacity`。它们覆盖 `theme.css:83` 与 `theme.css:541` 的全局亮色重要声明，同时不拥有网格、尺寸、padding 或 inset。
- `D:/GithubRcj/SIA-algorithm-club-site/public/home-showcase.css:1023` 的单列命名区域和第 1035 行的手机 padding，以及第 1016、1029、1039 行的 inset，仍可按后续断点覆盖。

状态：**已修复，无剩余阻断**。

## 有界通过的核对项

### 场景与业务保护

- `home-showcase.css` 从文件开头到 `/* Homepage content composition. */` 之前的场景/章节几何前缀逐字节一致；SHA-256：`92f4b62d468e495af917e26300047a52e410b99a6aecd8065e4a75a74e126039`。
- `index.html` 规范化资源版本参数后与本轮备份一致。清单 49 个页面共 56 段内联脚本保持一致；原有 ID、href 多重集合及去除 script/style 后的静态可见文本均保留。
- `SceneDirector.js`、`home-showcase.js`、`home-motion.js`、`home-capabilities.js`、`club-shell.js`、`club-liquid-lighting.js`、`theme.js`、`theme.css`、`i18n.js`、三份字典与 `sw.js` 均与本轮备份逐字节一致。
- `club-common.js` 正确剔除一处 `style.textContent` 样式模板后，其余源码与备份一致。`service-gate.js` 正确剔除两处模板（`pillStyle.textContent` 和 `style.textContent`）后，其余源码一致；没有把漏剔除的样式差异误报为业务变更。

### Hero 底板、英文与移动端

- `D:/GithubRcj/SIA-algorithm-club-site/public/home-showcase.css:926` 的底板为绝对定位的 grid 子项，`grid-area:3 / 1 / -1 / -1` 从 affiliation 行覆盖到显式网格末行，配合负 inset 扩展到内边距。没有另设固定底板高度，也不参与正常流的行高计算；文字增高由正常流网格项决定。
- `max-width:900px` 将 5 行双列命名区域改为 7 行单列，底板仍从第 3 行开始覆盖功能文案。`max-width:640px` 同步改为 `20px` 横向 padding 与 `-20px` 底板 inset。大屏、短屏规则同样保持低优先级，可按源码顺序生效。
- `D:/GithubRcj/SIA-algorithm-club-site/public/home-showcase.css:1012` 的英文标题规则与第 1061 行的手机英文规则保持一致优先级，后者可覆盖前者；未发现本轮新增的确定性英文级联错误。实际字体排版、溢出与各设备最终可视范围仍由浏览器 QA 验证。
- `D:/GithubRcj/SIA-algorithm-club-site/public/home-showcase.css:725` 的 `place-items:normal` 清除旧 `.orbit-visual` 的居中对齐遗留，不引入新的固定尺寸或网格列。

### 布局、控件、偏好与分享生命周期

- 对新增页面布局、共享控件状态、嵌套实底材质及相关响应式规则进行了源码核对，未发现有证据支持的第二处实质性回归；没有删除原业务选择器目标或内容。七份主要变动 CSS 的括号、字符串与注释平衡检查通过；此检查仅为结构检查，不冒充完整 CSS 语义验证。
- 共享控件保留可聚焦、hover、active、disabled、danger/ghost 与选中状态分支；reduce-motion、reduce-transparency、forced-colors 的现有/新增覆盖仍在。运动减少与粗指针中 lighting helper 的停止/取消行为由离线生命周期测试验证；不据此声称所有视觉对比度已浏览器验收。
- `D:/GithubRcj/SIA-algorithm-club-site/public/club-share.js:315` 的键盘处理仅在面板打开时接管 Escape/Tab，过滤 disabled/hidden 按钮并循环焦点。第 331 行重复打开不会覆盖原 opener；第 340 行关闭后清空 opener 并只恢复仍连接的节点；第 373 行语言重建前关闭面板并移除同名 keydown listener。
- 稳定后的真实分享源码通过最小 DOM 离线测试：Tab/Shift+Tab 环绕、跳过禁用项、焦点逃出后恢复、重复打开、Escape/cancel/scrim、语言重建清理、重建后仅一个监听器、已移除 opener 与 contains fallback。未发现本轮新增的可复现异步焦点竞态。

## 检查结果

通过：

- `node tools/check-ui-tokens.mjs`
- `node tools/test-premium-page-contracts.mjs`（49 页原有内联脚本/ID/链接契约，7 个冻结依赖）
- `node tools/test-home-capabilities.mjs`
- `node tools/test-club-shell-interactions.mjs`
- `node tools/test-club-share.mjs`
- `node tools/test-club-liquid-lighting.mjs`
- `node tools/test-club-reveal-lifecycle.mjs`
- `node --check public/club-common.js`
- `node --check public/club-share.js`
- `node --check public/service-gate.js`
- `node tools/test-asset-versions.mjs`（最终一次结果：37 个资源、581 处引用匹配；该脚本内部以 read-only `--check` 校验）
- `git diff --check`（无空白错误，仅现有 LF/CRLF 提示）

审查过程中 `test-club-shell-interactions.mjs:155` 曾因硬编码 `<body class="club-page">` 无法匹配新增 gallery class 而失败。同伴已改为匹配 body 属性并加入 required-body 断言；最终重跑通过。资源哈希检查在同伴编辑期间也曾出现中间态不匹配，最终重跑已通过；两项均不再列为未解决问题。

## 最终复核指纹与限制

- `public/home-showcase.css` SHA-256：`6d2336462fa5c534c5ec4536d998dc1455ea6591443d9bb712a367de7a0e2c51`
- `public/club-share.js` SHA-256：`47e8f1e65496ec5d263672bc91fcdaf1db37e02300191d5a7bbec6bda13832cb`
- `tools/test-club-shell-interactions.mjs` SHA-256：`4ac26e2a333b2d057f94a1d39716d2067f27055705cd0b3ad8dcffd9aa46eac9`

未运行浏览器、屏幕截图、性能采样或后端测试；未重建训练模型或其它生成产物。最终结论仅覆盖上述指纹对应源码与离线检查，后续编辑需重新评估相关部分。
