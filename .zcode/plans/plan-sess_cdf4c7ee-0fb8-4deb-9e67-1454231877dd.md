## 实施方案

### 1. 数据库与服务端契约

1. 在 `supabase/club-chat-schema.sql` 增加模型访问范围：
   - `chat_models.visibility`，取值 `all` 或 `assigned`，已有模型默认 `all`。
   - `chat_model_access(model_id, user_id, created_by, created_at)`，主键为 `(model_id, user_id)`，并建立按用户查询的索引。
   - 启用 RLS，撤销 `public`、`anon`、`authenticated` 的表权限，仅允许 `service_role` 通过 Edge Function 使用。
2. 增加严格的访问名单 RPC/action 契约：
   - 读取某模型当前范围和授权用户列表。
   - 保存完整用户 UUID 列表，带模型 ID 和乐观版本号。
   - RPC 以 Edge Function 传入的可信管理员身份重新检查动态超管权限，不信任客户端传入的 actor。
   - 拒绝非 UUID、重复/过量名单、未知字段、错误类型和过期版本；清单为空时只有 `all` 模式允许，`assigned` 模式明确表示无人可用。
3. 增加用户自定义模型配置表/RPC：
   - 只保存当前账户拥有的非敏感字段：profile ID、显示名称、上游 model ID、固定代理 BaseURL、配置版本和时间戳。
   - 不设计 `api_key` 列，也不接受 payload 中的 `api_key`、secret、provider URL 变体或任意额外字段。
   - RPC 以 Edge Function 已验证的用户 ID 为准，严格限制字段长度、模型 ID 格式、版本和固定 URL 结构。
   - 固定 URL 必须是 HTTPS、指定 hostname、指定 `/functions/v1/chat-api-proxy/` 前缀下的合法 route，禁止 query、hash、credentials、额外 `/responses` 路径或其他 Supabase 项目。
   - 提供读取、保存、删除配置操作，使用版本控制避免多设备覆盖。

### 2. Chat Edge Function 的模型授权

1. 在 `supabase/functions/chat/index.ts` 增加统一模型访问判断：
   - `visibility=all` 对所有已绑定成员开放。
   - `visibility=assigned` 仅当当前用户出现在 `chat_model_access` 时开放。
   - 仍先执行 JWT、profile、黑名单和现有成员校验。
2. `catalog` 只返回当前用户有权访问的启用模型及其既有安全 metadata。
3. `respond`/普通生成在解析 UUID 后再次检查访问权，直接伪造隐藏模型 UUID 必须拒绝，不能依赖前端目录过滤。
4. `admin_test` 明确采用管理员可测试 assigned 模型的策略，但仍要求动态超管；普通成员不得通过该 action 绕过限制。
5. 增加模型访问管理 action，并将它加入 Edge action allowlist；普通成员调用必须返回 403。
6. 扩展 `admin_get` 或专用读取 action 以供管理页加载当前模型范围和授权名单，但不把大名单混入普通模型保存 payload。
7. 重新生成 `docs/chat-deployment/chat-dashboard-index.ts` standalone Dashboard 源码；不要求用户部署 `_shared`，不部署线上环境。

### 3. 超管模型设置 UI

1. 修改 `public/chat-admin.html`、`public/chat-admin.js`、`public/chat-admin-i18n.js`，在模型设置中增加：
   - “全体成员可用 / 仅指定用户开放”选择。
   - 指定用户多选列表，使用已有 `admin_user_directory` 的最小用户字段。
   - 当前范围和已授权用户状态展示。
   - 独立保存访问名单操作，避免把大量 user ID 混入 `save_model`。
2. 编辑模型时读取并填充当前范围；保存模型基本配置与访问名单时分别携带版本号，发生冲突时重载并提示，不自动覆盖。
3. 当切换回 `all` 时清理或忽略旧名单，保证旧数据不会意外改变目录授权；当切回 `assigned` 时保留已保存名单并明确展示。
4. 仅在动态超管已验证、当前操作未被取消且模型 ID 有效时启用控件；保留现有 epoch/abort 防止旧账户响应恢复敏感状态。
5. 所有动态文案加入中英文，集中在刷新函数中渲染，监听 `club:langchange`，同时适配暗色和亮色主题。

### 4. 成员 Chat 自定义代理模型

