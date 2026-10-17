## 实施方案

### 1. 路由删除语义与数据库

- 在 `public.chat_proxy_routes` 增加不可逆的 `deleted_at timestamptz` 字段，并保留原路由行，避免公开 URL 的 UUID 被复用、避免历史引用断裂。
- 扩展 `chat_proxy_admin` 支持 `admin_proxy_route_delete`，输入只接受 `id` 与 `expected_version`，继续由数据库内的动态超管校验保护。
- 删除 action 在单事务内锁定目标路由并做 CAS：
  - 路由不存在返回 `not_found`；版本不符返回 `conflict`；已删除返回明确的不可恢复结果。
  - 将 `enabled=false`、`deleted_at=now()`、版本递增并记录更新时间。
  - 将该路由所有未撤销密钥设为禁用并写入 `revoked_at`，版本递增；这样旧 key 永久失效且不会被重新启用。
  - 删除该路由的活动 lease，释放并发额度；已经通过准入的上游请求不会被强行中断，但后续准入会立即失败，迟到的 release 保持幂等。
- 修改 `chat_proxy_admit`：路由必须同时满足存在、`enabled=true`、`deleted_at is null`；已删除路由返回 `invalid_key`。
- 修改 route 输出/metadata，使管理列表能显示删除状态，但不输出任何 key hash 或明文。删除后的路由不得再被 `admin_proxy_save`、`admin_proxy_route_state` 或 key 创建 action 恢复/使用；新增 route 仍只能由数据库生成新 UUID。
- 保持 RLS、service-role-only RPC grants 不变，并使用真实 PostgreSQL parser 验证 SQL。

### 2. Chat Edge Function 与 Dashboard 部署包

- 在 `supabase/functions/chat/index.ts` 的 proxy action 白名单、字段校验、RPC 分发和错误映射中加入 `admin_proxy_route_delete`。
- 让删除 action 的冲突、已删除、未找到结果按现有管理操作约定返回，不自动重试写入。
- 同步修改 `docs/chat-deployment/chat-dashboard-index.ts`，保证 Supabase Dashboard 手动部署的 standalone Chat bundle 与源函数一致。
- `chat-api-proxy/index.ts` 的 HTTP 路径和上游转发逻辑无需新增公开删除端点；它只通过更新后的 `chat_proxy_admit` 获得删除后的失效行为。其 standalone proxy bundle保持字节/逻辑同步并做检查。

### 3. 超管 UI

- 在 `public/chat-admin.js` 的路由操作区增加危险样式的“删除路由”按钮，删除前显示中英文不可恢复确认，明确说明该路由下所有 key 也会永久失效。
- 扩展路由点击委托、操作选择器和 `proxyMutation`，携带 `id` 与当前 `version` 调用新 action；删除成功后刷新/移除编辑状态，清除相关路由选择和一次性敏感状态，避免旧表单继续操作已删除对象。
- 对已删除路由只显示删除状态，不显示启用/编辑/创建 key 等会产生误导的操作；列表仍保留安全元数据和删除时间，便于识别旧公开 URL。
- 在 `public/chat-admin-i18n.js` 补充中英文按钮、确认、成功、冲突和失败文案；保留动态 i18n 的 key+变量模式并适配现有亮色/暗色样式。
- 如需表格列，使用现有操作区和状态徽章，不改变无关管理布局。

### 4. 测试与文档

- 扩展 SQL 测试覆盖：动态超管权限、严格 payload、CAS 冲突、已删除不可重复删除/恢复、删除同时撤销旧 key、清理 lease、删除后 admission 失败、原 route UUID 不被新建操作复用。
- 扩展 proxy handler/integration 测试：删除后相同 route UUID 返回 401 且不触发上游；删除前已存在的请求只按既有生命周期结束，后续请求不能重新 admission；错误路径和 CORS 行为保持原断言。
- 扩展管理 UI 回归：删除按钮渲染与 HTML 转义、确认取消不发请求、携带版本、成功后状态刷新、冲突不重试、删除路由后不能启用/编辑/创建 key。
- 更新 `docs/chat-deployment.md` 与 `docs/chat-validation/README.md`：说明“删除”是不可恢复墓碑/永久失效，不是物理擦除；旧公开 URL 与旧 key 不可再用；活动请求不被强制终止；需要手动部署 `chat` standalone bundle 并执行更新后的主 SQL。
- 本地验证：`node tools/check-gomoku-sql-syntax.mjs`、Deno check、`node tools/test-chat-admin.mjs`、proxy/backend/mock 测试、`python tools/test-chat-proxy-sql.py --syntax-only`、`git diff --check`。不连接线上 Supabase、不调用真实供应商、不读取真实 API key、不部署、不 commit、不 push。