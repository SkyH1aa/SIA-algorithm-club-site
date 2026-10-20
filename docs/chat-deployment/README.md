# Supabase 网页手动粘贴部署

此目录包含 Chat 三协议支持、供应商 API 协议配置、已撤销代理路由/密钥彻底删除以及 usage90day 所需的完整后端文件。你不需要安装或运行 PowerShell、Supabase CLI、Deno 或构建命令。以下操作均在 Supabase 网页 Dashboard 完成。

## 文件对应关系

| 本目录文件 | 粘贴位置 |
| --- | --- |
| `club-chat-schema.sql` | SQL Editor → 新建查询 → 全文粘贴 → Run |
| `chat-dashboard-index.ts` | Edge Functions → `chat` → Code → `index.ts`，全文替换后 Deploy updates |
| `chat-api-proxy-dashboard-index.ts` | Edge Functions → `chat-api-proxy` → Code → `index.ts`，全文替换后 Deploy updates |
| `club-drive-dashboard-index.ts` | Edge Functions → `club-drive` → Code → `index.ts`，模型只读工具更新需要全文替换并部署 |

三份 TypeScript 文件都是独立的单文件版本，Chat/代理的共享代码及协议适配器已内联，club-drive 为完整函数源码副本。不要改粘带相对 import 的开发源文件，也不要把不同函数文件拼在一起。只替换一小段旧函数会漏掉其他依赖，必须全文替换。不同升级需要的文件见各节；本轮模型只读工具不改 SQL。

`club-chat-schema.sql` 是完整主脚本 `supabase/club-chat-schema.sql` 的同步副本，不是另一套迁移。只执行其中一份，不需要把两个路径的文件各执行一次。已有安装也需要执行新版完整脚本，以更新供应商协议字段、自定义模型地址约束、90 天 usage 报告/清理 RPC 和定时任务；不要删除重建已有表。配置、额度设置和 quota buckets 保留；超过 90 天且符合安全条件的 usage 将按下节自动物理删除，不能承诺永久保留全部历史记录。

## 网页操作顺序

1. 确认打开的是正确的 Supabase 项目。更新已有服务时，先暂停新请求并等待当前生成结束。
2. 打开 SQL Editor，新建查询，将本目录 `club-chat-schema.sql` 的全部内容粘贴进去并运行。项目需已有社团账号和成员资料表；若 SQL 报错，保留错误信息，不要用删表来解决。
3. 在 Edge Functions 的 Secrets 页面配置或确认已有 Secrets。实际供应商 Key 只能保存在这里，不要粘进 TypeScript、SQL、网站脚本或模型配置。
4. 分别打开 `chat` 和 `chat-api-proxy` 的代码编辑器，将对应单文件全文替换进 `index.ts`，各自点击部署更新；尚不存在的函数可以在网页编辑器创建，名称必须准确。**已有部署仅升级 usage90day 时，只需全文替换 `chat-dashboard-index.ts` 并部署 `chat`**；代理行为未改变，不必仅为此重部署 `chat-api-proxy`。
5. 在两个函数各自的配置中关闭网关 JWT 验证（通常显示为 **Verify JWT with legacy secret** 或类似名称），保存设置。函数自身仍验证身份：`chat` 验证成员 JWT 和权限；代理验证 `cap_` 访问密钥。尤其代理 Key 不是 Supabase JWT，若保留网关验证会在进入函数前被拒绝。
6. 发布网站仓库中已经更新的前端脚本。Supabase 的 SQL / Edge 编辑器不负责更新你的静态网站；这一步按网站原有的网页发布方式完成，不要求使用 CLI。仅升级 usage90day 时发布 `public/chat-admin.html`、`public/chat-admin.js`、`public/chat-admin-i18n.js`，成员页脚本和 `public/chat-file-bundle.js` 不因本功能改变。
7. 打开网站 Chat 管理页配置供应商和模型。保存配置不会自动调用供应商；“测试调用”会产生真实请求，只有你确认后再执行。

