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
4. 分别打开 `chat` 和 `chat-api-proxy` 的代码编辑器，将对应单文件全文替换进 `index.ts`，各自点击部署更新；尚不存在的函数可以在网页编辑器创建，名称必须准确。
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
- 关闭“保留加密思考内容”。图片/PDF 按该模型实际能力开启。思考强度不确定时先留空；当前固定预算映射支持 `none/low/medium/high`，不支持 adaptive-only 配置。启用 `low/medium/high` 时，模型默认输出预算和管理员测试预算都需大于 1024；只提高“最大输出”不能改变默认输出。配置不兼容时，管理页会显示具体的思考历史、强度或预算错误。

供应商表单现在提供“API 协议”下拉框，保存后关联模型会使用该协议：

| 下拉选项 | 请求端点 |
| --- | --- |
| 自动识别（兼容旧配置） | 根据 URL 后缀识别；裸 `/v1` 默认 Responses |
| Responses | 在版本根地址后使用 `/responses` |
| Claude Messages | 在版本根地址后使用 `/messages` |
| Chat Completions | 在版本根地址后使用 `/chat/completions` |

显式选择优先于 URL 后缀。例如地址保留 `/v1/responses`，选择 Claude Messages 后实际请求 `/v1/messages`，不会拼成 `/responses/messages`。原始地址保存在表单中；版本路径（例如 `/v1`）不会自动添加，按供应商要求填写。认证头仍单独配置，不会随协议自动改动。同一上游有不同协议的模型时，建立多个供应商配置并分别选择协议，再让模型关联相应供应商。

已有供应商默认“自动识别”，保留之前的行为：`/v1/messages` 使用 Messages，`/v1/chat/completions` 使用 Chat Completions。`/v1/message` 作为别名会规范为 `/v1/messages`；Responses 标准路径是复数 `/v1/responses`，不支持 `/v1/response`。

本次新增数据库 `api_protocol` 字段，必须先运行本目录完整 SQL，再部署新版 `chat-dashboard-index.ts`，最后发布 `public/chat-admin.html`、`public/chat-admin.js` 和 `public/chat-admin-i18n.js`。只更新前端会导致旧后端拒绝新字段；只更新函数而未运行 SQL 会导致供应商读取失败。

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
