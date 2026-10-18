# Chat 本地 mock 浏览器联调

这是 **MOCK ONLY** 环境，用于不支持网络 route / storage 注入的浏览器工具：启动本地 mock 后，通过 GUI 打开它提供的 `/setup`、`/chat.html` 与 `/chat-admin.html`。页面使用生产前端代码，但本地 fixture SDK 与路由会替换 Supabase 请求，不访问真实 auth、数据库或供应商。本次已查看 mock Chat 页的 DOM 状态；没有可供查看的截图，因此不构成截图支持的视觉验收。

## 启动与入口

需要 Node.js 20+；无需 npm 安装、环境变量、Supabase、Deno 或外网。请在仓库根目录执行：

```bash
node tools/chat-mock-server.mjs
# 独立端口，不停止已有 mock：
node tools/chat-mock-server.mjs --port 4192
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
| 模型 `visibility=all` | 任一已绑定成员的 catalog 包含该模型，`respond` 可以使用 |
| 模型 `visibility=assigned` + 已授权 UUID | 仅被分配的成员在 catalog 中看到并能 `respond` |
| 模型 `visibility=assigned` + 未授权 UUID | catalog 隐藏；直接提交该模型 UUID 的 `respond` 仍返回 `403 model`，不能用猜测/替换 UUID 绕过 |
| 管理员 `admin_test` 测试 assigned 模型 | 动态超管可以测试模型配置，但仍需要管理员 JWT，并继续受黑名单、quota、并发和 provider 校验约束 |
| `completed` | `response.created` → 多段 `response.output_text.delta` → `response.completed`，含 message output 与 usage |
| `incomplete` | 相同增量，最终 `response.incomplete`，原因 `max_output_tokens` |
| `interrupted` | 三段增量后正常 EOF，不发终态，Chat 应保留部分文本并标中断；当前 mock usage 审计记 `incomplete/upstream_eof`（真实后端记录 `interrupted/upstream_eof`） |
| `failed` | 部分/完整增量后 `response.failed`，保留可用于状态测试的模拟输出 |
| `slow` | 每 1.5 秒一段，通常持续约半分钟；点击停止后连接关闭、usage 记 cancelled、逐用户锁释放 |
| slow 期间 setup 切 `member2` | 前端 auth 回调中止旧流并切到另一账号历史；再切回 member 检查旧记录状态 |
| 连续发两轮 | 模拟回答报告 user 轮数与 assistant 历史条数；请求记录显示 roles/parts 数量，不记录正文 |
| `light` / `dark` | setup 真实 API 保存后刷新目标页，验证各控件与 Markdown 对比度 |
| Messages `claude_thinking` | 以 admin 保存 `omit`、`disabled`、`enabled`、`adaptive` 四种合法对象；确认未知键、跨模式键、重复/非法 effort、`none` 和缺失预算均 400。enabled 用预算 1024、默认输出 4096，测试输出用 2048 或 4096；输出 1024 或更低必须 400，且不能把预算缩小后发出。adaptive 可用空数组或供应商确认的 low/medium/high/xhigh/max，默认值必须在数组内。 |

模拟回复包括 Markdown 列表、代码块、链接及一个无害的 `<script>` 文本，方便观察前端渲染/净化行为；mock 不回显用户提示词、附件或任意配置内容。token 数量为本地估算，不能用于计费验证。

管理页建议：用 admin 新建供应商（例如 `https://mock-provider.example.com/v1`、Secret **名称** `CHAT_KEY_MOCK_CREATED`），创建模型，填写最多 1000 字符的模型介绍，保存后编辑确认介绍回填；再打开 Chat 目录切换该模型，确认介绍显示为纯文本。继续测试编辑标签或 enabled，执行测试生成，刷新 usage 并测试分页/时间过滤。只输入合成配置，**不要输入真实 key**。

模型访问验收应覆盖 `all` 与 `assigned` 两种 visibility：给 member 分配 assigned 模型后确认只有该 UUID 能 catalog/respond，移除分配后确认 catalog 隐藏且直接使用已知 model UUID 仍被拒绝；不能只测前端下拉框。管理员 `admin_test` 可作为配置烟雾测试，但额度为 0、额度耗尽、黑名单或 provider/model disabled 时仍应失败，不能把 admin_test 当作 quota bypass。

