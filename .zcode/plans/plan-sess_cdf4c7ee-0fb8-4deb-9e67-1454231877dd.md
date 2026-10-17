## 安全加固计划

### 1. 加固 Chat 与代理的服务端边界
- 保持所有 Chat action 的服务端 JWT、成员绑定和动态超管检查，不把前端 `authorized`、页面入口或 CORS 当作授权依据。
- 对 `chat-api-proxy` 增加可选的精确 `CHAT_PROXY_CORS_ORIGINS`：配置后只回显允许的浏览器 Origin；未配置时保留非浏览器 Bearer 客户端的工作方式，不把 CORS 当成 API key 权限控制。
- 保持代理 key、上游 Secret、service-role key 不进入响应、日志、浏览器存储或前端源码；继续限制固定 `/v1/responses` 路径、大小、超时、并发、重定向和公网 URL。
- 对管理输入和数据库 RPC 调用做更严格的内部字段白名单/类型校验，避免 service-role RPC 被错误内部调用时接受任意字段；不向 `anon`/`authenticated` 开放任何 Chat/代理表或 RPC。
- 增补部署校验说明：`verify_jwt=false` 时必须依赖当前 Edge 源码内部鉴权；线上必须核对函数版本、Secrets、RLS、表权限和 RPC execute grants。

### 2. 增加可复现的未授权攻击面回归
扩展本地 handler/mock 测试，覆盖直接 PowerShell/控制台等价请求：
- 无 Authorization、随机/过期 Bearer、Supabase publishable key 冒充用户 token：拒绝。
- 普通已登录但未绑定成员：拒绝 `catalog`/`respond`。
- 普通已绑定成员伪造 `admin_get`、`admin_test`、provider/model/quota/blacklist/proxy 管理 action：全部拒绝。
- 伪造 `user_id`、`p_actor`、额外字段、错误 HTTP 方法、超大/非法 JSON：拒绝且不调用上游或内部管理 RPC。
- 未携带 proxy key、普通 JWT、错误格式 key、跨 route key、禁用/撤销 key：拒绝；有效 key 仍只能访问固定 Responses 路由。
- 验证未知 Origin 在 Chat 和配置了代理 CORS 时被拒绝，同时无 Origin 的 CLI 请求仍由 Bearer/JWT 负责授权。

### 3. 生成手动 Dashboard 部署包
- 修改共享代理 helper、`chat` 或 `chat-api-proxy` 后重新生成两个 standalone Dashboard 源码文件，将内联 helper 与生产源码保持一致。
- 在生成脚本/文档中明确：Dashboard 手动部署不能单独部署 `_shared`，两个函数必须分别粘贴对应单文件；禁止使用旧的带相对 import 的源码。

### 4. 验证与安全报告
运行：
- Deno typecheck（生产函数、共享 helper、测试和 Dashboard standalone 文件）。
- Chat backend、proxy、admin、core 和 mock 回归。
- `pglast` SQL 语法检查与 `git diff --check`。
- 静态扫描真实 secret/service-role key 是否出现在 `public/`、文档、日志或生成包中。

最终报告会区分：
- 已由代码/本地测试确认的服务端阻断；
- 只能通过线上 Supabase 权限/部署核对确认的风险；
- CORS、有效 proxy key、上游转售许可和 service-role Secret 的残余边界。

不会部署线上 SQL、不会调用真实供应商、不会读取或提交真实 API key、不会提交或 push。