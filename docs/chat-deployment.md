# Club AI Chat 部署说明

本文对应仓库中的成员 Chat 页面、Chat 管理页、Supabase Edge Function 和 Chat 配置表。当前静态站实际结构是仓库根目录的 `index.html` 加 `public/` 目录；Chat 页面发布路径为 `public/chat.html`，管理页面发布路径为 `public/chat-admin.html`。

成员页、管理页、Edge Function、Chat SQL 和本地 mock 均已实现。本次只完成本地开发检查和文档核对：没有部署 Edge Function、执行线上 SQL、调用供应商、提交或 push。上线付费验收需要站点所有者自行授权并执行。

## 0. 部署顺序

0. 升级额度版本前，先暂停旧 Edge 的新生成准入并等待已有流结束（必要时在网关/函数层暂停；仅隐藏前端按钮不足以阻止旧客户端调用）。旧 Edge 不执行新额度准入，不能让它在迁移窗口继续接单。
1. **先执行更新后的完整 Chat SQL**（第 2 节，包括额度、黑名单、预留结算与 90 天 usage 保留迁移）；不删除重建旧表。按用户明确要求，部署后首次定时清理执行时会不可逆地物理删除超过 90 天且可安全清理的旧 usage 及其关联内部记录，详见第 9 节。
2. 首次安装设置 Edge Function secrets（第 3 节）；已有安装仅升级 usage90day 时保留现有 Secrets。
3. 首次安装**再部署两个新版 Edge Function `chat` 与 `chat-api-proxy`**，先确认新 RPC 可用。两者均配置 `verify_jwt=false`，但分别在函数内部执行用户 JWT/管理员校验与 proxy key 鉴权。
4. **最后发布新版静态前端**（第 6 节），避免前端提前调用尚不存在的接口。已有部署仅升级 usage90day 时，网页部署顺序为**完整 SQL → `chat-dashboard-index.ts` 全文替换 `chat` 并部署 → `public/chat-admin.html`、`public/chat-admin.js`、`public/chat-admin-i18n.js`**。仅此功能不改变 `chat-api-proxy`、成员 Chat 或成员离线 bundle，无需重部署它们。
5. 在管理页配置 provider/model 并完成授权后的低成本测试（第 4、5、7 节），再恢复生成入口。

**计量起点**：历史 `chat_usage` 不回填额度桶；新额度只从新版 Edge 的 admission/预留开始累计。usage 在最近 90 天报告窗口内作为审计保留，超过窗口的安全终态记录自动清理；不能把升级后显示的 used 理解为本日/本周/本月所有历史供应商消耗。清理不改额度桶或设置，不返还历史消耗。

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
- 90 天 usage 清理 RPC 与其幂等的 pg_cron job `chat-usage-retention-90d`（若目标项目没有 pg_cron，SQL 会给出可见 warning；需由维护者按部署环境提供等价的定时调用）

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

Edge Function 已经自行校验 Bearer token，并通过 Supabase Auth `/auth/v1/user` 验证当前用户。网页手动部署时，在两个函数的配置中关闭网关 JWT 验证（通常为 **Verify JWT with legacy secret** 或类似名称）并保存。这只关闭网关检查，函数内部仍保留身份与权限校验。

不需要 PowerShell 或 Supabase CLI。直接使用 `docs/chat-deployment/README.md` 中的网页步骤；该目录提供完整 SQL 副本及两份可全文粘贴的 Edge 单文件。不要把真实 key 写进代码或命令历史。

## 4. 配置 provider

部署函数和执行 Chat SQL 后，使用已授权的超级管理员账号打开：

```text
/public/chat-admin.html
```

管理页中的 provider 配置填写：

- `name`：内部稳定名称。
- `label`：页面显示名称。
- `base_url`：供应商 HTTPS 公网版本根地址，例如 `https://api.example.com/v1`；也可保留具体端点。
- `api_protocol`：在“API 协议”下拉框选择自动识别、Responses、Claude Messages 或 Chat Completions。模型继承其关联供应商的协议。
- `secret_name`：与 Edge Function secret 完全一致，例如 `CHAT_KEY_OPENAI`。
- `auth_header`：按供应商要求选择 `authorization` 或 `x-api-key`。原生 Claude 应选择 `x-api-key`；Messages 请求自动带 `anthropic-version: 2023-06-01`。
- `enabled`：上线前先保持关闭，完成配置和付费验收后再开启。

供应商表单提供独立的“API 协议”下拉框。`api_protocol` 保存为 `auto`、`responses`、`messages` 或 `chat`；旧配置默认为 `auto`，继续通过 URL 后缀识别：

| 自动识别时的地址示例 | 协议 |
| --- | --- |
| `https://api.example.com/v1` 或 `https://api.example.com/v1/responses` | OpenAI Responses |
| `https://api.anthropic.com/v1/messages` | Anthropic Messages（Claude） |
| `https://api.example.com/v1/chat/completions` | OpenAI Chat Completions |

