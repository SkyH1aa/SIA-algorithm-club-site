# Chat 本地 mock 浏览器联调

这是 **MOCK ONLY** 环境，用于不支持网络 route / storage 注入的浏览器工具：启动本地 mock 后，通过 GUI 打开它提供的 `/setup`、`/chat.html` 与 `/chat-admin.html`。页面使用生产前端代码，但本地 fixture SDK 与路由会替换 Supabase 请求，不访问真实 auth、数据库或供应商。本次已查看 mock Chat 页的 DOM 状态；没有可供查看的截图，因此不构成截图支持的视觉验收。

## 启动与入口

需要 Node.js 20+；无需 npm 安装、环境变量、Supabase、Deno 或外网。请在仓库根目录执行：

```bash
node tools/chat-mock-server.mjs
```

浏览器打开 **http://localhost:4191/setup**。服务仅绑定 `127.0.0.1:4191`，也可使用 `http://127.0.0.1:4191/setup`；同一次测试请固定一个主机名，它们的 IndexedDB / 主题存储互相独立。`Ctrl+C` 停止。端口占用会明确报错，不自动选择别的端口。

1. 在 setup 选择账号、生成场景、主题，点击“应用 mock 设置”。
2. 用 setup 的链接打开 `/chat.html` 或 `/chat-admin.html`，正常操作页面。fixture SDK 会在页面顶部显示 MOCK 标识与设置入口。
3. 保留 setup 标签页，用它随时改变场景或账号。SDK 每 350ms 轮询内存 session，通过真实前端已注册的 `onAuthStateChange` 通知账号变化；账号变化或重置会使旧 mock token 失效。场景变化从下一次请求生效，当前流保持请求启动时的场景。
4. 主题仅由 fixture setup 调用真实 `ClubTheme.setMode(mode, {persist:true, syncRemote:false})` 保存；应用后刷新目标页。Chat 页原有主题同步请求由本地 `/mock/club-drive` 接收。setup 不直接注入存储或修改 `data-theme`。

全体标签页和浏览器共享该服务的一套模拟账号、配置和日志，不是多用户隔离服务器。默认 `member / completed / dark`。

## GUI 验证矩阵

| 设置 / 操作 | 预期 |
| --- | --- |
| `admin` | 已绑定动态模拟超管，可以正常 Chat，也可以管理配置、执行测试与查看 usage |
| `member` / `member2` | 两个不同 UUID 的已绑定社员，可以 Chat，管理页拒绝；IndexedDB 记录按 userId 隔离 |
| `unbound` | session 非空，但 catalog/respond 返回 `403 profile`，管理动作返回 `403 admin` |
| `loggedout` | session 为 null，正常前端显示登录门禁，Chat 接口返回 `401 login` |
| `completed` | `response.created` → 多段 `response.output_text.delta` → `response.completed`，含 message output 与 usage |
| `incomplete` | 相同增量，最终 `response.incomplete`，原因 `max_output_tokens` |
| `interrupted` | 三段增量后正常 EOF，不发终态，Chat 应保留部分文本并标中断；当前 mock usage 审计记 `incomplete/upstream_eof`（真实后端记录 `interrupted/upstream_eof`） |
| `failed` | 部分/完整增量后 `response.failed`，保留可用于状态测试的模拟输出 |
| `slow` | 每 1.5 秒一段，通常持续约半分钟；点击停止后连接关闭、usage 记 cancelled、逐用户锁释放 |
| slow 期间 setup 切 `member2` | 前端 auth 回调中止旧流并切到另一账号历史；再切回 member 检查旧记录状态 |
| 连续发两轮 | 模拟回答报告 user 轮数与 assistant 历史条数；请求记录显示 roles/parts 数量，不记录正文 |
| `light` / `dark` | setup 真实 API 保存后刷新目标页，验证各控件与 Markdown 对比度 |

模拟回复包括 Markdown 列表、代码块、链接及一个无害的 `<script>` 文本，方便观察前端渲染/净化行为；mock 不回显用户提示词、附件或任意配置内容。token 数量为本地估算，不能用于计费验证。

管理页建议：用 admin 新建供应商（例如 `https://mock-provider.example.com/v1`、Secret **名称** `CHAT_KEY_MOCK_CREATED`），创建模型，编辑标签或 enabled，执行测试生成，刷新 usage 并测试分页/时间过滤。只输入合成配置，**不要输入真实 key**。

当前真实 action 契约只有 upsert 与 `enabled` 软停用，没有 delete action；本 mock 对齐这一点。创建/读取/更新/停用覆盖页面所需的配置 CRUD 生命周期，物理删除通过 setup 重置模拟数据。

## 上传 fixtures

setup 有下载链接。下载后使用 Chat 原有文件选择器上传，不依赖浏览器 storage 或网络注入。

- `fixtures/sample.txt`：UTF-8 中英文本，经前端进入 `input_text`。
- `fixtures/sample.png`：96×64 有效 RGB PNG，测试预览与 `input_image`。
- `fixtures/sample.pdf`：单页标准 PDF，文本大于 30 字符，应由本地 PDF.js 抽取为 `input_text`。
- `fixtures/image-only.pdf`：只有图像的单页 PDF，应走原生 `input_file`；选 MOCK 纯文本模型应被前端拒绝。

图片与两份 PDF 已随当前工作区提供，可直接用于本地 mock 联调。需要重建时，可选用 Python 3 标准库，无外网或第三方库：

