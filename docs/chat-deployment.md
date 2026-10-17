# Club AI Chat 部署说明

本文对应仓库中的成员 Chat 页面、Chat 管理页、Supabase Edge Function 和 Chat 配置表。当前静态站实际结构是仓库根目录的 `index.html` 加 `public/` 目录；Chat 页面发布路径为 `public/chat.html`，管理页面发布路径为 `public/chat-admin.html`。

成员页、管理页、Edge Function、Chat SQL 和本地 mock 均已实现。本次只完成本地开发检查和文档核对：没有部署 Edge Function、执行线上 SQL、调用供应商、提交或 push。上线付费验收需要站点所有者自行授权并执行。

## 0. 部署顺序

0. 升级额度版本前，先暂停旧 Edge 的新生成准入并等待已有流结束（必要时在网关/函数层暂停；仅隐藏前端按钮不足以阻止旧客户端调用）。旧 Edge 不执行新额度准入，不能让它在迁移窗口继续接单。
1. **先执行更新后的 Chat SQL**（第 2 节，包括额度、黑名单与预留结算迁移）；保留现有配置和 usage，不删除重建旧表。
2. 设置 Edge Function secrets（第 3 节）。
3. **再部署两个新版 Edge Function `chat` 与 `chat-api-proxy`**，先确认新 RPC 可用。两者均配置 `verify_jwt=false`，但分别在函数内部执行用户 JWT/管理员校验与 proxy key 鉴权。
4. **最后发布新版静态前端**（第 6 节），避免前端提前调用尚不存在的额度或代理管理接口。
5. 在管理页配置 provider/model 并完成授权后的低成本测试（第 4、5、7 节），再恢复生成入口。

**计量起点**：历史 `chat_usage` 不回填额度桶；新额度只从新版 Edge 的 admission/预留开始累计。旧 usage 继续作为历史审计保留，不能把升级后显示的 used 理解为本日/本周/本月所有历史供应商消耗。

## 1. 上线前确认

先确认以下现有基础设施仍然可用：

- Supabase Auth 已启用，成员可通过现有 Member Center 登录。
- `public.club_member_profiles`（现有成员资料/绑定表）已经存在，且登录成员可以绑定中文姓名和班级。
- `public.club_super_admins`（动态超级管理员表）已经存在，并由现有 Admin Hub 权限逻辑维护。
- Edge Function 可以使用 Supabase 项目 URL、匿名 key 和 service role key。service role key 只放 Edge Function secrets，不放任何 `public/` 文件。
- Chat 页和管理页与现有登录账号使用同一个 Supabase 项目。

现有 `admin-hub.html` 已加入仅动态超级管理员可见的 Chat 管理入口；普通成员入口位于：

- `public/member-center.html` 的“常用入口”。
- `public/club-features.html` 的功能卡片。

## 2. 只执行 Chat SQL

上线数据库结构时，在目标 Supabase 项目的 SQL Editor 中只执行：

```text
supabase/club-chat-schema.sql
```

执行前确认当前项目已经有 `auth.users`、`club_member_profiles` 和 `club_super_admins`。这个文件维护 Chat 的 provider、model、usage、generation lease，以及额度设置、分期计数、请求预留和黑名单，并增量维护独立的外部代理路由、key 哈希和在途租约；相关读取、保存、准入与结算 RPC 仅供 service role 使用。已有安装也必须执行本次更新后的完整 Chat SQL，不能只部署前端或 Edge。

禁止为了 Chat 执行旧的 member profile schema，也禁止执行包含 `drop table` 的迁移来“清理”旧资料。特别是不要删除或重建现有 `club_member_profiles`，否则会破坏成员登录后的资料绑定、积分和现有功能。

执行后可以在 Supabase Table Editor 中只读确认这些对象已经出现：

- `chat_providers`
- `chat_models`
- `chat_usage`
- `chat_generation_leases`
- `chat_acquire_generation_lease(uuid, uuid, timestamptz)`
- `chat_release_generation_lease(uuid, uuid)`

Chat 表默认启用 RLS，普通 `anon`/`authenticated` 不直接拥有表权限；Edge Function 使用 service role 访问配置和审计记录。不要为了让前端直连而放开这些表。

## 3. 设置 Edge Function secrets