## 社团 AI 助手更新

本次助手功能需要同时更新数据库、`chat` Edge Function 和网站静态文件。下节“安全加固更新”中的“不需要执行 SQL”仅指此前那一轮加固，不适用于本次助手更新。

1. 在 SQL Editor 执行本目录最新完整 `club-chat-schema.sql`。保留已有表和记录，不删除重建。助手配置初始关闭，资料导入只产生草稿。
2. 将本目录 `chat-dashboard-index.ts` 全文替换到 Edge Functions → `chat` → `index.ts`，部署更新。共享检索逻辑已内联，不需要在 Dashboard 新建 `_shared` 文件。此次助手不改变对外 API 代理，已有最新版代理不需要仅为助手重新部署。
3. 发布更新的网站静态文件，包含助手页面、启动器、样式、i18n、Chat 共享控制器与存储、重建的 `chat-file-bundle.js`、管理页文件和接入入口的页面。完整发布仓库的站点资源可避免遗漏相对依赖。
4. 使用动态超级管理员账号打开 Chat 管理页的“社团助手”区域，选择已启用、面向全部绑定成员开放的模型。供应商仍由模型关联，真实密钥只在 Edge Secrets 中维护。
5. 选择 [资料种子 seed.json](../assistant/seed.json) 导入草稿，按照 [来源清单](../assistant/source-manifest.json) 核对每条资料与出处，发布资料版本，再启用助手。初始种子含 14 篇中文草稿，尚未在线发布；ECA 时间等静态说明须核实现行安排。导入和保存配置不调用上游；实际问答、压缩及手动测试会使用供应商与共享额度。
6. 用绑定成员账号确认悬浮入口、问答来源、附件、压缩和跳页恢复；再检查未绑定账号不能发送。资料或模型未配置时，成员侧应显示助手暂不可用，不会自行选择其它模型。

助手与普通 Chat 共用账户额度、黑名单和生成并发租约，但本地历史使用独立数据库。收起窗口可继续生成，跳页会请求取消并保留已保存内容。取消通知无法保证供应商立即停止或不再计费。资料草稿不会影响当前发布版本；发布和回滚影响后续请求，历史回复保留当轮来源。

HTTP(S) 是正式运行环境。`file://` 仍受浏览器本地存储、认证、PDF 模块加载以及后端 `Origin: null` 放行条件影响；单文件脚本包不能消除这些平台限制。不应为绕过本地加载问题而放宽正式网站鉴权或消息来源验证。

本地自动化、浏览器实际检查及未覆盖边界见 [助手验证与交付记录](../assistant-validation/README.md)。此轮未自动部署、导入或发布线上资料。

### 已安装助手的资料校准与小Bru预设更新（2026-10-19）

这次更新不改 SQL 表或 RPC，已有助手数据库无需重复执行 SQL。网页方式将最新 `chat-dashboard-index.ts` 全文替换到 `chat` 并部署，以更新服务端小Bru身份、历史资料和导航边界；代理不受影响。然后发布本轮静态改动，尤其是 `chat-admin.js`、`chat-admin.html`、`chat-admin-i18n.js` 和新增依赖 `assistant-preset.js`，以及助手命名、指引、个人中心、首页及字典文件。

管理页超管鉴权成功后自动读取已有助手数据，切换 tab 不重复加载或覆盖未保存草稿；失败和版本冲突仍需显式刷新。点击“填入小Bru预设”，审核欢迎语、建议问题与补充系统指令，再点击“保存助手配置”。按钮保留当前模型和启用状态，不自动保存或发布。预设也提供 [可复制提示词](../assistant/system-prompt.txt) 和 [三字段配置副本](../assistant/config-preset.json)；配置副本不是知识库文档，不要选进“导入 JSON”。

