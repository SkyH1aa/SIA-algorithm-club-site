## 实施计划：Chat 用户黑名单与多周期 Token 限额

### 1. 明确定额语义并建立数据库计量层

新增到 `supabase/club-chat-schema.sql`，保持现有 Chat 表的 RLS、service role-only 访问和幂等升级风格：

- `chat_quota_settings`：单例配置，保存总体每日 token 上限、版本号、更新时间和修改人。
- `chat_user_quota_settings`：按 `user_id` 保存用户每日、每周、每月 token 上限；未设置表示继承无限制。
- `chat_user_blacklist`：按 Auth `user_id` 保存黑名单状态、原因、操作人和时间。
- `chat_token_usage_buckets`：按用户和 UTC 日/周/月保存已预扣/已结算 token；另外保存总体 UTC 日桶。
- 必要索引、外键、非负计数约束、RLS、service role 授权和幂等 seed/migration。

限额采用 UTC 日历周期：

- 日：UTC 00:00 到次日 UTC 00:00。
- 周：UTC 周一到下周一。
- 月：UTC 每月 1 日到下月 1 日。
- 新安装默认不限制，避免升级后突然中断现有服务。
- 黑名单只阻止新的 `respond`/`admin_test` admission，不自动中断正在进行的流。

### 2. 使用原子 RPC 执行黑名单、限额和并发控制

在同一 SQL 主脚本中新增 service-role-only RPC：

- `chat_begin_generation(...)`：在一次事务中检查黑名单、获取用户 generation lease、锁定对应周期桶和总体日桶、计算可用 token，并插入 `chat_usage` 的预审计行。返回允许/拒绝、拒绝码、各周期剩余额度和本次 `max_output_tokens`。
- `chat_finish_generation(...)`：按 `request_id` 幂等结算实际供应商 `input_tokens/output_tokens/total_tokens`，将预扣额度调整为实际额度；对于取消、EOF、失败或无 usage 的不确定请求保留保守预扣，不把可能已计费的请求退回。
- `chat_quota_get(...)`：返回当前用户或管理端选定用户的额度、已用、剩余和下次重置时间。
- `chat_quota_save(...)`：超管修改总体每日额度或单用户日/周/月额度，带版本号检查，避免两个管理标签页互相覆盖。
- `chat_blacklist_set(...)`：超管按 Auth UUID 设置/解除黑名单并保存原因。
- `chat_user_directory(...)`：超管专用，复用现有用户/会员资料目录，返回最小字段 `user_id`、`username`、`member_name`、绑定状态；前端下拉框显示用户名，提交始终使用 UUID。

所有 admission 必须在 Edge Function 调用供应商前完成。不能用“先查询 usage、再插入 usage”的非原子方式，否则并发请求会同时越过总体每日额度。RPC 使用数据库时间和固定锁顺序，确保用户额度、总体额度、黑名单和 lease 的并发结果可预测。

### 3. 实现“超限直接截断”规则

在 Edge Function 构造完真实输入并得到供应商默认输出预算后：

- 以当前请求的估算输入 token 加管理员默认输出预算计算本次最大需求。
- RPC 返回的有效额度不足以覆盖完整输出预算时，将本次上游 `max_output_tokens` 缩小为剩余额度减去估算输入 token 的可用部分。
- 若剩余额度连估算输入 token 都无法覆盖，则返回 `429 quota`，不调用上游。
- 将实际缩小后的输出预算写入 usage 审计和上游请求，SSE 仍按现有 `incomplete`/终态逻辑保存部分回复；用户端显示“已达到 Chat token 限额，本轮已截断”而不是泛化请求失败。
- 总体每日额度与用户日/周/月额度同时生效，取最小可用预算。
- 真实上游 usage 回来后由 finish RPC 结算；没有 usage 或请求在上游已启动后中断时保留预扣，避免通过取消、EOF 或异常绕过硬限额。
- `admin_test` 也进入总体每日额度；其用户额度是否限制管理员本人按同一规则处理，超管仍可管理配置和解除黑名单。

这意味着“强行截断”发生在请求发往上游之前通过缩小输出上限，并由供应商的 `incomplete` 终态完成本轮截断；如果输入本身已超出剩余额度，则只能安全拒绝，不能删除或篡改用户历史上下文。

### 4. 扩展 Edge Function 动作与错误契约

更新 `supabase/functions/chat/index.ts`：

- `Model` 和现有 generation 流程接入 begin/finish RPC。
- 新增 `quota`、`admin_quota_get`、`admin_quota_save`、`admin_user_directory`、`admin_blacklist_list`、`admin_set_blacklist` 等动作及严格 allow-list。
- 普通 `catalog` 返回当前用户黑名单/额度摘要；黑名单用户仍可得到明确 `403 blacklisted`，不暴露配置详情。
- `respond` 和 `admin_test` 每次都重新执行原子 admission，不能信任 catalog 缓存。
- 额度不足返回 `429 quota`，附带 reset 信息；黑名单返回 `403 blacklisted`；管理员配置冲突返回 `409 conflict`。
- 保留现有身份验证、动态超管检查、usage metadata-only、lease、SSE 和账号隔离。

### 5. 管理端 UI

更新 `public/chat-admin.html/js/css/i18n`：

- 新增“总体每日 token 限额”面板。
- 新增用户选择下拉框，选项显示 `用户名 · 真实姓名`，值使用 Auth UUID；不接受手工输入用户名作为权限目标。
- 新增单用户每日/每周/每月 token 限额输入，支持清空表示不限额。
- 新增黑名单开关、原因输入、保存/解除按钮和当前状态。
- 展示用户当前周期已用、剩余和重置时间；所有数值由服务端返回，前端不自行计算为权威结果。
- 处理额度 429、黑名单 403、版本冲突和普通管理权限错误；黑名单管理员仍可访问配置管理页。
- 中英文、亮暗主题、动态语言刷新和现有 account epoch/clear-sensitive 状态逻辑同步维护。

### 6. 成员端反馈

更新 `public/chat.js`、`chat-i18n.js`：

- catalog 或 generation 收到黑名单时显示明确的禁止使用提示。
- 收到 quota 时显示当前周期已达上限、下次重置时间和本轮已截断/未发起状态。
- 生成被缩短时保留已收到的文本和 `incomplete` 状态，不显示旧的泛化“请求失败”。
- 不在 IndexedDB 或前端持久化额度权威数据；额度只来自 Edge Function。

### 7. Mock、测试和真实数据库验证

同步 `tools/chat-mock-server.mjs`、`tools/test-chat-backend.ts`、`tools/test-chat-core.mjs` 和验证文档：

- 覆盖超管配置总体额度、用户额度、下拉目录、黑名单设置/解除、普通用户访问拒绝。
- 覆盖额度不足时不调用上游、输出预算被缩小、SSE incomplete 保留部分输出。
- 覆盖日/周/月边界、全局日限额、取消/失败保留预扣、重复 finish 不重复计量、账号切换和旧请求隔离。
- mock 只模拟契约；新增真实 PostgreSQL 集成测试/SQL 验收，验证 `SELECT FOR UPDATE`/advisory lock 下并发 admission 只能成功一次、migration 可重复执行且不会重置配置。
- 运行 JS/Deno 语法、Chat core、mock 自检、Edge Function handler 测试、pglast SQL 解析、`git diff --check`。

### 8. 部署边界

完成后只更新本地代码和文档，不执行线上 SQL、不部署 Edge Function、不调用真实供应商、不提交或推送。上线时需先执行新的 Chat 主 SQL，再部署 Edge Function，最后发布静态前端；默认限额保持不限，超管配置后才启用实际限制。