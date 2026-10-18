# Supabase 网页手动粘贴部署

此目录已包含 Chat 三协议支持、供应商 API 协议下拉配置和已撤销代理路由/密钥彻底删除功能所需的完整后端文件。你不需要安装或运行 PowerShell、Supabase CLI、Deno 或构建命令。以下操作均在 Supabase 网页 Dashboard 完成。

## 文件对应关系

| 本目录文件 | 粘贴位置 |
| --- | --- |
| `club-chat-schema.sql` | SQL Editor → 新建查询 → 全文粘贴 → Run |
| `chat-dashboard-index.ts` | Edge Functions → `chat` → Code → `index.ts`，全文替换后 Deploy updates |
| `chat-api-proxy-dashboard-index.ts` | Edge Functions → `chat-api-proxy` → Code → `index.ts`，全文替换后 Deploy updates |

两份 TypeScript 文件都是独立的单文件版本，已内联共享代码及协议适配器。不要改粘 `supabase/functions/` 中带相对 import 的开发源文件，也不要把两份文件拼进同一个函数。只替换一小段旧函数会漏掉其他依赖，必须全文替换。

`club-chat-schema.sql` 是完整主脚本 `supabase/club-chat-schema.sql` 的同步副本，不是另一套迁移。只执行其中一份，不需要把两个路径的文件各执行一次。已有安装也需要执行新版完整脚本，以更新供应商协议字段、自定义模型地址约束和 RPC；保留原有配置和使用记录，不要删除重建已有表。

## 网页操作顺序

1. 确认打开的是正确的 Supabase 项目。更新已有服务时，先暂停新请求并等待当前生成结束。
2. 打开 SQL Editor，新建查询，将本目录 `club-chat-schema.sql` 的全部内容粘贴进去并运行。项目需已有社团账号和成员资料表；若 SQL 报错，保留错误信息，不要用删表来解决。
3. 在 Edge Functions 的 Secrets 页面配置或确认已有 Secrets。实际供应商 Key 只能保存在这里，不要粘进 TypeScript、SQL、网站脚本或模型配置。
4. 分别打开 `chat` 和 `chat-api-proxy` 的代码编辑器，将对应单文件全文替换进 `index.ts`，各自点击部署更新；尚不存在的函数可以在网页编辑器创建，名称必须准确。已有三协议部署如果只升级本次 `claude_thinking`，仅需部署新版 `chat`，原生代理行为未改变，不必仅为此重部署代理。
5. 在两个函数各自的配置中关闭网关 JWT 验证（通常显示为 **Verify JWT with legacy secret** 或类似名称），保存设置。函数自身仍验证身份：`chat` 验证成员 JWT 和权限；代理验证 `cap_` 访问密钥。尤其代理 Key 不是 Supabase JWT，若保留网关验证会在进入函数前被拒绝。
6. 发布网站仓库中已经更新的前端脚本。Supabase 的 SQL / Edge 编辑器不负责更新你的静态网站；这一步按网站原有的网页发布方式完成，不要求使用 CLI。本次在供应商配置新增 API 协议下拉框，模型表单增加继承协议说明，其余布局保持原样。
7. 打开网站 Chat 管理页配置供应商和模型。保存配置不会自动调用供应商；“测试调用”会产生真实请求，只有你确认后再执行。

## Secrets

在 Supabase 网页 Secrets 中逐项维护，以下仅是变量名与占位说明，不要原样当作真实值：

- `SUPABASE_URL`：项目 URL，若平台已提供则保留。
- `SUPABASE_ANON_KEY`：项目公开 anon key，若平台已提供则保留。
- `SUPABASE_SERVICE_ROLE_KEY`：仅服务端使用的项目密钥，若平台已提供则保留，不要复制到前端。
- `CHAT_CORS_ORIGINS`：网站精确 origin，例如 `https://你的账号.github.io`，不包含仓库路径或尾斜杠。多个来源用英文逗号分隔。
- `CHAT_KEY_CLAUDE` 等 `CHAT_KEY_*`：实际供应商 API Key。在管理页的 Secret 名称输入框中只填此变量名。
- `CHAT_PROXY_CORS_ORIGINS`：可选的对外代理浏览器来源白名单，与 `CHAT_CORS_ORIGINS` 分开。未设置时代理允许任意浏览器 origin，但仍要求有效代理访问密钥。