显式选择时，后端先移除地址末尾已有的受支持端点，再追加所选协议的规范端点；显式选择优先于后缀，不改写保存的地址。例如 `https://host/v1/responses` 配合 Messages 会请求 `https://host/v1/messages`。不会自动补 `/v1`，请保留上游实际要求的版本路径。认证头仍独立配置。

`/v1/message` 作为输入别名会规范成 `/v1/messages`。Responses 的标准路径是 `/v1/responses`，不接受 `/v1/response`。不要填写查询参数、账号密码、私网地址或本地地址。函数继续拒绝非 HTTPS、含凭据、含 query/hash、私网或不合规的 provider URL。同一上游若需要多种协议，可创建多个 provider，分别选择协议；model 通过其 provider 选择协议。协议字段迁移必须先运行完整 SQL，再部署 `chat`，最后发布管理页 HTML/JS/i18n。

供应商更换 key 时，按以下顺序执行：

1. 在管理页把对应 provider 设为 disabled，确认没有新的上游请求。
2. 在 Supabase Edge Function secrets 中更新同名 `CHAT_KEY_*` secret。
3. 用授权账号通过管理页测试生成，做一次低成本验证。
4. 确认无误后把 provider 恢复到期望的 enabled 状态。

真实 API key 只能写入 Edge Function Secrets；数据库 `chat_providers.secret_name` 和管理页表单都只接受引用名（例如 `CHAT_KEY_OPENAI`）。不要把真实 key 写入前端表单、数据库字段、浏览器 localStorage/IndexedDB、日志、文档或 Git 仓库。供应商平台侧也应按其控制台规则撤销旧 key、创建新 key、限制权限和额度。若供应商更换了 API 版本或认证方式，先停用旧 provider，创建或更新对应配置并完成测试，再恢复启用。

## 5. 配置 model 与兼容性

在 Chat 管理页添加 model 时，按所选 provider 的实际协议和模型能力填写：

- `model_key`：供应商 API 接受的模型标识，不能只填页面昵称。
- `display_name`：成员和管理员看到的名称。
- `introduction`：可选的成员可见模型介绍，最多 1000 个字符；管理页保存，成员在模型选择器下方查看。按纯文本展示，不执行其中的 HTML 或脚本。
- `context_window`：模型上下文窗口上限，必须覆盖实际要发送的输入。
- `max_output_tokens`：允许的最大输出 token。
- `default_max_output_tokens`：普通请求默认输出 token，不能大于最大值。
- `reasoning_efforts`：Responses / Chat Completions 的通用 effort 字符串数组；不支持时留空。Chat Completions **不在本项目内限制取值**：`none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max` 以及供应商自定义字符串都会原样透传，合法取值范围由上游决定；后端只校验每项是非空字符串。Messages 保留这些旧字段供以后切回其他协议，但不再用它们生成 thinking 或 effort。
- `default_reasoning_effort`：通用默认 effort，必须包含在通用数组内；Messages 的有效默认值改由下述专用配置决定。
- `claude_thinking`：专用于 Messages 的 JSON 对象，模式与规则见下一节；与通用 effort 分开保存。
- `supports_images`：只有模型确实接受 `input_image` 时才打开。
- `supports_pdf`：只有模型确实接受 PDF `input_file` 时才打开。
- `preserve_reasoning`：只有模型支持把返回的加密 reasoning 内容原样作为下一轮 assistant continuation 输入时才打开。
- `enabled`：配置完成并通过低成本测试后再打开。

内部前端与服务端之间继续使用 Responses 风格的 `input` 和 SSE 事件；服务端按 provider 地址转换为原生 Messages / Chat Completions 请求，并归一化文本、终止状态和用量，管理员测试使用相同路径。现有会话无需迁移。上游必须支持其所选协议的真实流式返回；不能只凭“兼容”宣传判断能力。非 Responses 模型不能开启 `preserve_reasoning`，也不能混入已有的加密 reasoning 项；不兼容时明确拒绝，不静默丢弃。工具调用不能由内部 Chat 执行，仅有工具调用而无可用正文的回复会作为不支持的输出处理。对外代理则保持原生正文透传。

`supports_images` 和 `supports_pdf` 是能力元数据：前端用它们控制附件入口，后端也会再次校验模型 capability、附件类型、大小和数量，因此不能通过数据库配置强行让不支持的模型接受附件。PDF 仅接受 `.pdf`，图片仅接受 png/jpeg/webp data URL。文本较多的 PDF 由浏览器抽取为 `input_text`；低文本或扫描型 PDF 在 `supports_pdf` 打开时走原生 `input_file`，由供应商自行解析，本项目不做 OCR。`preserve_reasoning` 错误打开会导致多轮请求被供应商拒绝或泄漏不兼容的 continuation 数据，应保持关闭直到实际验证通过。

### Claude Messages 思考配置与旧配置迁移