在 Supabase 项目的 Edge Function secrets 中设置以下变量。变量名可以按项目实际值填写，但值只保存在后端：

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
CHAT_CORS_ORIGINS=https://<site-host>,http://localhost:4173
CHAT_KEY_<PROVIDER_NAME>=<provider-api-key>
```

不要把真实 key 写进本文、Git 仓库、`public/chat*.js`、HTML、浏览器 localStorage 或 IndexedDB。`CHAT_KEY_*` 必须是后端 secret，数据库的 `chat_providers.secret_name` 只保存 secret 的名字，例如 `CHAT_KEY_OPENAI`，不保存 key 的值。

`CHAT_CORS_ORIGINS` 必须是精确的来源 origin，多个来源用英文逗号分隔，不要加入路径、尾斜杠或通配符。例如 GitHub Pages 的仓库站点路径虽然是 `https://<account>.github.io/<repository>/`，CORS 来源仍然只能写：

```text
https://<account>.github.io
```

本地静态服务若运行在 4173 端口，则写 `http://localhost:4173`；如果使用其他端口，按实际 origin 修改。不要把 `https://<account>.github.io/<repository>/public`、`/chat.html` 或 Supabase Function URL 写进 `CHAT_CORS_ORIGINS`。

Edge Function 已经自行校验 Bearer token，并通过 Supabase Auth `/auth/v1/user` 验证当前用户；因此部署时使用独立的函数配置：

```bash
supabase functions deploy chat --no-verify-jwt
supabase functions deploy chat-api-proxy --no-verify-jwt
```

`--no-verify-jwt` 只关闭 Supabase 网关的默认 JWT 校验，方便该函数返回统一的 CORS/错误响应；函数内部仍然必须验证 `Authorization: Bearer <user-access-token>`，并检查成员资料。不要把它理解为允许匿名调用。部署项目和设置 secrets 时按 Supabase CLI 当前登录账号与项目链接执行，避免把 key 直接写在命令历史中。

## 4. 配置 provider

部署函数和执行 Chat SQL 后，使用已授权的超级管理员账号打开：

```text
/public/chat-admin.html
```

管理页中的 provider 配置填写：

- `name`：内部稳定名称。
- `label`：页面显示名称。
- `base_url`：供应商 Responses API 的版本根地址，必须是 HTTPS 公网 URL，例：`https://api.example.com/v1`。
- `secret_name`：与 Edge Function secret 完全一致，例如 `CHAT_KEY_OPENAI`。
- `auth_header`：选择 `authorization` 或 `x-api-key`，按供应商要求填写。
- `enabled`：上线前先保持关闭，完成配置和付费验收后再开启。

`base_url` 不要包含 `/responses`。函数会在后端自动请求：

```text
<base_url>/responses
```

因此应填写 `https://api.example.com/v1`，不要填写 `https://api.example.com/v1/responses`，也不要填写带查询参数、账号密码、私网地址或本地地址的 URL。函数会拒绝非 HTTPS、含凭据、含 query/hash、私网或不合规的 provider URL。

供应商更换 key 时，按以下顺序执行：

1. 在管理页把对应 provider 设为 disabled，确认没有新的上游请求。
2. 在 Supabase Edge Function secrets 中更新同名 `CHAT_KEY_*` secret。
3. 用授权账号通过管理页测试生成，做一次低成本验证。
4. 确认无误后把 provider 恢复到期望的 enabled 状态。

真实 API key 只能写入 Edge Function Secrets；数据库 `chat_providers.secret_name` 和管理页表单都只接受引用名（例如 `CHAT_KEY_OPENAI`）。不要把真实 key 写入前端表单、数据库字段、浏览器 localStorage/IndexedDB、日志、文档或 Git 仓库。供应商平台侧也应按其控制台规则撤销旧 key、创建新 key、限制权限和额度。若供应商更换了 API 版本或认证方式，先停用旧 provider，创建或更新对应配置并完成测试，再恢复启用。

## 5. 配置 model 与兼容性

在 Chat 管理页添加 model 时，按供应商实际 Responses API 能力填写：