成员页的 custom cloud 配置只验证合成显示名、模型 ID、固定社团 proxy URL 和一次性内存 key：保存请求不能包含 `api_key`，数据库/接口返回只含 metadata；刷新或关闭页面后 key 必须消失并要求重新输入。固定 URL 必须是规定的 proxy origin、route UUID 和 `/functions/v1/chat-api-proxy/<uuid>` 路径，实际请求为 `POST .../v1/responses`，不应直连上游或暴露任意 `/models`、`/chat/completions` 路径。

代理管理支持撤销与彻底删除两个阶段，详见下方代理契约；仅停用的路由/密钥不能直接彻底删除。mock 的 setup 重置只用于清空本地测试环境。

## 额度与黑名单验证

管理页用 admin 刷新账号目录，确认按 username/中文姓名显示但以 UUID 选定目标，包含未绑定账号。测试全站每日与成员每日/每周/每月设置：空白保存为 `null` 不限，`0` 阻止生成，最大有限值为 `1e12` 整数，负数、小数和超限拒绝。全局仅每日，个人维度分别生效；两位管理员/两个旧快照保存同一设置，后保存的旧版本应 `409 conflict`，需刷新确认，不自动覆盖。

| 操作 | 预期 |
| --- | --- |
| member 调任一新增 admin action | `403 admin`；loggedout 为 `401 login` |
| `quota {}` / 正常 catalog | 只返回本人快照；catalog 含 `quota`；不接受任意他人 `user_id` |
| 剩余额度小于输入估算 + 默认输出，但仍容纳输入 + 1 | 允许生成，缩小输出；响应 `X-Chat-Quota-Limited: true`、`X-Chat-Max-Output-Tokens` 为有效上限 |
| 全局或个人任一维度为 0 / 耗尽 | respond 和 admin_test 均 `429 quota`，catalog 仍可读取 |
| completed usage | 按模拟有效 usage 结算，释放未消耗的预留差额；记录 actual mock token，不当作真实供应商计费 |
| interrupted EOF / slow 后停止 | 无 usage，保留整个输入估算 + 输出上限预留，释放生成锁不退款 |
| 成员加入黑名单 | 下次 catalog/respond `403 blacklisted`，quota 返回 `blacklisted:true` 与 reason；移除后恢复 |
| 管理员自身加入黑名单 | admin_test 同样拒绝，但额度/黑名单管理接口仍可访问 |
| 生成开始后才拉黑 | 不追溯强杀已运行流；限制下一次准入 |
| setup reset | 取消活动流、清空黑名单/额度设置/全部周期计数和 usage，恢复默认不限/version 0 |

所有周期是 UTC 日历：日 UTC 午夜、周一 UTC 午夜、每月 1 日 UTC 午夜；`resets_at` 为 ISO UTC。HTTP 自检通过可注入的 mock 时钟覆盖日/周/月边界，不需要改系统时间或等待。周期在请求开始时固定，跨午夜的结算仍计入原预留周期。

输入估算与供应商实际 token 不等价：mock 与 Edge 对文本按各片段 UTF-8 字节/3 取整，图片 low/auto/high 分别固定 1024/4096/8192，原生 PDF 固定 8192；mock 的终态 usage 是另一套合成计量（文本总字节/3、每附件 32，加合成输出），刻意不是供应商账单。mock 会按有效输出上限缩短 fixture，并限制合成 output usage；仍不模拟真实 tokenizer、reasoning、费用或供应商多模态解析。生产必须以有效 provider usage 结算，可能实际高于估算；无 usage、崩溃或结算失败保守保留预留，不把“没看到完成”当成零消耗。mock 内存重启清空与生产持久化保留有意不同。

## 90 天 usage 汇总与保留验证

`admin_usage`（兼容别名 `usage`）保留 `usage,page,pageSize,total`，增加 `summary:{total_records,total_tokens}` 与顶层 ISO UTC `window_start,window_end`。窗口按 `started_at` 精确取 `[asof−2160h,asof)`：下界包含，上界排除，未来记录不显示。`from`/`to` 是原有包含端点的时间筛选，最终结果仍被窗口限制；`total` 对应日期过滤后的全部记录，`usage` 是其中一页。summary 对整个 90 天窗口统计，不受 page、pageSize、limit 或日期筛选影响；`total_records` 是数字，`total_tokens` 是十进制字符串，`null` token 被忽略但真实记录仍计数，空总和为 `"0"`。不以预留量或估算量补造 token。

