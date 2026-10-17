## 目标
将 `public/chat.html` 重构为接近 ChatGPT 的工作区：左侧会话导航，右侧全高聊天区，顶部轻量模型栏，中间可持续滚动的消息流，底部固定在主区内的输入组合框；保留现有模型、思考强度、附件、自定义社团代理、重试、停止、导出和本地会话能力。

## 1. 重新组织页面结构

修改 `public/chat.html`，保留现有脚本依赖和所有现有业务 DOM id，避免破坏 `chat.js` 的直接查询。

- 将页头改成紧凑的 Chat 顶栏：返回入口、移动端侧栏按钮、当前页面标题/当前会话标题、语言/主题入口；不再让传统页头单独占用一整行高度。
- 将 `#workspace` 变成全高聊天应用壳：
  - 左侧 `aside.chat-sidebar` 保留新对话、`#conversations`、清理记录，并增加可折叠状态所需的按钮和 aria 属性。
  - 右侧 `main.chat-main` 分成 `chat-main-header`、`chat-scroll`、`chat-composer-shell` 三个层次。
- 将模型选择、思考强度、模型介绍、代理配置和会话操作收纳到顶部工具栏/设置面板，减少它们对消息区高度的侵占。保留原来的 `#model`、`#effort`、`#modelIntroduction`、`#customModelPanel`、`#rename`、`#delete`、`#export`、`#retry`。
- 让 `#messages` 继续作为唯一消息滚动容器，避免破坏 `chat.js` 的自动跟随逻辑；去掉当前可拖拽消息框的固定 `40dvh` 方案。
- 将 `#composer` 包装成底部输入区：textarea、附件预览、文件按钮、发送/停止按钮集中在一个有边界和阴影的 composer surface 内，保留原生表单和所有现有 id。
- 隐私说明、估算提示和状态信息移到输入区下方的紧凑辅助区域，避免在每次对话中占据主视觉空间。

## 2. 重写 Chat 页面视觉与滚动布局

重构 `public/chat.css`，不改变全站主题变量，使用页面级 `--chat-*` 变量并补齐亮色覆盖。

- 桌面端采用全视口布局：顶部栏固定高度，下面是侧栏与主聊天区；主聊天区使用 `min-height: 0`，只有 `#messages` 滚动，页面本身不因消息区拉伸而失控。
- 侧栏采用更接近 ChatGPT 的深浅主题面板、圆角新对话按钮、紧凑会话项和清晰当前态；长会话列表独立滚动。
- 主区消息内容设置合理的 `max-width` 并居中，用户消息采用轻量气泡/底色，助手消息采用开放式正文布局；继续支持 Markdown、代码块、表格、图片预览和复制按钮。
- composer 使用 `position: sticky` 或主区 flex 底部布局，保留底部渐隐/背景层但不遮挡消息；textarea 只在输入框内部纵向调整，消息区不再提供容易误导的原生 resize 手柄。
- 统一按钮、select、details、focus-visible、disabled、滚动条和空状态样式，减少当前“配置表单堆叠”的感觉。
- 移动端改为真正的抽屉式侧栏：默认不占主页面高度，点击新增的侧栏按钮打开/关闭；聊天区保持全高，输入区适配窄屏和安全区。若不引入复杂动画，则用 class 切换和遮罩实现可访问的开关。
- 明确覆盖 `html[data-theme="light"] body.chat-page` 下的背景、正文、标题、输入控件和按钮，避免全站 `theme.css` 的 `!important` 规则导致亮色页面低对比度。

## 3. 补充少量交互增强

修改 `public/chat.js`，只增加 UI 状态，不改请求、存储和模型业务流程。

- 增加侧栏折叠/移动端抽屉开关，维护 `aria-expanded`、`aria-hidden` 和遮罩关闭行为；切换会话后在移动端自动收起侧栏。
- 在当前会话变化或语言刷新后同步顶部会话标题/模型标签；现有 `render()`、`refreshLocalizedUi()` 继续作为统一刷新入口。
- 保持 `#messages` 的滚动跟随判断，必要时只调整滚动目标为新的 `#messages` 容器，不把滚动逻辑移到外层。
- 保持 Enter 发送、Shift+Enter 换行、停止生成、重试、复制、附件预处理、代理 API Key 内存生命周期和动态国际化行为不变。
- 在输入为空、没有模型、生成中、附件处理期间继续复用现有 `controls()` 禁用规则。

## 4. 国际化与主题文案

修改 `public/chat-i18n.js`，为新增的侧栏开关、当前会话/设置按钮、移动端关闭按钮、输入区辅助提示补齐中英文 key。动态状态继续保存为 key + variables，不能保存已翻译字符串。

## 5. 验证

- 运行 `node --check public/chat.js`、`node --check public/chat-i18n.js`。
- 运行现有聊天核心和管理回归：`node tools/test-chat-core.mjs`、`node tools/test-chat-admin.mjs`；如存在页面静态检查则一并执行。
- 运行 `git diff --check`。
- 启动本地静态服务并使用浏览器验证桌面和窄屏：空会话、切换会话、输入框固定在底部、消息滚动、附件区域、模型/思考强度操作、代理配置面板、侧栏折叠、亮色/暗色主题和生成中按钮状态。
- 不调用真实供应商、不读取或提交真实 API Key、不部署、不 commit、不 push。