## 在现有管理表单添加 Claude

- API 协议：下拉框选择 **Claude Messages**。
- Base URL：`https://api.anthropic.com/v1`，或供应商实际提供的版本根地址；已有 `/v1/messages` 地址也可保留。
- 认证头：原生 Claude 选择 `x-api-key`；Bearer 中转按其要求选择 `authorization`。
- Secret 名：例如 `CHAT_KEY_CLAUDE`，不填写真实 Key。
- 模型：关联上述供应商，模型 ID 填供应商实际提供的 ID。
- 关闭“保留加密思考内容”。图片/PDF 按该模型实际能力开启。Messages 使用独立的 Claude thinking 配置，初始选择 **omit（不发送，由供应商决定）**；旧通用 effort 仍保存，但不再影响 Messages，也不自动把旧 low/medium/high 转成预算。Responses / Chat Completions 仍使用通用 effort。

### Claude thinking 的四种模式

| 模式 / 配置 | 行为 |
| --- | --- |
| `{"mode":"omit"}` | 不发送 thinking 或 effort，供应商默认行为；不等于明确关闭 |
| `{"mode":"disabled"}` | 明确发送 `thinking.type=disabled` |
| `{"mode":"enabled","budget_tokens":1024}` | 手动预算，原值发送；模型默认输出与每次实际输出必须严格大于 1024 |
| `{"mode":"adaptive"}` | 自适应思考，不发送 effort，使用供应商默认值 |
| `{"mode":"adaptive","efforts":["medium"],"default_effort":"medium"}` | 自适应思考，另发 `output_config.effort=medium` |

JSON 必须是对象，未知键拒绝。只有 enabled 可以有 `budget_tokens`（整数且至少 1024）；只有 adaptive 可以有 `efforts/default_effort`。adaptive 的数组可省略或为 `[]`；默认值可省略或为 `null`，非空值必须在数组内。数组不允许重复，候选值为 low、medium、high、xhigh、max，具体支持范围依模型版本和供应商而变；none 不是 effort，显式关闭请选择 disabled。`output_config.effort` 与 `thinking.type` 各有作用，手动模式不能用 effort 代替预算。

手动模式示例为预算 **1024**、默认输出 **4096**、最大输出至少 **4096**，测试调用输出选 **2048 或 4096**。模型默认输出、管理员测试输出和额度收缩后的实际输出任一小于等于 1024 都拒绝，不自动缩小预算。不要把测试输出降到 128 或 1024 仍期待手动思考工作。新建遗漏专用字段默认 omit，更新遗漏字段保留原值；旧模型迁移也默认 omit，需要管理员按供应商支持重新配置。