用 admin 打开管理页，刷新 usage、翻页、改每页数量、设置较窄时间段，再清除日期条件；列表和筛选后的 total 应变化，窗口汇总只随窗口内真实记录变化。中英切换和明暗主题下检查汇总标签、数字与窗口提示。普通成员仍被拒绝。管理页继续使用现有 `admin_usage` 加载流程，`admin_get` 没有新增汇总字段。

HTTP 自检内置固定时钟和独立合成行（仅在测试进程内注入，不提供公开写 usage 接口），覆盖：

- 90 天起点前 1ms、起点、起点后 1ms、当前时间前、恰好 as-of 和未来行；只计 `[start,end)`。
- 一页仅 1 条时全窗口有 4 条，第二页、空页、窄日期段和窗口外条件保持相同 summary；date-filtered total 不受分页影响。
- `null`、空窗口和高于 `2^53` 的 token 总和，精确返回字符串 `"9007199254740998"`。
- 非法日期、反向时间范围、非法分页参数拒绝；兼容 `limit` 并把宽筛选限制在报告窗口。
- 自主定时清理后回拨测试时钟，已过期行仍不能重新出现，以区别物理删除和读取时隐藏。清理并非由 admin read 触发。
- 保留活动 lease、未结算 reservation 和未完成 usage；过期 lease 不代表完成，迟到结算后才允许删除关联记录。终态还必须有 `finished_at`；无 token 的中断不会凭空退款。
- quota 快照在清理前后不变；既有完成/中断请求的额度预留与结算回归继续执行。所有 HTTP 请求只能访问自检自己的回环服务器，无 DNS、数据库或上游调用。

mock 默认启动时及每小时物理清理内存中的安全过期记录；usage 不再以 1000 条截断，否则会污染全窗口汇总。mock 不模拟 SQL allocation 表、数据库锁或 pg_cron 本身。生产完整 SQL 只安装清理函数与幂等小时任务 `chat-usage-retention-90d`，首次定时运行才执行不可逆删除；不需要访客触发，列表从部署后读取时立即过滤。若扩展不可用、安装或排程失败，应出现可见 warning 并由部署者解决，不能把 mock 计时器当作生产自动化。未解决的旧计量数据虽对报告隐藏，仍保留待结算；quota buckets/counters 与设置不改、不退款。