1. 修改 `public/chat.html`、`public/chat.js`、`public/chat.css`、`public/chat-i18n.js`，增加模型配置面板：
   - 显示名称、上游 model ID、固定代理 BaseURL、API Key。
   - 固定上下文窗口、输出上限、reasoning/图片/PDF 等安全默认 metadata，不允许用户填写完整能力参数。
   - 提供保存、更新、删除非敏感配置，以及清除当前页面内存 key 的操作。
   - 明确显示“配置随账户保存，API Key 仅保存在当前页面内存，不上传服务器”。
2. 自定义模型只接受严格固定的社团代理 URL；前端表单、云端配置 RPC 和请求前再次校验同一 URL 规则。
3. 内置模型继续调用现有 `chat` Edge Function；自定义模型不得进入 `respond`、`admin_test`、usage、quota 或现有服务端 provider resolver。
4. 自定义模型采用浏览器直接 `POST {baseURL}{route}/v1/responses`：
   - API Key 只放入当前请求的 `Authorization` header。
   - 不写入 URL、请求体、对话对象、导出文件、云端配置、日志或任何 Edge Function 审计记录。
   - 不自动调用真实供应商验证 key，不自动换 key 重试；请求失败只显示错误。
   - 复用 `buildContext()`、`readResponses()`、`continuation()`，支持 JSON/SSE 响应、取消和现有附件限制。
   - 明确该 direct proxy 路径不经过现有 Chat quota/usage，避免误导用户。
5. 自定义模型记录使用明确的 `source/profileId` 标识，与服务端 catalog UUID 分离；生成、模型切换、附件校验和上下文计算都按 profile metadata 工作。
6. API Key 采用 memory-only：
   - 不使用 `localStorage`、IndexedDB、conversation store、云端表或 URL。
   - 页面刷新、登出、账户切换和 `epoch` 变化清空旧 key。
   - 账户切换时先中止旧请求、清空旧模型/配置/密钥，再加载新账户配置；旧账户 key 绝不出现在新账户模型选择器中。
7. 云端配置读取/保存使用独立 Chat action/RPC，严格拒绝包含 `api_key` 的请求；删除账户配置后不影响本地对话记录。

### 5. 本地存储与生命周期

1. 保持现有 `conversations` IndexedDB store 只保存对话，不在其中增加 API Key。
2. 如实现需要浏览器缓存非敏感配置，也只缓存 profile metadata，并按 user ID 隔离；默认以云端配置为唯一恢复来源，避免把敏感字段引入现有导出路径。
3. 扩展登出、账户切换、请求取消和页面卸载路径，确保 memory-only key 与活动请求引用都被清理。

### 6. 测试与文档

1. 扩展 `tools/test-chat-backend.ts`：
   - `all`/`assigned` catalog 过滤。
   - 未授权用户直接提交隐藏模型 UUID 被拒绝。
   - 已授权用户可 catalog/respond。
   - 未绑定用户、普通成员和普通管理员伪造 access action 均被拒绝。
   - admin_test 对 assigned 模型的明确管理员策略。
   - 自定义配置 payload 含 `api_key`、错误 URL、额外字段、越权 user ID 均拒绝。
2. 扩展 `tools/test-chat-admin.mjs` 与必要的 Chat 前端测试：
   - 范围选择、多选名单、冲突重载和语言刷新。
   - 自定义 profile 保存不携带 API Key，账户切换/登出清除 key，导出和 conversation 不含 key。
   - 固定 URL、请求分流、SSE/JSON、错误和取消行为。
3. 更新 `docs/chat-deployment.md` 和 `docs/chat-validation/README.md`：
   - 说明模型授权是服务端强制边界。
   - 说明自定义代理是浏览器直连，不受现有 Chat quota/usage 控制。
   - 说明 API Key 仅当前页面内存保存、刷新后重新输入，以及代理转售许可、tools/MCP/远程资源风险。
   - 说明 Dashboard standalone 部署顺序和线上必须核对的 RLS、RPC grants、Secrets、函数源码。
4. 本地验证：
   - `npm exec --yes --package=deno -- deno check` 检查生产函数、测试和 standalone bundle。
   - `python tools/test-chat-quota-sql.py --syntax-only`。
   - `node tools/check-gomoku-sql-syntax.mjs`，确保 SQL 由真实 PostgreSQL parser 解析。
   - Chat backend/proxy/admin/core/mock 回归测试。
   - secret scan、`git diff --check`。
   - 不连接线上 Supabase/PostgreSQL，不调用真实供应商，不读取真实 API Key，不部署 SQL/Edge Function，不 commit 或 push。

### 7. 交付边界

完成后只交付本地代码、standalone Dashboard 源码、测试和文档变更，并列出需要用户在 Supabase Dashboard 手动部署/执行的文件；不会替用户执行线上部署或数据库变更。