- `model_key`：供应商 API 接受的模型标识，不能只填页面昵称。
- `display_name`：成员和管理员看到的名称。
- `introduction`：可选的成员可见模型介绍，最多 1000 个字符；管理页保存，成员在模型选择器下方查看。按纯文本展示，不执行其中的 HTML 或脚本。
- `context_window`：模型上下文窗口上限，必须覆盖实际要发送的输入。
- `max_output_tokens`：允许的最大输出 token。
- `default_max_output_tokens`：普通请求默认输出 token，不能大于最大值。
- `reasoning_efforts`：供应商实际支持的 reasoning effort 字符串数组；不支持时留空。
- `default_reasoning_effort`：可选默认 effort，必须包含在供应商支持的值内。
- `supports_images`：只有模型确实接受 `input_image` 时才打开。
- `supports_pdf`：只有模型确实接受 PDF `input_file` 时才打开。
- `preserve_reasoning`：只有模型支持把返回的加密 reasoning 内容原样作为下一轮 assistant continuation 输入时才打开。
- `enabled`：配置完成并通过低成本测试后再打开。

当前前后端使用 Responses 风格的 `input`、`reasoning`、`max_output_tokens`、SSE 事件和 `/responses` 端点。兼容性不能只看供应商宣传的“Chat Completions 兼容”：必须确认供应商支持本项目实际发送的请求字段、`text/event-stream` 流式返回，以及 `response.output_text.delta`、`response.completed`、`response.incomplete`、`response.failed` 或 `error` 等终止事件。

`supports_images` 和 `supports_pdf` 是能力元数据：前端用它们控制附件入口，后端也会再次校验模型 capability、附件类型、大小和数量，因此不能通过数据库配置强行让不支持的模型接受附件。PDF 仅接受 `.pdf`，图片仅接受 png/jpeg/webp data URL。文本较多的 PDF 由浏览器抽取为 `input_text`；低文本或扫描型 PDF 在 `supports_pdf` 打开时走原生 `input_file`，由供应商自行解析，本项目不做 OCR。`preserve_reasoning` 错误打开会导致多轮请求被供应商拒绝或泄漏不兼容的 continuation 数据，应保持关闭直到实际验证通过。

所有 provider 或 model 都可以单独 disabled。供应商不可用、余额不足、接口兼容性变化或正在换 key 时，优先禁用对应 provider/model，并保留 usage 审计记录；不要删除历史配置来绕过问题。

## 6. 前端静态发布

仓库没有 `.github/` 目录，也没有可据此断言已经配置好的 GitHub Actions。当前仓库是静态站：根目录有 `index.html`，网页资源在 `public/`，无需构建命令即可发布。

GitHub Pages 的实际发布方式必须由仓库所有者在 GitHub 仓库 Settings → Pages 中确认。若选择从分支发布，应确认发布源包含根目录 `index.html` 和整个 `public/` 目录；如果选择其他发布目录，应确认它同时包含这两者。不能仅凭仓库文件断言 Pages 已启用或已经部署成功。

也可以在静态托管平台把仓库根目录作为发布目录，构建命令留空，并确认以下路径能从同一站点访问：

```text
/index.html
/public/member-center.html
/public/club-features.html
/public/chat.html
/public/chat-admin.html
```

发布后把最终站点的 origin（协议、域名、端口，不带路径）精确加入 `CHAT_CORS_ORIGINS`，然后再进行浏览器验收。静态前端可公开 Supabase publishable/anon key，这是 Supabase 前端客户端的公开配置；绝不能公开 `SUPABASE_SERVICE_ROLE_KEY`、任何 `CHAT_KEY_*`、供应商 API key 或其他后端 secret。

## 7. 本地开发与验收

本地只使用 mock 或关闭 provider 的配置进行 UI 和协议检查，不把真实 provider key 放入本地前端，不为测试发送付费请求。普通静态服务（例如 `python -m http.server 4173`）只能检查静态资源和入口文案，不会模拟 Supabase auth、function 路由或供应商响应，不能当作完整 Chat 联调环境。

无网络的 Chat 本地联调入口是 mock 服务：

```bash
node tools/chat-mock-server.mjs
```

浏览器打开 `http://localhost:4191/setup`，按 `docs/chat-validation/README.md` 的矩阵验证账号门禁、生成场景、账号隔离、主题和管理页操作。mock 不访问真实 auth、数据库或供应商，mock 成功不等于线上验收。

然后检查：