原用户的 `claude-haiku-5-5` 是第三方供应商别名，应先保留已知可用的 omit；只有用户明确启用且供应商确认后才尝试 adaptive + medium，不根据名称猜测转发能力。Anthropic 官方已记录原生 Haiku 5.5 的 adaptive 默认、默认 medium、手动预算不兼容与版本相关的 effort 支持，不能外推为该别名的能力。原生模型默认省略 thinking 摘要，因此没有可见推理不等于关闭思考；本次没有新增推理展示。参考 [官方固定版模型说明](https://github.com/anthropics/skills/blob/9d630808e4add0a7146de4af9384155d5dee350a/skills/claude-api/shared/model-migration.md)、[官方固定版 SDK](https://github.com/anthropics/anthropic-sdk-typescript/blob/ca50812ed769a40510bb2f9e5e232e95cdd376f1/src/resources/messages/messages.ts)、[Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)、[Adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)、[Effort](https://platform.claude.com/docs/en/build-with-claude/effort)。没有进行真实供应商验证。

供应商表单现在提供“API 协议”下拉框，保存后关联模型会使用该协议：

| 下拉选项 | 请求端点 |
| --- | --- |
| 自动识别（兼容旧配置） | 根据 URL 后缀识别；裸 `/v1` 默认 Responses |
| Responses | 在版本根地址后使用 `/responses` |
| Claude Messages | 在版本根地址后使用 `/messages` |
| Chat Completions | 在版本根地址后使用 `/chat/completions` |

显式选择优先于 URL 后缀。例如地址保留 `/v1/responses`，选择 Claude Messages 后实际请求 `/v1/messages`，不会拼成 `/responses/messages`。原始地址保存在表单中；版本路径（例如 `/v1`）不会自动添加，按供应商要求填写。认证头仍单独配置，不会随协议自动改动。同一上游有不同协议的模型时，建立多个供应商配置并分别选择协议，再让模型关联相应供应商。

已有供应商默认“自动识别”，保留之前的行为：`/v1/messages` 使用 Messages，`/v1/chat/completions` 使用 Chat Completions。`/v1/message` 作为别名会规范为 `/v1/messages`；Responses 标准路径是复数 `/v1/responses`，不支持 `/v1/response`。

本次新增数据库 `api_protocol` 字段，专用 `claude_thinking` 迁移也必须先运行目录完整 SQL，再部署新版 `chat-dashboard-index.ts`，最后发布管理页与成员页静态资源（包括 file bundle 和 i18n）。只更新前端会导致旧后端拒绝新字段；只更新函数而未运行 SQL 会导致模型读取失败。`chat-api-proxy` 原生转发行为未改变，仅因本次 thinking 字段不必重部署代理。

## 对外代理

路由中填供应商 HTTPS 版本根地址（例如 `https://api.anthropic.com/v1`）及 Secret 引用名。对外使用以下接口，模型 ID 和请求格式由客户端按原生协议提供：

- `https://<项目>.supabase.co/functions/v1/chat-api-proxy/<路由UUID>/v1/responses`
- `https://<项目>.supabase.co/functions/v1/chat-api-proxy/<路由UUID>/v1/messages`
- `https://<项目>.supabase.co/functions/v1/chat-api-proxy/<路由UUID>/v1/chat/completions`

代理不会把一种原生请求转换成另一种；Claude 上游应使用 Messages 接口。OpenAI SDK 的 baseURL 填到 `/v1`，Anthropic SDK 会自行附加 `/v1/messages`，因此其 baseURL 填到 `<路由UUID>`，不带末尾 `/v1`。

代理访问密钥是管理页生成的一次明文 `cap_…`，不是供应商 Key。三条接口均可用 Bearer，Messages 还支持 `x-api-key`。默认 Anthropic 版本头为 `2023-06-01`。上线前自行核对上游代理/转授权许可、工具和远程资源权限及预算。

## 已撤销路由与密钥的彻底删除

本次更新仍按上面的网页顺序部署：运行本目录新版完整 SQL，全文替换 `chat-dashboard-index.ts` 到 `chat` 函数，并发布网站的 `public/chat-admin.js` 和 `public/chat-admin-i18n.js`。`chat-api-proxy` 单文件也已同步保存在本目录；本次删除操作不改变三协议转发接口。

- 路由先执行“撤销路由”，失效记录旁会出现“彻底删除”；确认后实际删除该路由、其全部访问密钥及关联租约。
- 密钥先执行“撤销”，记录旁会出现“彻底删除”；确认后实际删除该密钥及其租约。
- 仅暂时停用的记录不能直接彻底删除。删除后刷新列表也不会再次显示，无法恢复，也无法取回旧密钥。
- 只执行 SQL 或部署函数不会自动清理旧记录；删除必须由超级管理员在页面逐项确认。上游供应商 Key 所在的 Edge Secret 不会随路由删除。

## 当前验证边界

这些文件已完成本地源文件一致性检查、Deno 类型检查、模拟协议回归及 SQL 语法解析。没有代你登录 Supabase、运行线上 SQL、部署函数或调用真实供应商；本地验证不能证明网页上的旧函数已更新。
