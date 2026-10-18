# Chat / 管理 / 对外代理安全加固

## 范围与结论

本轮覆盖浏览器 Chat、Chat 管理接口、对外原生 API 代理及相关 SQL 权限。允许 PowerShell、curl、SDK 使用有效凭据调用是接口设计，不是安全漏洞；安全要求是这些客户端也不能绕过服务端认证、模型权限、额度、黑名单或代理 Key 准入。

本轮确认并修复动态管理员授权回退和两类请求体读取资源缺口。没有发现无需 JWT / 有效代理 Key 即可调用上游的已确认路径，也未发现普通成员直接访问 Chat 表或执行受限 RPC 的授权路径。这个结论受下述离线验证范围限制，不是对生产环境或所有攻击方式的无漏洞保证。

未调用真实供应商、未执行付费请求、未读取实际密钥、未部署函数、未操作线上数据库、未 commit 或 push。本轮 SQL、前端页面和五子棋资产未修改。

## 已修复问题

### 1. 动态超管查询异常/空表时，旧邮箱仍可获得管理权限

旧 `isDynamicSuperAdmin` 在名单为空或读取失败时，按固定 bootstrap 邮箱回退授权。攻击前提是持有对应账号的有效 JWT，并且名单为空、缺失或查询失败；不是任意成员或匿名提权。

离线真实 handler mock 复现了管理读取、供应商写入、模型写入和 assigned 模型测试放行，与 SQL 的动态名单检查不一致。

修复后只接受 `club_super_admins` 返回的单条、与已验证 JWT 用户 UUID 精确匹配的记录。空表、缺表、读取失败、畸形响应或不匹配一律拒绝。删除邮箱回退与额外的全表空表查询，不改其他站点的管理员引导逻辑。

回归覆盖初始邮箱及大写、四项管理操作及兼容别名、无 JWT / 无效 JWT、空/失败/缺失/畸形/不匹配结果；拒绝路径无写库、RPC、审计或上游。名单内管理员仍可管理，移除后同一 JWT 的下一次请求即拒绝。

### 2. Chat 在认证前完整读取正文后才检查实际大小

旧入口仅提前检查 `Content-Length`，随后 `request.text()` 完整缓冲，再检查实际字节。无凭据客户端省略或低报长度即可使读取超过 12 MiB，或用未关闭正文延长处理；原读取也未处理请求取消或自身 deadline。离线复现只用了小型受控流，不是生产容量或 OOM 证明。

修复为共享 `readChatBody`，逐块累计实际字节，超过 12 MiB 立即取消并返回 413。非法或超大声明长度也拒绝。Chat 上传读取最多 10 秒，请求取消/读取超时返回 `504 timeout`；取消读取无需等待可能永不完成的 cancel Promise，最终清理 timer/listener 并释放 reader lock。10 秒不限制模型生成，但可能影响慢速网络的大附件上传。

提前取消的请求现在在上传阶段拒绝，不再创建计费预留或租约。生成已获准入、尚未派发上游时发生取消的原有退款行为仍有独立回归。

### 3. 代理长期保留所有网络分片对象

旧代理虽然限制实际字节为 12 MiB，却将每个入站 chunk 长期保留在数组中；有效 Key 请求若形成大量微小分片，可能出现与正文大小不成比例的对象开销。离线 mock 确认放大，不代表生产网络一定保留同等分片或已验证生产 OOM。

共享读取器立即将网络 chunk 复制到最多 64 KiB 的聚合块，不保留网络视图或其大型 backing buffer，存储块数受字节上限约束。每次读取使用独立的取消等待，不向同一个长期 pending Promise 累加每分片 reaction。最终返回原始字节；代理原生 JSON/SSE 的透传、凭据隔离及现有全请求 deadline 不变。

## 仍需明确的设计边界