管理页模型表单单独配置 `claude_thinking`，JSON 只接受以下模式及对应键，未知键、跨模式键、数组或 `null` 都会拒绝：

| 配置 | 内部 Chat 发给 Messages 上游的字段 |
| --- | --- |
| `{"mode":"omit"}` | 不发送 `thinking` 或 `output_config.effort`，保留供应商默认行为 |
| `{"mode":"disabled"}` | `thinking: {type:"disabled"}` |
| `{"mode":"enabled","budget_tokens":1024}` | `thinking: {type:"enabled",budget_tokens:1024}`，预算原样发送 |
| `{"mode":"adaptive"}` | `thinking: {type:"adaptive"}`，不发送 effort，使用供应商默认值 |
| `{"mode":"adaptive","efforts":["medium"],"default_effort":"medium"}` | `thinking: {type:"adaptive"}` 与 `output_config: {effort:"medium"}` |

`budget_tokens` 仅能出现在 `enabled`，必须是至少 1024 的整数，并严格小于模型的**默认输出**。例如手动预算 1024、默认输出 4096、最大输出至少 4096；管理员测试输出也必须大于 1024（如 2048 或 4096）。只增大最大输出而不改默认输出无效。请求发起时还会按测试输出上限及额度收缩后的实际 `max_tokens` 重新检查严格大于关系，失败即拒绝，不缩小预算、不映射 effort、不自动换模式。

`efforts` 与 `default_effort` 仅能出现在 `adaptive`。省略 `efforts` 或填 `[]` 表示不向成员提供 effort 选择；省略默认值或填 `null` 表示不发送默认 effort。非空默认值必须出现在无重复的数组内。允许配置的候选值是 `low`、`medium`、`high`、`xhigh`、`max`，但具体支持范围依模型版本与供应商而变，不能把所有值都勾上当作能力发现。`none` 不是 adaptive effort；关闭思考应明确选择 `disabled`。`output_config.effort` 调节工作量，`thinking.type` 选择思考模式，两者不是同一个开关；手动预算模式不接受 effort。

迁移新增 `chat_models.claude_thinking JSONB NOT NULL`，默认 `{"mode":"omit"}`。新建模型遗漏字段时也用 omit；更新模型遗漏字段时保留原配置。旧 `reasoning_efforts/default_reasoning_effort` 仍存储，但 **Messages 全部忽略其通用值**，不把旧 `low/medium/high` 自动转换成预算，也不把旧 `none` 当作 disabled。需要恢复显式思考的模型由管理员重新选择模式。`catalog` 返回解析后的 `api_protocol` 与专用配置：Messages 只有 adaptive 暴露其有效 effort/default，其余模式为 `[]/null`；Responses / Chat Completions 继续使用通用字段。

原用户使用的 `claude-haiku-5-5` 只能视为该供应商的模型别名，不能据此推定其原生模型、参数转发或能力与 Anthropic 相同。该别名当前应从已知可用的 `omit` 开始；只有用户明确启用且供应商确认支持后，才配置例如 adaptive + medium。Anthropic 官方资料已描述原生 Haiku 5.5 的 adaptive 默认行为、默认 medium、手动 enabled 预算请求返回 400、五种 effort 及 disabled 的 effort 限制（至 high），并不支持 `between_tools`；这些是原生模型文档证据，不能证明第三方别名支持同样的组合。Haiku 5.5 默认省略 thinking 摘要，因此看不到推理内容也不能判断思考关闭；本次没有新增推理内容展示功能。