1. `public/member-center.html` 登录后显示 Chat 入口，入口文案随中英文切换。
2. `public/club-features.html` 显示 Chat 卡片，入口文案随中英文切换。
3. 未登录访问 Chat 时显示登录/资料绑定要求；绑定资料后才允许使用 Chat。
4. 暗色和亮色主题下卡片、文字和入口均可读。
5. 管理员能进入 `public/chat-admin.html`，普通成员不能读取 provider/model/usage 管理数据。
6. provider disabled、model disabled、缺少 secret、无效 CORS origin 和不兼容响应都显示可理解的失败状态。
7. 开启真实 provider 前，先用最低成本模型和很小的输出上限做一次授权后的测试，再确认 usage 记录和 provider 账单。

仓库已有无网络的 Chat core 检查与真实后端 handler 测试：

```bash
node tools/test-chat-core.mjs
node tools/test-chat-admin.mjs
node --check public/chat.js
node --check public/chat-core.js
node --check public/chat-store.js
node --check public/chat-admin.js
node --check public/chat-i18n.js
node --check public/chat-admin-i18n.js
node tools/chat-mock-server.mjs --self-test
```

后端 Deno 集成测试（`npm exec --package=deno` 首次运行可能需要下载 Deno 包，不能保证完全离线）：

```bash
npm exec --yes --package=deno -- deno run --allow-env tools/test-chat-backend.ts
```

Chat SQL 必须用真实 PostgreSQL 解析器（例如 pglast）校验 `supabase/club-chat-schema.sql`，不能用括号配对或关键字检查代替。

```bash
python tools/test-chat-quota-sql.py --syntax-only
# 以下仅在已授权、可丢弃的本地 PostgreSQL 环境执行，绝不填写线上 DSN：
python tools/test-chat-quota-sql.py --dsn 'host=127.0.0.1 port=5432 dbname=postgres user=postgres'
```

syntax-only 需 pglast；真实集成还需 `psycopg[binary]` 和具备 CREATEDB/CREATEROLE 权限的本地 PostgreSQL。脚本创建并删除随机测试数据库，不迁移所给 DSN 的数据库。解析通过不证明事务、并发、RLS 或结算语义；mock 自检也不能代替真实 PostgreSQL 并发测试。本次未运行真实 PG/DSN 集成，不能声称并发已验收。

本地检查不等于线上验收；上线前仍需用户自行授权 Supabase SQL、Edge Function 部署、供应商付费调用和静态站发布。

已知运行时限制（部署前应知悉）：生成 lease 固定 15 分钟且无续期；若单次生成超过租约时限，同账号的新请求可能提前获锁。终态通过 RPC 事务原子写入审计并结算额度，按 `request_id` 幂等，重复完成同一请求不会重复计量。RPC 失败时记录可能停留在 `upstream_started`、额度保守保留，客户端仍然 fail-closed，不会误报成功。用户重新发起 HTTP 请求会得到新的 `request_id`，没有客户端幂等键将不同请求自动去重。

## 8. 额度、黑名单与计量边界