本地已在 PGlite 的 PostgreSQL WASM runtime 通过完整 schema 与重复运行、1505 条记录精确汇总/分页/日期/权限，以及清理外键、保护条件、迟到结算、quota 不变和 1000+1 分批测试。这是单连接执行，不能证明独立 PostgreSQL 服务器的多连接并发或真实 pg_cron 已验收；没有线上部署，也未声称上述新 GUI 矩阵已经完成。生产小时任务每次最多清理 1000 条安全过期记录，积压会延长至多个小时，未结算保护或任务失败也会延迟；报告窗口仍立即过滤。仅本功能升级顺序为**完整 SQL → `chat` Dashboard 单文件 bundle → 管理页 HTML/JS/i18n**，不因本功能更新 `chat-api-proxy`、成员页或 `chat-file-bundle.js`。详细网页步骤见 `../chat-deployment/README.md`。

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
- 返回生产 `.js/.mjs` 时在内存中把整个 `https://<project>.supabase.co` 改为当前本地 origin；先把 `/functions/v1/chat-api-proxy` 改为 `/mock/chat-api-proxy`，再对边界匹配的 `/functions/v1/chat` 改为 `/mock/chat`，club-drive 改为 `/mock/club-drive`。不会把 proxy 路径误吞成 Chat action 路径；硬编码的 Supabase base URL 也必须本地化。生产源码不写回。
- 每个响应带 `X-Chat-Mock: true`、no-store、仅同源资源的 CSP。connect-src 只允许 self，远程 SDK/遗漏的远程 fetch 都不能访问线上；未实现的本地路径失败，不转发。服务端没有 fetch 上游、数据库 SDK、凭证读取或 DNS 校验。
- Host 仅接受本机 4191，Origin / Sec-Fetch-Site 拒绝跨站控制；静态路径还检查目录边界与 symlink 真实路径。
- `/mock/club-drive` 提供站点可用状态、内存主题偏好及模拟 staff access，保证页面配套脚本也只访问本地。
- `/mock/chat` 使用真实 action 名称与响应壳：`catalog`、`admin_get`、`admin_save_provider`、`admin_save_model`、`admin_usage`、`admin_test`、`respond`，以及 `quota`、`admin_user_directory`、`admin_quota_get`、`admin_quota_save`、`admin_set_blacklist`、`admin_blacklist_list`。模型/供应商 UUID、字段、权限错误、模型介绍（可选、最多 1000 字符、成员目录可见）、模型能力/大小限制、SSE 终态、逐账号 409 busy 与取消清理均用于前端契约联调。
- 为适配当前前端，`admin_test` 同时支持页面的 `{prompt}` 与 `{input}`；多轮 input 接受 Responses 顶层 assistant `message` / `reasoning`，也接受 role/content 形式。生产后端与 mock 都支持这些兼容形式；mock 成功仍不能替代真实 Supabase Auth、数据库或供应商验收。
- 生产后端对 provider URL 执行 HTTPS、公网地址、凭据/query/fragment、端口和 DNS/SSRF 校验，并校验 Secret 名称格式；mock 只做受控语法检查，不做 DNS/SSRF/外部请求。生产与前端/后端都限制每轮最多 4 个附件、请求序列化体积最多 12 MiB；mock 还会把可计量文本限制为 500,000 字节，生产后端按 12 MiB 请求/附件/文本边界校验。生产后端严格校验 PNG/JPEG/WebP 与 PDF data URL 的 base64 格式，mock 也校验 data URL，但不会执行生产 DNS、供应商 secret 或上游请求。
- 前端和生产后端对单文件均限制 5 MiB；PDF 最多 300 页，PDF.js 抽取文本最多 1,000,000 个字符。mock 的附件自检覆盖 PNG/PDF 和模型能力拒绝，但不替代真实浏览器 PDF.js 提取或供应商对原生 `input_file` 的解析验收。模拟输出按有效输出上限缩短，但不是供应商 tokenizer；`incomplete` 场景确定性提供截断终态。usage 返回内存精确的筛选后 `total` 和独立的 90 天 `summary` 便于分页/汇总测试；生产通过仅 service-role 可用的动态管理员 RPC 返回一致窗口与总数，不以当前页长度猜测 total 或汇总。
- 本服务独立实现 mock，不导入正在开发的 Deno 后端，避免改动或依赖其他 agent 的工作。

## 独立代理管理与外部客户端 mock

代理 fixture 只在本工具内存中，不新增磁盘 fixtures、不读取凭证、不做 DNS/真实网络转发。普通 Chat 的 quota、blacklist、模型介绍和原有自检保留。管理动作经 `/mock/chat`，正式契约为：

- `admin_proxy_list {}` → `{routes,keys}`。
- `admin_proxy_save {id:null|UUID,name,base_url,secret_name,enabled,expected_version:0|n}` → `{route}`。
- `admin_proxy_route_state {id,enabled,expected_version}` → `{route}`。
- `admin_proxy_route_delete {id,expected_version}` → `{route}`；不可逆撤销路由并保留失效记录，同时撤销旗下全部 key。
- `admin_proxy_route_hard_delete {id,expected_version}` → `{deleted_route_id}`；仅限已撤销路由，清除路由及关联密钥/租约。
- `admin_proxy_key_create {route_id,label}` → `{key:metadata,api_key:一次明文}`。
- `admin_proxy_key_state {id,enabled,revoked:boolean,expected_version}` → `{key}`。
- `admin_proxy_key_hard_delete {id,expected_version}` → `{deleted_key_id}`；仅限已撤销密钥，清除密钥及其租约。

新增删除验收覆盖：活动或仅停用记录返回 `409 not_revoked`、旧版本返回 `409 conflict`、非超管拒绝、确认取消不发请求、删除成功从列表消失且重新加载仍不出现、旧 key 无法准入、路由关联记录清理与其他路由不受影响。前端模拟与 HTTP mock 验证交互和契约；SQL integration 脚本提供真实行删除、外键/租约清理、权限和并发断言，需另有本地 PostgreSQL 才能执行。