官方参考：[固定版本模型迁移说明](https://github.com/anthropics/skills/blob/9d630808e4add0a7146de4af9384155d5dee350a/skills/claude-api/shared/model-migration.md)、[固定版本 SDK Messages 类型](https://github.com/anthropics/anthropic-sdk-typescript/blob/ca50812ed769a40510bb2f9e5e232e95cdd376f1/src/resources/messages/messages.ts)（预算至少 1024 且小于 `max_tokens`）、[当前 SDK](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts)、[Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)、[Adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)、[Effort](https://platform.claude.com/docs/en/build-with-claude/effort)。资料与本地校验不能替代供应商确认或真实调用验收；本次没有调用真实上游。

升级此项的顺序为**重新执行完整 Chat SQL → 部署新版 `chat` 单文件 bundle → 发布前端**，包括管理页 HTML/JS/i18n、成员页 JS/i18n 与 `public/chat-file-bundle.js`。维护者由各自源文件重建产物，不手工补改生成的 TypeScript、SQL 副本或离线包。仅此专用配置改动不改变原生 `chat-api-proxy` 行为，无需仅为它重新部署代理；首次安装或升级其他代理功能仍按完整部署步骤执行。`x-api-key`、版本头和 SSE 行为保持原有契约。

### 模型可见性与 UUID 不能绕过授权

每个模型的 `visibility` 只能是：

- `all`：所有已登录且已绑定资料的成员可在 `catalog` 中看到并使用。
- `assigned`：只有 `chat_model_access` 中明确列出的成员 UUID 可见和使用；管理员在管理页按 UUID 分配，显示姓名/username 只是辅助识别。

这不是前端隐藏功能。`catalog` 按当前用户过滤，`respond` 即使直接提交模型 UUID 也会在服务端重新检查 assignment，未授权返回 `403 model`；猜测、替换或伪造 UUID 不能绕过 assigned 限制。管理员的 `admin_test` 只绕过模型可见性检查以便测试配置，但仍要求管理员 JWT，并继续执行黑名单、额度、并发和上游校验。

成员页的“添加社团代理模型”是另一条用户自有配置路径：仅保存显示名称、模型 ID 和固定社团 proxy 的 base URL 元数据。API key 不接受为 `custom_model_save` 的字段，不写入数据库、Supabase、IndexedDB、日志或 URL，只保存在当前页面内存；刷新页面、关闭标签页、切换设备或重新登录后必须重新输入。固定 proxy 只允许本站规定的 HTTPS host 和 route UUID。`/functions/v1/chat-api-proxy/<route-uuid>`（可带 `/v1`）默认 Responses；填写末尾 `/v1/responses`、`/v1/messages` 或 `/v1/chat/completions` 可选择原生协议，也允许不带 `/v1` 的端点后缀。`/message` 是 `/messages` 的输入别名。浏览器按所选端点转换请求并解析返回，不允许任意供应商地址或查询参数。更新已有部署时必须重新执行本仓库 `supabase/club-chat-schema.sql`，同步已有 `chat_custom_models` 的命名 URL CHECK 约束与保存 RPC。

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

mock 的 `/mock/chat` 实现 `custom_model_list`、`custom_model_save`、`custom_model_delete` 三个成员自助配置动作（只落内存、只校验固定社团代理 URL、只允许本人读写、用 `version` 做冲突检测），否则 Chat 页在读取自定义模型时直接进入「请求失败」，无法本地查看工作区。

然后检查：

1. `public/member-center.html` 登录后显示 Chat 入口，入口文案随中英文切换。
2. `public/club-features.html` 显示 Chat 卡片，入口文案随中英文切换。
3. 未登录访问 Chat 时显示登录/资料绑定要求；绑定资料后才允许使用 Chat。
4. 暗色和亮色主题下卡片、文字和入口均可读。Chat 页顶栏自带的主题按钮调用 `ClubTheme.setMode(...)`，与全站偏好同步；语言按钮在中/英之间切换后，消息区动态生成的文案（角色、状态、按钮提示、会话列表时间与条数）必须一并刷新，不能只换静态节点。
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

syntax-only 需 pglast；真实集成还需 `psycopg[binary]` 和具备 CREATEDB/CREATEROLE 权限的本地 PostgreSQL。脚本创建并删除随机测试数据库，不迁移所给 DSN 的数据库。解析通过不证明事务、并发、RLS 或结算语义；mock 自检也不能代替真实 PostgreSQL 并发测试。本次未运行独立 PostgreSQL 服务器/DSN 集成；usage90day 已在 PGlite PostgreSQL WASM runtime 单连接执行验证（范围见第 9 节），不能声称多连接并发或真实 pg_cron 已验收。

本地检查不等于线上验收；上线前仍需用户自行授权 Supabase SQL、Edge Function 部署、供应商付费调用和静态站发布。

已知运行时限制（部署前应知悉）：生成 lease 固定 15 分钟且无续期；若单次生成超过租约时限，同账号的新请求可能提前获锁。终态通过 RPC 事务原子写入审计并结算额度，按 `request_id` 幂等，重复完成同一请求不会重复计量。RPC 失败时记录可能停留在 `upstream_started`、额度保守保留，客户端仍然 fail-closed，不会误报成功。用户重新发起 HTTP 请求会得到新的 `request_id`，没有客户端幂等键将不同请求自动去重。

**内存与生命周期**：生产 Edge 的 in-flight lease、usage 预留和状态在数据库中持久化，函数重启、worker 更换或浏览器刷新不会自动退款；取消请求会尝试中止上游并结算，但不能保证供应商已停止或退费，租约到期也不等于取消。浏览器聊天正文/会话只在当前浏览器 IndexedDB，按 user UUID 隔离；清除站点数据、切换设备或换浏览器不会同步，也不会清除服务端 usage 审计。自定义 cloud API key 仅在当前页面内存，刷新/关闭页面即丢失；本地 mock 重启会清空内存状态，这不是生产清理或退款机制。

## 8. 额度、黑名单与计量边界

- 超级管理员可设置全站每日 token 上限，以及按账号 UUID 设置个人每日、每周、每月上限；账号目录的 username/中文姓名只是显示，保存目标必须是 `user_id`，不可按重名姓名或 username 猜测目标。`null` 表示不限，`0` 表示该维度不允许新生成，有限值只接受 `0..1,000,000,000,000` 的整数。
- 周期使用 **UTC 日历**：日为 UTC 00:00 至次日 00:00，周从周一 UTC 00:00 开始，月从每月 1 日 UTC 00:00 开始，不是滚动 24 小时/7 天/30 天。`resets_at` 返回 ISO UTC 时间，管理 UI 可转换为浏览器本地时间显示，但不改变底层 UTC 边界；跨周期请求按准入时的周期预留和结算，不转移到新周期。
- `respond` 和管理员 `admin_test` 都检查黑名单与额度，管理员测试不豁免。先按输入估算量加有效输出上限预留，再发起供应商请求；在全站每日与个人三个周期中取最紧的剩余额度，必要时缩小输出上限，不能容纳输入和至少 1 个输出 token 则返回 `429 quota`。缩小时返回 `X-Chat-Quota-Limited: true`，`X-Chat-Max-Output-Tokens` 告知有效上限。普通请求仍以模型配置的默认输出上限为基础，不允许客户端任意抬高。
- 预留是并发准入控制，不是精确计费。文本按 UTF-8 字节/3 向上取整估算；图片按 detail 取固定预算，原生 PDF 取固定预算。这些数值不是供应商 tokenizer，也不能保证覆盖所有附件、缓存、reasoning 或供应商计费规则。只有供应商返回有效 usage 时才用其实际 token 用量结算；实际用量可能高于预留，后续请求将按真实计数受到限制，不能据此前置承诺绝不超预算。供应商账单仍是费用核对边界。
- 没有有效 usage 的中断、客户端取消或进程崩溃，不能推断实际消耗为零，保守保留预留量；lease 释放或到期不等于额度退款。审计/结算失败也不得在前端伪报成功。生产数据库持久化预留不会因 Edge 重启自动消失；本地 mock 重置/重启清空内存是测试功能，不是生产退款手段。
- 黑名单阻止新的 catalog 与生成请求，返回 `403 blacklisted`；成员仍能读取自己的 `quota` 状态。管理接口仅动态超级管理员可用，即使管理员自身被列入黑名单也保留管理权限。黑名单不会追溯强杀已开始的流，也不会撤回已发送给供应商的内容；紧急停止费用仍需停用供应商/撤销 key 并核对供应商后台。
- 额度保存必须带读取时的 `expected_version`；陈旧版本返回 `409 conflict`，刷新后核对再保存，不盲目覆盖其他管理员修改。前端只调用 Edge API，不直接读写额度或黑名单表。

API action 契约：`quota {}` 仅查询本人；`admin_user_directory {}` 返回 `{users:[{user_id,username,member_name,bound}],blacklist:[{user_id,reason}]}`；`admin_quota_get {user_id?:null|UUID}` 和 `admin_quota_save {user_id?:null|UUID,daily_limit,weekly_limit,monthly_limit,expected_version}` 中省略/null 目标表示全局（仅每日，周/月为空）；`admin_set_blacklist {user_id,blocked,reason}`；`admin_blacklist_list {}`。额度快照为 `{global:{daily_limit,version,used,remaining,resets_at},user:{daily_limit,weekly_limit,monthly_limit,version},periods:[{period:'day'|'week'|'month',limit,used,remaining,resets_at}],blacklisted,reason}`；不限的 `limit/remaining` 为 null。未被拉黑的 catalog 附带 `quota` 快照。

## 9. 数据边界、90 天窗口与使用记录

聊天正文和会话历史由当前浏览器的 IndexedDB 保存，数据库表 `chat_usage` 只记录后端审计所需的请求元数据和状态，不是聊天正文存档。清除浏览器站点数据、切换浏览器或切换设备后，本地会话不会自动同步。

后端 usage 审计会记录与请求相关的：

- Supabase 用户账号 ID 和账号标识（username 或邮箱/用户 ID）。
- 现有成员资料中的中文姓名（如果已绑定）。
- provider、model 和 model key。
- 请求开始/结束时间、状态、输入/输出/总 token（供应商返回时）及错误码。
- 输入字节数、最大输出 token、reasoning effort 和 request ID。

因此成员姓名、账号和使用时间会进入站点自己的 Chat usage 审计表，并由超级管理员在管理页查看。聊天正文不会因为 IndexedDB 而自动进入 Supabase usage 表，但浏览器、网络设备、供应商 API 和供应商平台日志仍可能保留请求内容、附件、账号标识、IP、时间、计费和安全审计信息，具体取决于供应商条款、保留设置和企业策略。不要在 Chat 中发送密码、service role key、供应商 key、私人证件或不应交给第三方处理的敏感资料。

### 90 天 usage 报告与自动清理

`admin_usage` 始终保留并返回 `usage`、`page`、`pageSize` 和 `total`。`total` 是日期筛选后的全部匹配记录数，不受当前页影响；`from`/`to` 过滤 `started_at`，而且服务端把结果限制在滚动 90 天窗口 `[asof - 2160h, asof)`：下界包含，上界排除，未来记录不会进入报告。管理页也只能看到这 90 天内的记录。`summary` 独立于分页和日期筛选，返回 `{total_records,total_tokens}`；`total_records` 是数字，`total_tokens` 是十进制字符串，避免 `bigint` 累加超过 JavaScript 安全整数后失真。`null` token 不计入 token 总和，但对应的真实记录仍计入 `total_records`；不会用预留量或输入/输出估算补造总 token。没有已知 token 时总和为字符串 `"0"`。窗口起止同时以 `window_start`/`window_end` 返回，便于管理页说明当前 as-of 边界。管理页通过 `admin_usage` 刷新列表和汇总，不额外扩展 `admin_get` 契约。管理读取不触发清理。

完整 SQL 安装清理函数和定时任务，不立即执行删除。部署后首次定时清理执行时会物理删除窗口之外、已完成终态且 `finished_at` 非空、没有 reservation 或 reservation 已结算、也没有未过期 lease 的 usage，以及其关联 allocation、已结算 reservation 和过期 lease。该删除不可逆；未解决的内部计量记录会继续保留但不在报告中显示，等待迟到结算。lease 过期不等于生成已完成，不能因过期就删除未结算记录。清理永远不退还 quota bucket、不改变额度计数，也不把记录重新计入额度。之后由数据库 `pg_cron` 每小时运行命名 job `chat-usage-retention-90d`；重复安装/升级使用幂等的 job 配置。若目标项目提供 `pg_cron`，SQL 会尝试安装扩展并以幂等方式安排任务；扩展不可用、安装或排程失败都会给出可见 warning。部署者必须解决 warning，或提供受控等价的定时调用，否则无人访问时不会有自动物理清理保证。管理页访问不会作为清理兜底，也不会让无人访问时停止自动清理。

因此上线安装定时任务前必须确认旧 usage 的物理删除符合审计要求。列表查询立即按 90 天窗口过滤。数据库定时任务每小时最多清理 1000 条安全过期记录；没有积压且任务正常时通常在下一小时任务清理，有积压时会跨多个小时批次，未结算保护或任务失败也会延长物理保留。quota counters、额度桶和 reservation 结算语义保持不变。本地已在 PGlite 的 PostgreSQL WASM runtime 执行完整 schema 及重复安装，验证 1505 条记录的精确汇总/分页/日期/权限，以及清理外键、保护条件、迟到结算、quota 不变和 1000+1 分批。该运行只使用单连接，未验证独立 PostgreSQL 服务器的多连接并发、真实 pg_cron 或线上 Supabase；不能据此声称生产定时任务已经安装或运行。

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

### 手动 Dashboard 部署与 standalone bundle

网页部署直接使用 `docs/chat-deployment/`：先把 `club-chat-schema.sql` 全文粘贴到 SQL Editor 运行，再设置 Edge Secrets，最后分别更新两个函数。详细步骤见该目录 `README.md`，无需 PowerShell 或 CLI。

打开 Edge Functions，分别创建/编辑 `chat` 和 `chat-api-proxy`，将完整 standalone 文件粘贴到对应函数的 `index.ts`：`chat-dashboard-index.ts` → `chat`，`chat-api-proxy-dashboard-index.ts` → `chat-api-proxy`。Dashboard 编辑器不会自动上传 `_shared`，不能粘贴带 `../_shared` import 的源文件，也不能把两个 bundle 合并到一个函数。修改开发源文件或 helper 后，维护者需同步本目录产物；使用者直接粘贴已生成的完整文件即可。SQL 副本与完整主脚本一致，不要重复执行两个路径下的同一脚本。

两个函数均可设置 `verify_jwt=false`（CLI 为 `--no-verify-jwt`），这只关闭 Supabase 网关的默认检查，绝不关闭函数自身的认证：`chat` 仍验证成员 JWT、资料绑定、动态超级管理员、模型 UUID assignment 和 quota/blacklist；proxy 仍验证 `cap_` key 哈希、route UUID 绑定、enabled/revoked 状态和并发租约。发布后手动在 Dashboard 核对源码、Secrets、RLS 和 service_role-only RPC 权限；仓库文件不能证明线上函数已经更新。

### CORS 与线上核对

`CHAT_CORS_ORIGINS` 只控制成员 Chat 函数的浏览器来源白名单；`CHAT_PROXY_CORS_ORIGINS` 只控制独立 proxy 的浏览器来源白名单，二者不要混用。前者未配置有效 origin 时不会给成员浏览器放行；后者未配置时 proxy 为兼容 CLI/PowerShell 返回 `Access-Control-Allow-Origin: *`，但这不授予权限，仍必须携带有效 `cap_` key。配置 `CHAT_PROXY_CORS_ORIGINS` 后，只精确匹配的 Origin 获得 CORS 响应头，未知浏览器 Origin 在 admission 前返回 `403 cors`。CORS 不是认证，命令行客户端可以不发送 Origin，key 才是授权边界。

每次部署后在 Supabase Dashboard 核对实际保存的两份函数源码已包含最新校验，Secrets 仅存在于 Edge Functions；在 SQL Editor/Table Editor 核对 Chat/代理表启用 RLS、客户端角色无表权限，管理/准入/释放 RPC 的 `EXECUTE` 仅授予 `service_role`。`verify_jwt=false` 下线上旧函数或旧 SQL 会直接削弱这些保证，不能仅凭仓库源码判定线上已安全。


以下均为 `chat` action，除 `action` 外的请求字段如下；所有动作仅动态超级管理员可用：

| action | 请求 | 返回 |
| --- | --- | --- |
| `admin_proxy_list` | `{}` | `{routes,keys}` |
| `admin_proxy_save` | `{id:null或UUID,name,base_url,secret_name,enabled,expected_version:0或n}` | `{route}` |
| `admin_proxy_route_state` | `{id,enabled,expected_version}` | `{route}` |
| `admin_proxy_route_delete` | `{id,expected_version}` | `{route}`；不可逆撤销路由（保留失效记录），同时撤销该路由下的访问密钥 |
| `admin_proxy_route_hard_delete` | `{id,expected_version}` | `{deleted_route_id}`；仅限已撤销路由，物理删除路由、全部关联密钥和租约 |
| `admin_proxy_key_create` | `{route_id,label}` | `{key:metadata,api_key:一次明文}` |
| `admin_proxy_key_state` | `{id,enabled,revoked:boolean,expected_version}` | `{key}` |
| `admin_proxy_key_hard_delete` | `{id,expected_version}` | `{deleted_key_id}`；仅限已撤销密钥，物理删除密钥和关联租约 |

route 字段包括 `id,name,base_url,secret_name,enabled,deleted_at,version,created_at,updated_at`。安全 key metadata 仅为 `id,route_id,label,key_prefix,key_last4,enabled,revoked_at,version,created_at`，不含 hash 或完整 key。新 route 的 `expected_version` 为 0；更新或彻底删除均带读取时版本，陈旧版本返回 `409 conflict`，刷新核对后再操作。

撤销路由会保留失效记录，立即停用路由、撤销全部旗下 key、清理活动 lease；撤销不可恢复。管理页为 `deleted_at` 非空的路由及 `revoked_at` 非空的密钥提供“彻底删除”按钮，确认后通过数据库事务实际删除记录，刷新列表也不会再显示。路由彻底删除会一起清除旗下所有密钥及关联租约；单独删除密钥只清除该密钥及其租约。仅停用的记录不符合彻底删除条件，服务端也会拒绝该操作（`409 not_revoked`）。执行完整 SQL、部署函数或打开代理列表均不会自动清除代理路由/密钥；usage 的定时保留任务按第 9 节独立执行。

彻底删除不保留 UUID 或 key 哈希占位。管理接口创建路由仍由数据库生成新 UUID，不允许调用者指定旧 UUID；正常重新创建会得到新的公开 URL，旧 URL/密钥无法准入。已在途的上游请求不会被强制中断，其后续租约释放可安全重复执行。手工用高权限 SQL 重建同 UUID 不属于管理接口保证。彻底删除不会移除 Edge Secrets 中的上游供应商 Key，也不会自动清除成员自行保存的失效代理地址。

proxy key 格式为 `cap_` 加 **32 随机字节的 base64url**（43 字符，无 padding）。创建接口只返回一次完整明文；服务端只持久化哈希与安全 metadata，列表/状态保存不能取回明文或哈希。关闭一次明文提示前由接收者安全保存；丢失则撤销重建。不要把 key 放进仓库、截图、日志或公共示例。key_prefix/key_last4 只用于识别，不可用于认证。

### 客户端 URL、浏览器直连与支持范围

路由 `base_url` 填供应商 HTTPS 公网版本根地址（例 `https://api.example.com/v1`）；也可填写一个受支持的具体端点，服务端先去除该后缀，再按客户端原生接口选择路径。不带凭据/query/hash。外部客户端使用本站 base：

```text
https://<project-ref>.supabase.co/functions/v1/chat-api-proxy/<route-uuid>/v1
```

代理提供三个原生 POST 接口：`<route-base>/v1/responses`、`<route-base>/v1/messages`、`<route-base>/v1/chat/completions`；`<route-base>/v1/message` 规范到 `/v1/messages`。`/models`、`/response` 和 `/responses/<id>` 等路径仍不开放。每种接口均支持 `Authorization: Bearer cap_...`；Messages 还支持 Anthropic SDK 的 `x-api-key: cap_...`，同时携带两种凭证时必须完全一致。客户端 key 仅用于社团代理准入；上游认证始终替换为路由 Secret，不转发客户端 key 或 Supabase 凭证。Messages 默认版本为 `2023-06-01`，支持显式合法日期版本及受限的 `anthropic-beta` 头。代理不把一种原生协议转换成另一种，上游必须实际提供所请求的接口。

示例使用标准客户端 SDK 的 `responses.create`：

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

```js
// 同一个 OpenAI client 也可以调用 Chat Completions；上游需支持该接口。
const completion = await client.chat.completions.create({
  model: 'supplier-model-id', messages: [{role: 'user', content: 'Hello'}]
});
```

Claude / Messages 客户端示例（仅文档，不自动执行）：

```js
import Anthropic from '@anthropic-ai/sdk';
const claude = new Anthropic({
  // Anthropic SDK 自动附加 /v1/messages；这里填不带 /v1 的 route base。
  baseURL: process.env.CLUB_PROXY_ROUTE_BASE_URL,
  apiKey: process.env.CLUB_PROXY_KEY
});
const message = await claude.messages.create({
  model: 'claude-model-id', max_tokens: 1024,
  messages: [{role: 'user', content: 'Hello'}]
});
```

将 Claude 加入社团内 Chat：provider 地址填 Claude 或已授权供应商的原生 `/v1/messages` 地址，真实 key 只存 `CHAT_KEY_*` Secret，模型选择此 provider，关闭加密 reasoning 保留，认证选择 `x-api-key`。对外路由可另行指向同一上游并引用适当 Secret；内部 Chat 不回调本站代理，避免循环代理。内部 Chat 配额与对外代理租约保持独立。

代理不擅自改写 `model` 或其他原生请求字段，JSON/SSE 由上游能力决定。不提供按 key 用量套餐、金额硬上限或模型 allowlist：客户端可请求任意上游接受的 model/output，不能把 Chat 额度误认为代理预算。默认在途上限为每 key 2、每 route 20，通过独立 SQL 租约准入（满额 429，租约不是 token 计费）；请求体过大返回 413。租约到期不代表取消已计费的供应商工作。

### 安全、转售与运行时限制

- 上线前确认供应商条款明确允许此类转售、转授权或代理；持有上游 key 不等于获得转售许可。
- **不保证完全隐藏上游**。非 2xx 上游正文统一脱敏，不向客户回传供应商错误正文/原生 key；但成功 JSON、SSE 事件、模型名、错误事件或其他正文内容仍可能暴露供应商特征或敏感内容。尤其 SSE 开始后无法保证正文级净化；不要宣传匿名化或完全隐藏供应商。
- 透明透传可能包含 `tools`（远程 MCP、搜索、代码执行）、files、`vector_store_id`、`previous_response_id` 和远程媒体 URL。本站不执行这些工具，但**上游可能执行工具/抓取 URL、访问共享项目资源并产生额外费用**。proxy key 之间不构成上游租户隔离。上游 base URL 的 SSRF 校验也不覆盖正文指示上游进行的抓取；因此必须使用隔离的上游项目/Secret，并在供应商侧限制权限、资源和预算。
- Chat 管理权限仅依据动态超管名单中的用户 UUID；名单为空、缺失、读取错误或畸形响应均拒绝，不按初始邮箱回退。部署前确认管理员已加入动态名单。其他站点管理员引导逻辑未在本次修改。
- Chat / 代理请求体都采用有界流式读取，实际字节上限 12 MiB，省略或低报 `Content-Length` 不能绕过。读取存储使用 64 KiB 聚合块，不按网络分片无限增加保留对象。Chat 上传读取 deadline 为 10 秒，取消/超时为 `504 timeout`；代理沿用整条请求的 deadline。超限或非法长度返回 413。这不等于限制响应总字节或费用。
- PowerShell、curl、SDK 持有效 JWT / `cap_` Key 调用是合法能力；不带 Origin 不会绕过服务端认证。CORS 只约束浏览器。全站/Chat 维护遮罩没有服务端停机语义，不能作为阻止费用的总闸；需要停用生成时停用相应供应商、模型或代理路由，必要时撤销 Key。在途请求不保证被强制停止。
- 上游域名解析校验与 fetch 的实际解析分开，未绑定连接 IP；不能声称完全阻止 DNS rebinding。完整攻击还取决于对配置域名/DNS 的控制、有效访问权限、网络可达性及原 hostname 的 TLS 校验。对供应商域名及 DNS 仍需信任，不应向不受信任方开放路由配置。
- 客户端取消会尝试中止代理流/上游请求并释放租约，但不保证供应商立即停止或退款；流中断/超时不代表未计费。
- `CHAT_PROXY_TIMEOUT_MS` 控制整条请求/流的超时，默认及最大值均为 **120000 ms（120 秒）**。这是本代理限制，不是供应商完成时间保证。
- [Supabase 官方运行限制](https://supabase.com/docs/guides/functions/limits)：worker wall-clock 免费方案 150 秒、付费方案 400 秒，idle timeout 150 秒，内存 256 MB。SSE 不保证延长 worker wall-clock；不能因持续有 token 就承诺无限长流。代理自己的 120 秒上限仍会先行生效，平台终止也可能更早发生。

本文不包含真实 key、service role key、数据库凭据或已执行线上操作的声明。