重新导入新版 [seed.json](../assistant/seed.json) 并提交导入，相同 slug 会更新现有 14 篇草稿，其他自建资料不会被删除。检查自建资料是否仍有旧入口，最后“发布不可变版本”才会切换现行知识和已保存配置。仅更新仓库文件、选中文件或保存草稿都不会更新正在使用的发布版本。发布后建议新建对话核对签到入口；旧对话仍保留原回答/来源，但本轮服务端规则要求当前发布资料优先于旧回答和摘要。

逐篇证据、修正文案与复测范围见 [知识校准记录](../assistant-validation/knowledge-refresh.md)。

### 已安装助手的数学排版与实时只读查询更新（2026-10-19）

这一轮不改 SQL，已有当前助手数据库无需重新执行 SQL；只需更新 `chat` 函数、网站静态资源与审核后的助手预设。尚未安装助手的项目仍按上面的首次安装步骤处理。

1. 在 Supabase 网页 Edge Functions → `chat` → Code，将本目录 `chat-dashboard-index.ts` **全文替换**到 `index.ts` 后部署。实时适配器和共享助手规则已内联，不必新建 `_shared` 文件。已有最新版 `chat-api-proxy` 无需为这轮更新重新部署。
2. 按网站原有方式发布静态文件：`public/chat.html`、`public/assistant.html`、`public/chat.js`、`public/chat-core.js`、`public/chat-file-bundle.js`、`public/chat.css`、新增的 `public/chat-math.js`、`public/assistant-i18n.js` 和 `public/assistant-preset.js`。同时完整发布 `public/vendor/chat/katex/`，包括 JS、CSS、LICENSE 和全部字体，保持相对目录；只发布 KaTeX 的 JS 会造成公式或字体缺失。运行时不从外部数学 CDN 加载。
3. 在管理页点击“填入小Bru预设”，审核后保存配置；新版 [seed.json](../assistant/seed.json) 可按原有流程导入并审核草稿，然后发布不可变版本，使提示词与能力说明同步。保留自建资料，检查其中是否仍写着“完全不能实时查询”。[config-preset.json](../assistant/config-preset.json) 仍是三字段配置参考，不能当知识 JSON 导入。重新打开助手会刷新 catalog；保存或发布配置不会改写旧对话。
4. 实时读取复用项目现有 `club-drive` 普通成员只读动作和公开排行榜；使用平台已有 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 及当前已验证成员 JWT，不需要新增管理密钥或扩大权限。适配器固定本仓库项目主机；目标项目不匹配、现有端点未部署或权限不允许时返回不可用，不回退到管理员读取。
5. 部署后用绑定成员核对公式排版、当前公告/活动、姓名积分和六个榜单的来源时间及范围；管理员使用助手时也不得出现额外后台字段。真实问答会调用已配置供应商并使用共享额度，本次本地验收没有执行这一步。

只读范围是已发布公告/活动、姓名与积分、五子棋累计积分、俄罗斯方块普通/人机、贪吃蛇普通/人机和行于无垠总分。普通与人机榜独立；未说明类型时澄清。单榜默认前 20 名、最多 50 名，六榜同查每榜最多 10 名；姓名重名不猜账号。整体读取最多 5 秒，失败、维护、空结果、重名及截断均不得当作完整实时事实。实时读取在额度与租约准入后发生，catalog 与压缩不查询业务数据；来源正文不放入响应头。

本轮精确验证范围、权限及平台限制见 [数学与实时查询验收记录](../assistant-validation/markdown-live-query.md)。`file://` 包仍依赖页面旁边的本地 KaTeX 资源，并保留前述认证、Origin 和模块加载限制；没有把本地文件端到端标为已验收。

### 两阶段语义只读流程（2026-10-19，取代原生工具循环要求）

已批准的流程为：第一次普通模型请求仅生成 JSON 计划 → 服务端严格验证整个计划并执行至多两个固定读取 → 第二次模型请求生成最终回答。服务端在普通 Prompt 中提供固定规则、读取名称、用途和 JSON 参数定义，不要求供应商支持原生函数/工具调用或专用 JSON 模式。供应商必须支持所选协议（Responses、Claude Messages 或 Chat Completions）的普通 SSE，且规划响应必须是有效计划。