route 包括 `id,name,base_url,secret_name,enabled,deleted_at,version,created_at,updated_at`；key metadata 只有 `id,route_id,label,key_prefix,key_last4,enabled,revoked_at,version,created_at`。32 随机字节生成 `cap_` + base64url，内部只存 SHA-256 hash；list/状态/日志没有 hash 或完整 key，丢失明文只能撤销重建。route 墓碑删除和 key 撤销均不可恢复；陈旧 expected_version 返回 409。

GUI 可用 admin 新建 route（合成 `https://mock-provider.example.com/v1`、`CHAT_KEY_MOCK_PROXY` 引用名），创建 key，查看一次明文提示并确认关闭后列表不可取回；复制 base URL 不应包含任何 key。打开不同主题和语言确认状态、按钮、冲突提示可读。创建/保存/检查 Secret 不能触发真实收费测试。mock 不代表 Secret 实际存在，不能代替生产 Secret/DNS/SQL 验收。

外部路径支持 **`/functions/v1/chat-api-proxy/<uuid>/v1/responses`** 和供前端改写使用的 `/mock/chat-api-proxy/<uuid>/v1/responses`，只支持 POST responses。客户端 base 是 `http://localhost:4191/functions/v1/chat-api-proxy/<uuid>/v1`（独立端口按实际改）；SDK `responses.create({model,input,stream?})` 使用创建时的 proxy key，不用原生上游 key。`/v1/responses` 必须保留 model 原值并返回 JSON/SSE；`models`、`chat/completions`、单数 `response`、retrieve 均 404，不转发。

浏览器 CORS 验收要区分 `CHAT_CORS_ORIGINS`（成员 Chat）和 `CHAT_PROXY_CORS_ORIGINS`（独立 proxy），分别用允许和未知 Origin 检查响应。proxy 未配置后者时可返回 `*` 以支持 CLI，但无 key/错误 key 仍 401；配置后未知浏览器 Origin 应在 admission 前 403。CORS 不可作为认证测试替代。

| 本地操作 | 预期 |
| --- | --- |
| 无 key、错误 key、Supabase session token、跨 route key | 401 |
| route disabled / key disabled、revoked | 分别 403 / 401；重新启用未撤销 key 可恢复 |
| completed + stream:false/省略 | 合成 JSON，model 原值返回 |
| completed + stream:true | 合成 Responses SSE；incomplete / interrupted 对应截断终态或无终态 EOF |
| failed | 502，统一 `{error:'upstream',mock:true}`，无上游错误正文 |
| slow 同 key 已有两个在途流 | 第三个请求 429；每 route 在途上限 20 |
| slow 取消 | 连接中止、日志 cancelled、释放代理租约，可再次调用 |
| 请求体超过 12 MiB | 413 |
| Chat 全局额度设 0、管理员拉黑、setup loggedout | 既有有效 proxy key 仍能生成，与 Chat/session 独立 |
| setup reset | 取消代理流，清空 routes/keys/哈希/租约；旧 proxy key 不再有效 |

mock 仅模拟协议，不执行请求中的 tools/远程 URL、上游项目资源访问或真正 token 计量，也不证明生产取消、平台超时或金额预算。生产透传的 tools/MCP、files/vector stores/previous_response_id、远程媒体可能触发上游执行与共享资源访问；proxy key 不隔离上游租户，务必专用上游项目/Secret。上线或转售前必须确认供应商条款允许代理、转授权或 resale，且限制工具权限、远程抓取、文件/向量资源和预算；持有上游 key 不等于拥有转售许可。不要宣传完全隐藏供应商：成功 JSON、SSE、模型名和上游错误事件仍可能泄露特征或敏感内容，尤其 SSE 开始后不能保证正文净化。部署、非 2xx 脱敏、120 秒全流超时和 Supabase wall-clock 限制详见 `docs/chat-deployment.md` 第 11 节。

自检新增验证五个管理员契约、32-byte key 和精确 metadata 字段、哈希/明文不出 list/log、版本冲突、路由绑定、JSON/SSE/model 原值、401/403/404/405/413/429/502、取消释放、Chat/session 独立性、撤销、URL 替换与 reset。所有请求限于自检自己创建的回环服务器，绝不自动测试生产或付费供应商。未运行新的 GUI 矩阵，不声称代理页面视觉验收通过。

- `chat_proxy` 管理页删除验收：在本地 mock 中创建合成路由，执行撤销并确认永久删除后，路由立即消失；再次点击“刷新路由与密钥”仍为空。此为浏览器交互与内存 mock 验证，不是线上数据库删除验收。

