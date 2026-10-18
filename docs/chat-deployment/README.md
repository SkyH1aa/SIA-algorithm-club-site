# Supabase 网页手动粘贴部署

此目录已包含本次 Chat 三协议更新需要的完整后端文件。你不需要安装或运行 PowerShell、Supabase CLI、Deno 或构建命令。以下操作均在 Supabase 网页 Dashboard 完成。

## 文件对应关系

| 本目录文件 | 粘贴位置 |
| --- | --- |
| `club-chat-schema.sql` | SQL Editor → 新建查询 → 全文粘贴 → Run |
| `chat-dashboard-index.ts` | Edge Functions → `chat` → Code → `index.ts`，全文替换后 Deploy updates |
| `chat-api-proxy-dashboard-index.ts` | Edge Functions → `chat-api-proxy` → Code → `index.ts`，全文替换后 Deploy updates |

两份 TypeScript 文件都是独立的单文件版本，已内联共享代码及协议适配器。不要改粘 `supabase/functions/` 中带相对 import 的开发源文件，也不要把两份文件拼进同一个函数。只替换一小段旧函数会漏掉其他依赖，必须全文替换。

`club-chat-schema.sql` 是完整主脚本 `supabase/club-chat-schema.sql` 的同步副本，不是另一套迁移。只执行其中一份，不需要把两个路径的文件各执行一次。已有安装也需要执行新版完整脚本，以更新自定义模型地址约束和 RPC；保留原有配置和使用记录，不要删除重建已有表。

## 网页操作顺序

1. 确认打开的是正确的 Supabase 项目。更新已有服务时，先暂停新请求并等待当前生成结束。
2. 打开 SQL Editor，新建查询，将本目录 `club-chat-schema.sql` 的全部内容粘贴进去并运行。项目需已有社团账号和成员资料表；若 SQL 报错，保留错误信息，不要用删表来解决。
3. 在 Edge Functions 的 Secrets 页面配置或确认已有 Secrets。实际供应商 Key 只能保存在这里，不要粘进 TypeScript、SQL、网站脚本或模型配置。
4. 分别打开 `chat` 和 `chat-api-proxy` 的代码编辑器，将对应单文件全文替换进 `index.ts`，各自点击部署更新；尚不存在的函数可以在网页编辑器创建，名称必须准确。
5. 在两个函数各自的配置中关闭网关 JWT 验证（通常显示为 **Verify JWT with legacy secret** 或类似名称），保存设置。函数自身仍验证身份：`chat` 验证成员 JWT 和权限；代理验证 `cap_` 访问密钥。尤其代理 Key 不是 Supabase JWT，若保留网关验证会在进入函数前被拒绝。
6. 发布网站仓库中已经更新的前端脚本。Supabase 的 SQL / Edge 编辑器不负责更新你的静态网站；这一步按网站原有的网页发布方式完成，不要求使用 CLI。本次没有修改 Chat 和管理页的 HTML/CSS 布局。
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

- Base URL：`https://api.anthropic.com/v1/messages`，或供应商实际提供的 Messages 地址。
- 认证头：原生 Claude 选择 `x-api-key`；Bearer 中转按其要求选择 `authorization`。
- Secret 名：例如 `CHAT_KEY_CLAUDE`，不填写真实 Key。
- 模型：关联上述供应商，模型 ID 填供应商实际提供的 ID。
- 关闭“保留加密思考内容”。图片/PDF 按该模型实际能力开启。思考强度不确定时先留空；当前固定预算映射支持 `none/low/medium/high`，不支持 adaptive-only 配置。

现有供应商表单通过地址识别协议，无需新增 UI：

| Base URL 结尾 | 内部 Chat 协议 |
| --- | --- |
| `/v1` 或 `/v1/responses` | Responses，原有配置继续有效 |
| `/v1/messages` | Claude Messages |
| `/v1/chat/completions` | Chat Completions |

`/v1/message` 作为别名会规范为 `/v1/messages`；Responses 标准路径是复数 `/v1/responses`，不支持 `/v1/response`。

## 对外代理

路由中填供应商 HTTPS 版本根地址（例如 `https://api.anthropic.com/v1`）及 Secret 引用名。对外使用以下接口，模型 ID 和请求格式由客户端按原生协议提供：

- `https://<项目>.supabase.co/functions/v1/chat-api-proxy/<路由UUID>/v1/responses`
- `https://<项目>.supabase.co/functions/v1/chat-api-proxy/<路由UUID>/v1/messages`
- `https://<项目>.supabase.co/functions/v1/chat-api-proxy/<路由UUID>/v1/chat/completions`

代理不会把一种原生请求转换成另一种；Claude 上游应使用 Messages 接口。OpenAI SDK 的 baseURL 填到 `/v1`，Anthropic SDK 会自行附加 `/v1/messages`，因此其 baseURL 填到 `<路由UUID>`，不带末尾 `/v1`。

代理访问密钥是管理页生成的一次明文 `cap_…`，不是供应商 Key。三条接口均可用 Bearer，Messages 还支持 `x-api-key`。默认 Anthropic 版本头为 `2023-06-01`。上线前自行核对上游代理/转授权许可、工具和远程资源权限及预算。

## 当前验证边界

这些文件已完成本地源文件一致性检查、Deno 类型检查、模拟协议回归及 SQL 语法解析。没有代你登录 Supabase、运行线上 SQL、部署函数或调用真实供应商；本地验证不能证明网页上的旧函数已更新。