- 超级管理员可设置全站每日 token 上限，以及按账号 UUID 设置个人每日、每周、每月上限；账号目录的 username/中文姓名只是显示，保存目标必须是 `user_id`，不可按重名姓名或 username 猜测目标。`null` 表示不限，`0` 表示该维度不允许新生成，有限值只接受 `0..1,000,000,000,000` 的整数。
- 周期使用 **UTC 日历**：日为 UTC 00:00 至次日 00:00，周从周一 UTC 00:00 开始，月从每月 1 日 UTC 00:00 开始，不是滚动 24 小时/7 天/30 天。`resets_at` 返回 ISO UTC 时间，管理 UI 可转换为浏览器本地时间显示，但不改变底层 UTC 边界；跨周期请求按准入时的周期预留和结算，不转移到新周期。
- `respond` 和管理员 `admin_test` 都检查黑名单与额度，管理员测试不豁免。先按输入估算量加有效输出上限预留，再发起供应商请求；在全站每日与个人三个周期中取最紧的剩余额度，必要时缩小输出上限，不能容纳输入和至少 1 个输出 token 则返回 `429 quota`。缩小时返回 `X-Chat-Quota-Limited: true`，`X-Chat-Max-Output-Tokens` 告知有效上限。普通请求仍以模型配置的默认输出上限为基础，不允许客户端任意抬高。
- 预留是并发准入控制，不是精确计费。文本按 UTF-8 字节/3 向上取整估算；图片按 detail 取固定预算，原生 PDF 取固定预算。这些数值不是供应商 tokenizer，也不能保证覆盖所有附件、缓存、reasoning 或供应商计费规则。只有供应商返回有效 usage 时才用其实际 token 用量结算；实际用量可能高于预留，后续请求将按真实计数受到限制，不能据此前置承诺绝不超预算。供应商账单仍是费用核对边界。
- 没有有效 usage 的中断、客户端取消或进程崩溃，不能推断实际消耗为零，保守保留预留量；lease 释放或到期不等于额度退款。审计/结算失败也不得在前端伪报成功。生产数据库持久化预留不会因 Edge 重启自动消失；本地 mock 重置/重启清空内存是测试功能，不是生产退款手段。
- 黑名单阻止新的 catalog 与生成请求，返回 `403 blacklisted`；成员仍能读取自己的 `quota` 状态。管理接口仅动态超级管理员可用，即使管理员自身被列入黑名单也保留管理权限。黑名单不会追溯强杀已开始的流，也不会撤回已发送给供应商的内容；紧急停止费用仍需停用供应商/撤销 key 并核对供应商后台。
- 额度保存必须带读取时的 `expected_version`；陈旧版本返回 `409 conflict`，刷新后核对再保存，不盲目覆盖其他管理员修改。前端只调用 Edge API，不直接读写额度或黑名单表。

API action 契约：`quota {}` 仅查询本人；`admin_user_directory {}` 返回 `{users:[{user_id,username,member_name,bound}],blacklist:[{user_id,reason}]}`；`admin_quota_get {user_id?:null|UUID}` 和 `admin_quota_save {user_id?:null|UUID,daily_limit,weekly_limit,monthly_limit,expected_version}` 中省略/null 目标表示全局（仅每日，周/月为空）；`admin_set_blacklist {user_id,blocked,reason}`；`admin_blacklist_list {}`。额度快照为 `{global:{daily_limit,version,used,remaining,resets_at},user:{daily_limit,weekly_limit,monthly_limit,version},periods:[{period:'day'|'week'|'month',limit,used,remaining,resets_at}],blacklisted,reason}`；不限的 `limit/remaining` 为 null。未被拉黑的 catalog 附带 `quota` 快照。

## 9. 数据边界与使用记录

聊天正文和会话历史由当前浏览器的 IndexedDB 保存，数据库表 `chat_usage` 只记录后端审计所需的请求元数据和状态，不是聊天正文存档。清除浏览器站点数据、切换浏览器或切换设备后，本地会话不会自动同步。

后端 usage 审计会记录与请求相关的：

- Supabase 用户账号 ID 和账号标识（username 或邮箱/用户 ID）。
- 现有成员资料中的中文姓名（如果已绑定）。
- provider、model 和 model key。
- 请求开始/结束时间、状态、输入/输出/总 token（供应商返回时）及错误码。
- 输入字节数、最大输出 token、reasoning effort 和 request ID。

因此成员姓名、账号和使用时间会进入站点自己的 Chat usage 审计表，并由超级管理员在管理页查看。聊天正文不会因为 IndexedDB 而自动进入 Supabase usage 表，但浏览器、网络设备、供应商 API 和供应商平台日志仍可能保留请求内容、附件、账号标识、IP、时间、计费和安全审计信息，具体取决于供应商条款、保留设置和企业策略。不要在 Chat 中发送密码、service role key、供应商 key、私人证件或不应交给第三方处理的敏感资料。

## 10. 上线后回滚

发现 provider、model、CORS、费用或兼容性问题时，按以下顺序处理：

1. 在 Chat 管理页禁用异常 model；必要时同时禁用 provider。
2. 确认前端不再能从 catalog 选择被禁用的配置。
3. 如果是 key 泄漏或供应商异常，在供应商平台立即撤销 key，并更新同名 `CHAT_KEY_*` secret。
4. 检查 `chat_usage` 中的失败状态、时间和 request ID。
5. 保留 SQL 表和历史 usage 记录，不执行删除旧 member profile 表的“清理”脚本。
6. 修复并重新部署 `chat` 函数或静态文件后，再用授权的低成本测试恢复单个 provider/model。