## 日志、重置与自检

setup 的“刷新元数据”或 **GET `/mock/requests`** 查看最近最多 500 条记录。只保存服务生成 request ID、时间、受控 action/账号、请求字节数、model UUID、受控 effort / 场景、role/part 数量、附件计数/字节和结果；**不保存请求 headers、apikey、authorization、token、key 值、提示正文、附件内容或供应商配置**。不自动写日志文件；usage 按 90 天窗口清理符合安全条件的旧行，未完成/未结算行保持内部保留，不以条数截断。`reasoning_effort` 日志字段只用于兼容通用协议；Messages 的请求配置以 `claude_thinking` 为准，并将有效 adaptive effort 记录为受控元数据。日志不保存请求体中的 thinking、预算、headers 或 key。

setup“重置 mock 配置 / usage / 请求记录”取消活动流并恢复初始模型/供应商，同时清空额度设置、黑名单、所有周期计数和记录，保留当前所选设置。重启服务也丢弃内存。浏览器 IndexedDB 独立存在：请使用 Chat 原有“清除此账号本地记录”分别清理两个账号，不通过 fixture 静默删除。验证内存生命周期时，切换账号应中止旧流、拒绝旧 token、保留另一账号的本地历史；刷新/关闭页面应丢失 custom cloud API key，但不应删除 IndexedDB 会话。生产对照检查数据库 lease/usage 在 Edge 重启后仍保留，取消/租约到期不等于供应商退款。

在仓库根目录运行可重现 HTTP 自检（若 4191 已被 GUI 服务占用，自检会自动使用独立临时端口）：

```bash
node tools/chat-mock-server.mjs --self-test
node --check tools/chat-mock-server.mjs
node tools/test-chat-admin.mjs
python tools/test-chat-quota-sql.py --syntax-only
# 仅显式授权的本地可丢弃 PostgreSQL；不是线上 Supabase DSN：
python tools/test-chat-quota-sql.py --dsn 'host=127.0.0.1 port=5432 dbname=postgres user=postgres'
```

SQL syntax-only 只做 pglast 解析，不验证事务或并发；真实 DSN 测试另需 psycopg、本地 PostgreSQL 与 CREATEDB/CREATEROLE 权限，会创建/删除随机测试数据库。本次未运行独立 PostgreSQL 服务器/DSN 集成；usage90day 已在 PGlite PostgreSQL WASM runtime 单连接执行验证（范围见前文），不声称多连接并发或真实 pg_cron 通过。升级需先暂停旧 Edge 新请求并等待旧流结束，再完整主 SQL → Secrets → 两个 Edge（chat 与 chat-api-proxy）→ 前端；历史 `chat_usage` 不回填额度桶，新计量从新版 Edge admission 开始。

本地 mock 只覆盖运行时协议，不能证明手动发布正确。发布前后要分别检查 Dashboard 中 `chat` 与 `chat-api-proxy` 的完整 standalone bundle：`docs/chat-deployment/chat-dashboard-index.ts` 和 `docs/chat-deployment/chat-api-proxy-dashboard-index.ts`，确认没有未解析的 `_shared` import，且修改源函数或 helper 后已重新同步。用 `node tools/build-chat-dashboard-bundles.mjs` 重建，`node tools/build-chat-dashboard-bundles.mjs --check` 检查源文件一致性。不要把真实 key、service role key 或生产 proxy key 放入 fixture、日志或截图；不要为验证启动生产部署或发送付费上游请求。

## Claude Messages 专用 thinking 回归

`claude_thinking` 的有效形态是 `{mode:'omit'|'disabled'|'enabled'|'adaptive', budget_tokens?:number, efforts?:string[], default_effort?:string|null}`，严格限制各模式允许的键。HTTP mock 自检覆盖：