```bash
python docs/chat-validation/fixtures/generate-upload-fixtures.py
```

这些文件在服务器自检中验证可下载，并通过 mock 附件 API 校验；PDF.js 的浏览器提取、上传预览与 GUI 状态仍需按上表人工/浏览器测试，不声称已完成浏览器验收。

当前浏览器运行时尚未完成原生文件选择器上传验收。fixture 下载、HTTP 检查和 DOM 状态不能证明真实 GUI 上传成功，也不能用伪造 File、存储注入或请求替换代替。

## 实现边界与契约差异

- 静态根目录是 `public/`；额外公开 `/setup` 与 `/fixtures/*`，不会公开仓库根目录。
- 仅在服务响应的 `chat.html` / `chat-admin.html` 中，把远程 Supabase SDK script 替换成 `fixtures/mock-supabase.js`。磁盘上的生产页面没有变更。
- fixture `createClient()` 忽略所有传入 URL/key，不读真实 Supabase session，只实现所需 `auth.getSession()`、`auth.onAuthStateChange()` 和 subscription unsubscribe。
- 返回生产 `.js/.mjs` 时在内存中把 `https://<project>.supabase.co` 改为当前本地 origin，把 `/functions/v1/chat` 改为 `/mock/chat`、club-drive 改为 `/mock/club-drive`。生产源码不写回。
- 每个响应带 `X-Chat-Mock: true`、no-store、仅同源资源的 CSP。connect-src 只允许 self，远程 SDK/遗漏的远程 fetch 都不能访问线上；未实现的本地路径失败，不转发。服务端没有 fetch 上游、数据库 SDK、凭证读取或 DNS 校验。
- Host 仅接受本机 4191，Origin / Sec-Fetch-Site 拒绝跨站控制；静态路径还检查目录边界与 symlink 真实路径。
- `/mock/club-drive` 提供站点可用状态、内存主题偏好及模拟 staff access，保证页面配套脚本也只访问本地。
- `/mock/chat` 使用真实 action 名称与响应壳：`catalog`、`admin_get`、`admin_save_provider`、`admin_save_model`、`admin_usage`、`admin_test`、`respond`。模型/供应商 UUID、字段、权限错误、模型能力/大小限制、SSE 终态、逐账号 409 busy 与取消清理均用于前端契约联调。
- 为适配当前前端，`admin_test` 同时支持页面的 `{prompt}` 与 `{input}`；多轮 input 接受 Responses 顶层 assistant `message` / `reasoning`，也接受 role/content 形式。生产后端与 mock 都支持这些兼容形式；mock 成功仍不能替代真实 Supabase Auth、数据库或供应商验收。
- 生产后端对 provider URL 执行 HTTPS、公网地址、凭据/query/fragment、端口和 DNS/SSRF 校验，并校验 Secret 名称格式；mock 只做受控语法检查，不做 DNS/SSRF/外部请求。生产与前端/后端都限制每轮最多 4 个附件、请求序列化体积最多 12 MiB；mock 还会把可计量文本限制为 500,000 字节，生产后端按 12 MiB 请求/附件/文本边界校验。生产后端严格校验 PNG/JPEG/WebP 与 PDF data URL 的 base64 格式，mock 也校验 data URL，但不会执行生产 DNS、供应商 secret 或上游请求。
- 前端和生产后端对单文件均限制 5 MiB；PDF 最多 300 页，PDF.js 抽取文本最多 1,000,000 个字符。mock 的附件自检覆盖 PNG/PDF 和模型能力拒绝，但不替代真实浏览器 PDF.js 提取或供应商对原生 `input_file` 的解析验收。模拟输出不严格按 `max_output_tokens` 截断；`incomplete` 场景确定性提供截断终态。usage 返回精确内存 `total` 便于分页测试；生产后端要求 PostgREST 返回有效的 `Content-Range` 总数，缺失或无效时返回 database 错误，不会把 `null` 当成成功总数。
- 本服务独立实现 mock，不导入正在开发的 Deno 后端，避免改动或依赖其他 agent 的工作。

## 日志、重置与自检

setup 的“刷新元数据”或 **GET `/mock/requests`** 查看最近最多 500 条记录。只保存服务生成 request ID、时间、受控 action/账号、请求字节数、model UUID、受控 effort / 场景、role/part 数量、附件计数/字节和结果；**不保存请求 headers、apikey、authorization、token、key 值、提示正文、附件内容或供应商配置**。不自动写日志文件。usage 最多保留 1000 条模拟生成记录。

setup“重置 mock 配置 / usage / 请求记录”取消活动流并恢复初始模型/供应商、清空记录，保留当前所选设置。重启服务也丢弃内存。浏览器 IndexedDB 独立存在：请使用 Chat 原有“清除此账号本地记录”分别清理两个账号，不通过 fixture 静默删除。

在仓库根目录运行可重现 HTTP 自检（若 4191 已被 GUI 服务占用，自检会自动使用独立临时端口）：

```bash
node tools/chat-mock-server.mjs --self-test
```

自检启动临时本地服务器后自动关闭，验证 SDK 替换、URL 替换、CSP、静态/上传 fixtures、catalog/权限、多轮与附件、所有 SSE 终态、slow 停止/409 锁释放、旧 token 拒绝、配置创建/修改/停用、admin_test、usage、仅元数据日志、重置和跨站/路径防护。不会启动浏览器或访问线上接口。