## 11. 独立对外 Responses 代理

### 边界与发布

外部代理独立于成员 Chat：不使用 Chat 的 quota、blacklist、成员资料、页面开关或 catalog/model 配置。关闭 Chat 页面、把成员拉黑、把 Chat 额度设为 0，不会停掉对外代理。停用代理应禁用对应 route/key，泄漏时撤销 key；已开始的流不保证被追溯终止。代理 key 不是 Supabase 用户 JWT，不授予 Chat 管理权限。

发布顺序必须为 **完整主脚本 `supabase/club-chat-schema.sql` → Edge Secrets → 两个 Edge（`chat`、`chat-api-proxy`）→ 前端**。不要单独执行其他代理 SQL 片段代替主脚本。SQL/RPC 使用 service role，不能为方便前端而放开表。两个函数均 `verify_jwt=false`（CLI `--no-verify-jwt`）；不是匿名放行：`chat` 内部验证用户 JWT 与动态超级管理员，`chat-api-proxy` 内部验证 `Authorization: Bearer <proxy-key>` 的哈希、路由绑定、enabled 和撤销状态。

上游 key 只存 Edge Secrets。路由仅存 `CHAT_KEY_*` **引用名**，绝不填入原生 key。应使用**专用于对外代理的上游项目和 Secret**，不要与本站 Chat、私人文件、向量库或其他服务共用。保存配置、检查 Secret 存在、创建 key 均不应发起付费测试；没有自动测试收费请求。真实付费验证必须由所有者单独明确授权，不因部署或打开管理页而自动执行。

### 手动 Dashboard 部署

本项目按 Supabase 网站 Edge Function 编辑器部署，不需要部署 `_shared`。分别打开 `chat` 与 `chat-api-proxy` 的 Function 编辑器，将下面对应的完整单文件源码粘贴并部署；不要粘贴带 `../_shared` 相对 import 的函数源码，也不要把一个函数包贴到另一个函数中：

- `docs/chat-deployment/chat-dashboard-index.ts` → `chat`
- `docs/chat-deployment/chat-api-proxy-dashboard-index.ts` → `chat-api-proxy`

每次更新仓库中的任一函数或共享代理 helper，都要重新同步对应 standalone 源码，再粘贴部署。`verify_jwt` 设为关闭是为了由函数内部统一返回错误/CORS；不能省略 `chat` 的 Auth JWT、成员绑定、动态超管检查，也不能省略代理的 `cap_` key 哈希、路由绑定与撤销检查。

### CORS 与线上核对

`CHAT_CORS_ORIGINS` 用于成员 Chat 的精确浏览器来源白名单；可选的 `CHAT_PROXY_CORS_ORIGINS` 用于代理浏览器 SDK 来源，多个 origin 以英文逗号分隔。代理未配置该变量时允许 `*` 以兼容 PowerShell/CLI 等非浏览器客户端，但这不赋予访问权限：每个请求仍必须携带有效代理 key。配置后仅精确匹配的 Origin 获得 CORS 响应头，未知浏览器 Origin 在 admission 前被拒绝。CORS 不是认证，命令行客户端可自行设置或不发送 Origin，因此 key 仍是授权边界。

每次部署后在 Supabase Dashboard 核对实际保存的两份函数源码已包含最新校验，Secrets 仅存在于 Edge Functions；在 SQL Editor/Table Editor 核对 Chat/代理表启用 RLS、客户端角色无表权限，管理/准入/释放 RPC 的 `EXECUTE` 仅授予 `service_role`。`verify_jwt=false` 下线上旧函数或旧 SQL 会直接削弱这些保证，不能仅凭仓库源码判定线上已安全。


以下均为 `chat` action，除 `action` 外的请求字段如下；所有动作仅动态超级管理员可用：

| action | 请求 | 返回 |
| --- | --- | --- |
| `admin_proxy_list` | `{}` | `{routes,keys}` |
| `admin_proxy_save` | `{id:null或UUID,name,base_url,secret_name,enabled,expected_version:0或n}` | `{route}` |
| `admin_proxy_route_state` | `{id,enabled,expected_version}` | `{route}` |
| `admin_proxy_key_create` | `{route_id,label}` | `{key:metadata,api_key:一次明文}` |
| `admin_proxy_key_state` | `{id,enabled,revoked:boolean,expected_version}` | `{key}` |