- 新建遗漏字段 → omit；每种模式的更新遗漏字段 → 保留原值。无效创建不增加记录，无效更新不改变旧值。旧通用 effort 仍存储，不自动转换为预算；Messages 运行时忽略旧值。
- `catalog` 先解析供应商 `api_protocol`（包括 auto 的 URL 推断），再返回专用配置和有效 effort。Messages 仅 adaptive 使用其数组/default，其他模式是 `[]/null`；Responses 与 Chat Completions 保持通用值。目录协议名与后端一致为 `messages`，Chat Completions 为 `chat`。
- omit 不发 thinking/effort，disabled 只发关闭模式，enabled 只发原始预算，adaptive 可以省略 effort 或单独发 `output_config.effort`。后者调节工作量，不能当作 thinking 开关；none 不在 adaptive 候选值内。low/medium/high/xhigh/max 是否可用由具体模型版本和供应商决定。
- enabled 的预算必须是整数且至少 1024，严格小于默认输出、管理员测试输出及额度收缩后的实际输出。示例预算 1024、默认输出 4096；1024 拒绝，1025 允许。自检覆盖管理员与成员的预算拒绝、额度预留释放，以及不映射、不裁剪原始预算。
- 管理员测试与成员 respond 返回归一化 Responses SSE，旧原生代理的 JSON/SSE、`x-api-key`、别名与认证回归继续通过，代理不读取此模型配置。

原用户的第三方别名 `claude-haiku-5-5` 先保持已知可用的 omit；adaptive + medium 只有用户明确启用且供应商确认后才可使用。原生 Anthropic Haiku 5.5 的 [固定版官方迁移文档](https://github.com/anthropics/skills/blob/9d630808e4add0a7146de4af9384155d5dee350a/skills/claude-api/shared/model-migration.md) 已记载 adaptive 默认、默认 medium、手动 enabled 预算返回 400 和 effort 版本边界，但不能证明第三方别名转发兼容。原生模型默认不提供 thinking 摘要，不见推理内容不能判定已关闭；本次未实现额外推理展示。

自检仅创建回环 HTTP 服务，直接断言 mock 自身构造的 thinking 片段及合成流，**不会发原生请求给真实供应商**，不能证明其接受某个模式、预算或 effort。真实后端 source/handler、前端 GUI/i18n、SQL 迁移与额度事务分别由对应测试验收；此次 mock 自检成功不代表这些已运行，也不代表上线部署或供应商付费验收完成。

既有部署升级专用字段需重新执行完整 SQL（`claude_thinking` 非空默认 omit），再更新 `chat` 单文件 bundle，最后发布前端（管理页 HTML/JS/i18n、成员 JS/i18n、`public/chat-file-bundle.js`）。没有本次原生代理行为变更，不必仅为 thinking 配置重部署 `chat-api-proxy`。生成 bundle 与 SQL 副本由对应维护者从源文件同步。

## 三种原生 API 协议

供应商新增 API 协议下拉框（`auto/responses/messages/chat`），模型继承供应商协议。`auto` 保留 URL 后缀推断和裸 `/v1` 默认 Responses；显式选择覆盖地址末尾已有的端点，在原版本根上追加所选规范端点。验证保存、编辑回填、清空恢复 auto、语言切换不丢未保存选择，以及遗漏字段的旧客户端更新不会重置显式协议。数据库迁移回归在可丢弃本地 PostgreSQL 中模拟旧表缺列、升级默认 auto、重复运行不重置已选协议和无效值拒绝；该数据库回归需要额外运行环境，语法解析不能替代执行。

内部 Chat 与管理员测试输出仍为 Responses 事件，原生请求转换与用量结算在服务端完成；对外代理三条接口按原生 JSON/SSE 透传，不自动跨协议转换。

验收应覆盖：原生 request body / header、文本和附件转换、system 前缀、碎片 UTF-8/SSE、终止状态、缺失用量、配额缩小输出预算、停止/中断、密钥隔离、Claude `x-api-key` 与冲突凭证、版本头、固定 custom URL 边界。Responses 加密 reasoning 无法跨协议保留，非 Responses 应拒绝该配置/内容。HTTP mock 支持各接口与别名，但生产适配器必须另跑真实 handler mocked integration。

```bash
node tools/test-chat-core.mjs
node tools/test-chat-admin.mjs
node tools/chat-mock-server.mjs --self-test
python tools/test-chat-proxy-sql.py --syntax-only
node tools/build-chat-file-bundle.mjs
node tools/build-chat-dashboard-bundles.mjs
node tools/build-chat-dashboard-bundles.mjs --check
# 用已安装 Deno 执行，所有 fetch / DNS / Secrets 都由测试替身处理。
deno run tools/test-chat-protocol.ts
deno run --allow-env tools/test-chat-backend.ts
deno run --allow-env tools/test-chat-api-proxy.ts
```