计划只能选择 `query`（一次列出1–2个读取）、`clarify` 或 `answer`。未知字段、非法 JSON、未知读取、非法参数或超额读取明确失败，任何读取都须等完整计划验证通过后执行。最终模型不得追加读取。正常完成的助手问答恰好两次模型请求，包括不需要读取或需要澄清的情况；校验失败、超时、取消或预算不足可提前结束，不重试规划或发起第三次请求，不假装查询或自动改用其它 Key。

比如“当前积分榜谁最高”选择积分降序第一页，“五子棋谁分数最低”选择总分升序第一页；最低分在数据库端排序，不是从前20名里选最低。读取范围仍为 `read_member_points`（姓名/积分）、`read_game_leaderboard`（六榜及允许的公开指标）、`read_published_content`（仅已发布公告/活动）。每页最多50条、页码最多100；不遍历全榜，不提供后台隐私或修改权限，不允许模型拼表名、URL、SQL、RPC。管理员使用助手仍只有普通成员级数据范围。

一次提问共用一个 request_id、一次额度准入、一个租约和一条审计；预留覆盖两次输入及有界计划/结果上下文，两次请求共享输出总预算，规划也计费，并须为最终回答留出预算。实际 usage 合并结算；缺失完整 usage、已启动后的失败/取消沿用保守计量，不能只结算较小的部分用量。每日准入仍读取当天 UTC 日桶（北京时间08:00重置），不读取管理页的90天 token 汇总。请求发出前若 `upstream_started` 标记失败，服务端只在数据库确认仍为 `audited` 且没有上游/usage证据时退款。额度保存只更改上限，不会清理此前已经记入日桶的用量或未结算预留。

规划、读取和最终回答共用120秒整体期限，保留更短的平台限制与取消传播。一个计划最多两个读取，每个读取最多5秒、原响应64 KiB、返回 envelope 6000字节，汇总 evidence 最多16000字节；计划 JSON 最多8192字节。请求12 MiB、每次上游 SSE 2 MiB等限制保留。规划请求移除 `reasoning` 和 `include`，Claude Messages 规划阶段显式关闭 thinking；最终回答保留模型配置的 thinking/reasoning，并共享剩余输出预算。因此只需为最终回答保留 Claude enabled thinking 的最低输出空间，不要求双份思考最低预算。静态检索的完整有界资料段落保留到最终回答，而非只传来源卡片或规划摘要。两阶段共用同一份折叠后的多轮历史（旧 assistant 消息作为不可信文本，不再原样重放），避免兼容网关在第二问拒绝历史消息；代码块包裹的单份 JSON 计划可恢复。规划输出非法或超限时不执行任何读取，而是由第二次请求诚实说明本轮无法完成，不再显示成网络故障。

`catalog` 与压缩不查询业务数据。服务端收集来源和最终回答后发送标准 Responses SSE；准备期间界面保持生成状态，首字可能更晚。规划 JSON、文字/分析和内部参数隐藏，不发送给前端或保存到浏览器历史；只保留最终回答及来源，来源响应头不含数据行和原始筛选值。

两阶段运行时已接入 Chat。以下是本轮公告查询和榜单指定姓名过滤修复的增量部署范围：**不改 SQL、不执行 SQL，不更新助手模型/预设配置，也不调用真实供应商。**