route 字段仅为 `id,name,base_url,secret_name,enabled,version,created_at,updated_at`。安全 key metadata 仅为 `id,route_id,label,key_prefix,key_last4,enabled,revoked_at,version,created_at`，不含 hash 或完整 key。新 route 的 `expected_version` 为 0；更新带读取时版本，陈旧版本 `409 conflict`，刷新核对后再操作。撤销不可恢复，需重新创建 key。

proxy key 格式为 `cap_` 加 **32 随机字节的 base64url**（43 字符，无 padding）。创建接口只返回一次完整明文；服务端只持久化哈希与安全 metadata，列表/状态保存不能取回明文或哈希。关闭一次明文提示前由接收者安全保存；丢失则撤销重建。不要把 key 放进仓库、截图、日志或公共示例。key_prefix/key_last4 只用于识别，不可用于认证。

### 客户端 URL 与支持范围

路由 `base_url` 填供应商 HTTPS 公网版本根地址（例 `https://api.example.com/v1`），不是 `/response` 或 `/responses`，不带凭据/query/hash。外部客户端使用本站 base：

```text
https://<project-ref>.supabase.co/functions/v1/chat-api-proxy/<route-uuid>/v1
```

只提供 **POST `<base>/responses`**；不提供 `/models`、`/chat/completions`、`/response` 或 `/responses/<id>` retrieve。示例使用标准客户端 SDK 的 `responses.create`：

```js
import OpenAI from 'openai';
const client = new OpenAI({
  baseURL: process.env.CLUB_PROXY_BASE_URL,
  apiKey: process.env.CLUB_PROXY_KEY // 接收者自己保存的一次明文 proxy key，不是原生上游 key
});
// 仅示例；不要将其作为部署/自动测试的一部分执行（生产调用可能收费）。
const response = await client.responses.create({model: 'supplier-model-id', input: 'Hello'});
// stream:true 使用同一 create 入口，返回 SSE；不需要另一个 URL。
```

代理不擅自改写 `model` 或其他 Responses 字段，JSON/SSE 由上游能力决定。不提供按 key 用量套餐、金额硬上限或模型 allowlist：客户端可请求任意上游接受的 model/output，不能把 Chat 额度误认为代理预算。默认在途上限为每 key 2、每 route 20，通过独立 SQL 租约准入（满额 429，租约不是 token 计费）；请求体过大返回 413。租约到期不代表取消已计费的供应商工作。

### 安全、转售与运行时限制

- 上线前确认供应商条款明确允许此类转售、转授权或代理；持有上游 key 不等于获得转售许可。
- **不保证完全隐藏上游**。非 2xx 上游正文统一脱敏，不向客户回传供应商错误正文/原生 key；但成功 JSON、SSE 事件、模型名、错误事件或其他正文内容仍可能暴露供应商特征或敏感内容。尤其 SSE 开始后无法保证正文级净化；不要宣传匿名化或完全隐藏供应商。
- 透明透传可能包含 `tools`（远程 MCP、搜索、代码执行）、files、`vector_store_id`、`previous_response_id` 和远程媒体 URL。本站不执行这些工具，但**上游可能执行工具/抓取 URL、访问共享项目资源并产生额外费用**。proxy key 之间不构成上游租户隔离。上游 base URL 的 SSRF 校验也不覆盖正文指示上游进行的抓取；因此必须使用隔离的上游项目/Secret，并在供应商侧限制权限、资源和预算。
- 客户端取消会尝试中止代理流/上游请求并释放租约，但不保证供应商立即停止或退款；流中断/超时不代表未计费。
- `CHAT_PROXY_TIMEOUT_MS` 控制整条请求/流的超时，默认及最大值均为 **120000 ms（120 秒）**。这是本代理限制，不是供应商完成时间保证。
- [Supabase 官方运行限制](https://supabase.com/docs/guides/functions/limits)：worker wall-clock 免费方案 150 秒、付费方案 400 秒，idle timeout 150 秒，内存 256 MB。SSE 不保证延长 worker wall-clock；不能因持续有 token 就承诺无限长流。代理自己的 120 秒上限仍会先行生效，平台终止也可能更早发生。

本文不包含真实 key、service role key、数据库凭据或已执行线上操作的声明。