- **维护开关不是 API 总闸。** `service-gate.js` 只遮盖页面；有效 JWT / 代理 Key 仍可直接调用。没有静默改变全站维护语义或强行把独立代理纳入页面开关。要阻止新付费调用，应停用相应 provider/model 或代理 route，必要时撤销 Key；在途请求不保证被强杀。
- **代理不继承成员 Chat 额度/黑名单。** 它有独立 Key/路由授权与并发租约，但没有每 Key token/金额预算或 model/tools allowlist。持有效 Key 请求上游接受的原生能力是当前合同，不是成员 quota 绕过。
- **隔离上游项目。** tools/MCP、files、vector stores、previous_response_id 和远程资源可能访问共享供应商项目并产生费用。代理 Key 不构成上游租户隔离。应在供应商侧配置独立项目、最小权限和预算。
- **DNS 检查不绑定实际连接 IP。** 检查与 fetch 分离存在 TOCTOU 边界；不能声称完整阻止 DNS rebinding。利用还需要对配置域名/DNS 的控制、有效权限、网络可达性及原 hostname 的 TLS 校验。本轮没有成功 SSRF 的实证。显式私网/混合 DNS、IP URL、redirect 的拒绝有离线覆盖。
- **响应没有累计字节/费用硬上限。** 背压和代理最多 120 秒 deadline 不等于总流量或成本预算；也不能将无总字节上限直接说成全量响应驻留内存漏洞。
- **成功响应不是通用脱敏。** 原生 JSON/SSE 字节透传保留供应商特征与可读思考。非 2xx 脱敏不意味着所有成功事件内容已净化。
- **凭据检查。** Chat 源码中发现的 Supabase publishable 配置是公开客户端配置，不是 service-role Secret。未确认 Chat 中存在真实 secret 字面量。没有读取环境或实际 Secret 文件，也未在线验证任何凭据。

## 本轮验证结果

- Chat 后端：**109** 项真实 handler mock 集成用例通过，含管理员名单异常、直接模型权限、quota/黑名单、上传超限/低报长度、超时和取消、计费结算边界。
- 对外代理：**29** 组通过，含三协议原始字节、缺失/错误/撤销/跨路由 Key、SSRF 拒绝边界、分片聚合、deadline 与租约释放。
- 共享请求体读取：**16** 组通过，含大量单字节/空分片、大 backing buffer 视图复用、每轮独立 interruption Promise、never-settling cancel 及清理。
- 协议适配：**19** 项通过。Chat core/UI、thinking 及管理页 **123 次 mock 请求**回归通过。
- 源码与两份独立 Dashboard bundle 的 Deno 类型检查、bundle/完整 SQL 副本一致性、`git diff --check` 通过。仓库规定的训练模型重建及语法检查通过，未产生训练数据/模型内容变更。
- 独立 fresh PGlite 完整安装及幂等重装均通过。实际枚举 **15 张 Chat 表、23 个函数**：全部表启用 RLS；`PUBLIC/anon/authenticated` 的相关 ACL 残留为零。anon/authenticated 的全部表权限与函数 EXECUTE 均拒绝；service_role 仅具表 SELECT/INSERT/UPDATE/DELETE 和 21 个对外函数 EXECUTE，两个私有 helper 不可直接执行。实际 `SET ROLE` 的 **338 次禁止操作**均返回 SQLSTATE 42501；service_role 的 **120 次四类表操作 no-op**成功。此结论仅对应新建离线库，不代表线上实际 ACL 已核实。

## 离线验证方法

Deno 测试中的 fetch / DNS 均为 mock，不授予网络权限。`--allow-env` 仅供测试设置合成配置；代码或日志不包含真实凭据。

```sh
deno run --allow-env tools/test-chat-body.ts
deno run --allow-env tools/test-chat-api-proxy.ts
deno run --allow-env tools/test-chat-backend.ts
deno run tools/test-chat-protocol.ts
node tools/test-chat-core.mjs
node tools/test-chat-thinking.mjs
node tools/test-chat-admin.mjs
node tools/build-chat-dashboard-bundles.mjs --check
git diff --check
```

工具不需要由部署者执行；Supabase 网页部署说明见 `../chat-deployment/README.md`。Deno 若不在 PATH，维护者可使用现有安装的绝对路径，部署者无需安装。

SQL 使用 fresh PGlite 验证完整主 schema 及幂等重装、RLS/ACL、usage 报告和清理边界。该环境不是生产数据库：没有核实线上历史额外 grants/角色继承，不建立真实多会话并发、pg_cron 执行或供应商行为的保证。也没有通过线上 PowerShell 探测来证明已部署版本安全。