1. 在 Supabase Dashboard → Edge Functions → Secrets **明确确认 `CLUB_SERVICE_ROLE_KEY` 这一名称存在**。`club-drive` 仍读取该名称，本轮没有增加回退到 `SUPABASE_SERVICE_ROLE_KEY` 或其它名称的代码；仅有平台的 `SUPABASE_SERVICE_ROLE_KEY` 不满足此检查。缺失时由管理员在 Secrets 安全配置，值不得写进文档、代码、前端或模型配置。流程不引入新的密钥类型，也不扩大权限。
2. 将完整 [chat-dashboard-index.ts](chat-dashboard-index.ts) 替换到 `chat` → `index.ts` 并部署。该 bundle 包含公告规划约束、榜单指定姓名过滤、空答复保底、分类精确过滤和正文校验/截断逻辑。
3. **同时**将完整 [club-drive-dashboard-index.ts](club-drive-dashboard-index.ts) 替换到 `club-drive` → `index.ts` 并部署。`club-drive` 内含独立的只读查询副本；两边必须使用同一轮生成的 bundle，不能只更新 `chat`。保留原有鉴权设置和其它动作。
4. 本轮不需要重新部署 `chat-api-proxy`，不需要执行 SQL，不需要更新助手模型、预设、seed 或重新发布知识版本。若此前环境尚未部署 `assistant_read_query`，先按上方首次只读查询升级步骤完整部署 `club-drive`。
5. 若尚未发布此前的浮窗尺寸修复，还需按网站原有方式发布 `public/assistant-launcher.js` 与 `public/assistant-launcher.css`；本轮公告查询本身不改变这两个文件。
6. 部署后用绑定成员分别验证：无分类查询“社团公告”、五种分类查询、确实无匹配时的空结果、公告正文过长时的正常截断，以及“查询指定昵称的五子棋排行榜”与不带昵称的前几名查询返回一致。真实模型语义、目标项目权限和线上数据仍须独立核对；本地模拟不能证明线上结果。

此前仅切换两阶段后端的部署说明仍适用于只更新 `chat` 的历史场景，但不适用于本轮公告过滤修复，因为本轮同步修改了 `club-drive` 的独立副本。

审计 `error_code` 只记录安全类别：计划解析/校验/大小为 `assistant_plan_json`、`assistant_plan_invalid`、`assistant_plan_arguments`、`assistant_plan_size`；规划调用为 `assistant_plan_http`、`assistant_plan_network`、`assistant_plan_stream`、`assistant_plan_usage`；回答调用为 `assistant_answer_http`、`assistant_answer_network`、`assistant_answer_stream`；预算与上限为 `assistant_output_budget`、`assistant_context`、`assistant_request_size`、`assistant_evidence_size`，未分类兜底为 `assistant_plan_failed`。不记录原始计划、参数/结果、供应商正文或密钥，错误类别不证明读取成功或可退款。

契约及错误说明见 [两阶段只读记录](../assistant-validation/semantic-read-tools.md)。本地离线通过188项真实 handler mock 集成用例、126项计划与三协议 SSE 测试、固定只读执行器及保留旧路径回归；类型检查、Dashboard bundle 源码一致性和差异检查通过。浮窗放大尺寸已在本地无头 Chrome 的 1440x900、1920x1080、1024x768 视口实测为 50%x50%（面积 25%）并居中。没有发送真实模型请求或部署，不以本地结果保证供应商语义质量或线上权限。

## 安全加固更新（Chat 与对外代理）

已有当前三协议/usage90day 版本时，本次只需在 Dashboard **分别全文替换并部署两个 Edge 文件**：`chat-dashboard-index.ts` → `chat`，`chat-api-proxy-dashboard-index.ts` → `chat-api-proxy`。本次未修改 SQL，也不需要为这轮加固重新执行 SQL 或发布前端。尚未安装前述功能的项目仍按完整部署步骤执行。两个 bundle 已包含新的共享请求体读取器，不必另建 `_shared` 文件。

- Chat 管理操作只信任 `club_super_admins` 中匹配已验证用户 UUID 的记录。空表、缺表、读取失败或畸形结果一律拒绝，不再按初始管理员邮箱回退。部署前确认应保留的管理员已经在动态名单中；邮箱本身不再授予 Chat 管理权限。其他站点的管理员引导逻辑不在本次改动范围。
- 两个入口均按实际流入字节限制请求体为 **12 MiB**；省略或低报 `Content-Length` 不能绕过，非法长度也返回 `413 request_too_large`。固定大小聚合块避免大量微小分片长期驻留。
- Chat 读取请求体最多 **10 秒**；客户端取消或读取超时返回 `504 timeout` 并取消读取。该 10 秒只限制上传读取，不是模型生成时间限制。慢速网络上传大型附件可能触发超时。代理读取继续使用原有整条请求最多 120 秒的 deadline，不另加 10 秒限制。
- PowerShell / curl / SDK 携有效成员 JWT 或有效 `cap_` Key 直接调用是设计能力，不是漏洞。CORS 不能防止命令行调用，也不能替代服务端认证。页面维护遮罩不是 API 总闸；需要停止付费调用时，停用供应商/模型或代理路由，必要时撤销代理 Key，并等待在途请求结束。

验证范围与剩余边界见 [安全加固报告](../chat-validation/security-hardening.md)。这只是本地代码和部署材料更新；未自动部署到你的 Supabase 项目。

## 可折叠思考内容的前端更新

已部署当前三协议后端时，本次思考展示只需发布静态文件：`public/chat-core.js`、`public/chat.js`、`public/chat.css`、`public/chat-i18n.js` 和重建后的 `public/chat-file-bundle.js`。页面 HTML 不需要调整；不需要为此执行 SQL 或重新部署 Edge Functions。旧后端若尚未具备三协议思考转发，应先按上述完整部署步骤更新。

折叠区展示供应商实际返回的 thinking / reasoning / reasoning summary，并随浏览器本地会话保存。仅开启模型思考强度不保证上游返回可读内容；没有返回时不会出现空的思考区，也不能从加密推理或签名恢复内部过程。普通正文和搜索结果不会自动归为思考；只有明确的开头 `<think>…</think>` 块会分离。复制答案和后续普通对话上下文不包含展示用思考文本。具体支持范围与本地验证场景见 `../chat-validation/README.md`。

## 90 天 usage 汇总与无人访问时的自动清理

本功能升级顺序是**完整 SQL → `chat` Dashboard 单文件 bundle → 管理页 HTML/JS/i18n**。函数仍在服务端校验成员 JWT 与动态超级管理员，报告和清理 RPC 仅授予 `service_role`；不要把 RPC 或审计表权限开放给浏览器角色。

`admin_usage` 返回原有 `usage,page,pageSize,total`，新增 `summary:{total_records,total_tokens}` 和顶层 `window_start,window_end`。`total` 是日期筛选后的全部记录数；summary 统计整个滚动窗口，翻页、改变每页数量或日期条件都不改变其统计范围。窗口按 `started_at` 的 UTC 时间计算为 `[asof−2160h,asof)`，包含恰好 90 天的起点，排除 as-of 及未来记录；不会按本地日历或月边界取整。`total_records` 为数字，`total_tokens` 为精确十进制字符串，`null` token 不参与求和但真实记录仍计数，没有已知 token 时返回 `"0"`。管理页通过 `admin_usage` 读取汇总，无需新增 `admin_get` 字段。

SQL 安装清理函数与每小时运行的命名任务 **`chat-usage-retention-90d`**，重复执行脚本会幂等更新任务。若 `pg_cron` 扩展可用，脚本会尝试安装/启用并安排任务；扩展不可用、安装失败或 scheduling 失败会在 SQL 结果中给出可见 warning。必须核对任务已安装且 active，并在后续运行记录中检查成功；看到 warning 时不能当成自动清理已经生效，需要先解决扩展/权限/任务配置或提供等价的受控定时调用。管理读取不执行删除，也没有依赖访客的清理兜底。

在同一项目的 **SQL Editor → 新建查询 → Run** 执行以下只读查询，确认恰有一条命名任务、`schedule` 为 `0 * * * *`、`command` 调用 `public.chat_cleanup_usage()`，且 `active` 为 `true`：

```sql
select jobid, schedule, command, active
from cron.job
where jobname = 'chat-usage-retention-90d';
```

等待下一次小时任务后，查询最近执行记录，核对 `status` 为 `succeeded`，失败时查看 `return_message`：

```sql
select r.jobid, r.runid, r.status, r.return_message,
       r.start_time, r.end_time
from cron.job_run_details as r
join cron.job as j on j.jobid = r.jobid
where j.jobname = 'chat-usage-retention-90d'
order by r.start_time desc
limit 10;
```

刚安装还没有执行记录是正常的；任务列表为空、`active=false`、查询报 `cron` 对象不存在或到时仍没有成功记录，都需检查安装 warning、扩展/权限及任务配置，不能据此确认自动清理已生效。

SQL 安装阶段不会立即删除。**部署后的首次定时清理执行时**，符合条件的旧记录会被不可逆地物理删除；这是用户明确要求的保留策略。条件为 `started_at` 超过 90 天、状态已终结、`finished_at` 非空、没有 reservation 或 reservation 已结算，并且没有未过期 lease；删除关联 allocation、已结算 reservation、过期 lease，再删除 usage。未完成或未结算的内部计量记录继续保留以允许迟到结算，即使 lease 已过期也不直接删除，但它们超出窗口后不会出现在列表或汇总中。

任务运行于数据库，没有访问管理页也会自动执行。列表立即限制最近 90 天；每小时任务最多删除 1000 条安全过期记录，没有积压且任务正常时通常在下一小时任务完成清理。积压会跨多个小时批次，等待结算或任务失败时可能更久。清理不改 quota counters、quota buckets 或额度设置，不退款、不重算额度，也不清除浏览器 IndexedDB 的聊天正文。本站清理不控制供应商自己的日志保留。

本地已在 PGlite 的 PostgreSQL WASM runtime 执行完整 schema 和重复安装，验证 1505 条记录的精确汇总/分页/日期/权限，并通过清理外键、保护条件、迟到结算、quota 不变和 1000+1 分批测试。这是单连接运行，尚未验证独立 PostgreSQL 服务器的多连接并发或真实 pg_cron；也没有运行线上 SQL、部署函数或发送付费请求，不能证明目标项目任务已运行。完整保留与额度边界见 `../chat-deployment.md` 第 9 节。

## Secrets

在 Supabase 网页 Secrets 中逐项维护，以下仅是变量名与占位说明，不要原样当作真实值：

- `SUPABASE_URL`：项目 URL，若平台已提供则保留。
- `SUPABASE_ANON_KEY`：项目公开 anon key，若平台已提供则保留。
- `SUPABASE_SERVICE_ROLE_KEY`：Chat 等使用的平台服务端密钥，若平台已提供则保留，不要复制到前端。它不能替代 `club-drive` 所读取的名称。
- `CLUB_SERVICE_ROLE_KEY`：`club-drive` 现有的服务端密钥变量名。部署前在 Secrets 列表明确核实这一名称存在；当前代码没有回退到 `SUPABASE_SERVICE_ROLE_KEY`。缺失时仅由管理员在 Secrets 中安全配置，不在文档、代码、前端、模型配置或验收记录中填写任何实际密钥。
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
- 代理路由/密钥不会因执行 SQL 或部署函数而自动删除，需超级管理员在页面逐项确认；这与前文自动执行的 usage 保留任务是两种独立操作。上游供应商 Key 所在的 Edge Secret 不会随路由删除。

## 当前验证边界

两阶段运行时已接入，188项真实 handler mock 与126项计划/SSE用例通过，类型检查和 Dashboard bundle 一致性通过；完整命令与边界见两阶段只读记录。usage90day 的历史 PostgreSQL 执行验证使用 PGlite WASM runtime，范围与单连接限制见前文。没有代你登录 Supabase、运行线上 SQL、部署函数或调用真实供应商；本地验证不能证明网页上的旧函数已更新、模型真实语义质量或真实 pg_cron 已成功运行。
