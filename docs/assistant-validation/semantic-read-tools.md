# 小Bru两阶段语义只读流程

日期：2026-10-19。助手运行时已接入两阶段流程：普通 Prompt 生成 JSON 读取计划 → 服务端严格校验并执行固定读取 → 模型生成最终回答，取代此前的供应商原生工具循环。静态检索得到的完整有界资料段落同时保留给最终回答，不以来源卡片或规划摘要代替正文。本更新不改 SQL，也未执行 SQL、部署、读取真实供应商 Key、请求真实成员数据或发送付费模型调用。

## 用户可见行为

一次正常完成的助手问答恰好发出两次模型请求，使用当前已发布助手模型及其已配置协议：

1. 规划请求：服务端在普通 Prompt 中提供固定规则、三个只读能力的名称、用途和 JSON 参数定义，模型仅返回一个 JSON 计划。计划为 `query`（一次列出 1–2 个读取）、`clarify`（需要澄清）或 `answer`（无需实时读取）。不依赖原生工具声明、函数调用或供应商专用 JSON 模式。
2. 最终回答请求：服务端先严格校验完整计划，仅执行其中已验证的固定读取，再将有界结果及来源交给模型。无读取和需要澄清的计划也进入这次最终回答请求；最终模型只能作答或提出澄清，不能追加读取或再次规划。

两次请求是正常成功路径的固定次数；校验失败、预算不足、超时或取消会提前结束，不为凑足次数继续调用，也不重试规划或发起第三次模型请求。供应商无需支持原生工具调用，但必须支持所选协议的普通 SSE 响应，规划阶段必须产生符合契约的有效 JSON 计划。非法计划或异常协议明确失败，不假装查询，不自动改用其它 Key 或供应商。

- “帮我看一下当前积分榜谁的积分最高”：计划选择 `read_member_points`，`order_by=points,direction=desc,page=1,page_size=1`。
- “帮我看一下五子棋排行榜谁的分数最低”：计划选择 `read_game_leaderboard`，`board=gomoku,order_by=total_score,direction=asc,page=1,page_size=1`。
- “查询张三的积分”：明确的 `member_name` 精确筛选，同名返回 ambiguous，不用班级或账号消歧。
- “接着看下一页”：新一轮规划结合对话选择相同查询的下一页；每次重新读取，不把旧回答当实时证据。

最高/最低由数据库在筛选和分页前排序，不是下载默认前20名后在本地找极值。实时查询不依赖关键词/姓名正则抽取；模型仍可能理解错误，所以来源同时记录生效的排序、方向和分页范围。真实模型语义质量仍待核对，本地模拟不能证明线上模型的选择正确。

静态社团文档仍采用现有有界检索。普通 Chat、管理员测试、对外 API 代理和助手压缩保留原路径；恰好两次请求的契约针对助手正常问答，不扩大到这些路径。数学渲染和用户已有浮窗 UI 保留。

## 可用读取与严格校验

| 固定读取 | 参数能力 | 固定数据范围 |
| --- | --- | --- |
| `read_member_points` | 按 points/member_name 升降序、明确姓名、积分区间、分页 | 仅姓名与积分；不输出班级、账号、邮箱、成员UUID、绑定资料 |
| `read_game_leaderboard` | 选择六榜之一、按该榜公开指标排序、明确昵称、分数区间、分页 | 五子棋、俄罗斯方块普通/人机、贪吃蛇普通/人机、行于无垠；只含公开显示名和指标 |
| `read_published_content` | 公告/活动、公开ID、标题字面子串、类别、活动状态、日期区间、排序、分页 | 始终强制已发布；不含作者/更新者UUID，不读取报名名单或后台资料 |

计划只接受规定的 JSON 对象、action 和对应字段，拒绝额外文本、未知字段、错误类型、未知读取名称及超过两个的读取。执行任何读取前须验证整个计划及每项参数，包括不同榜单允许的排序字段、整数范围、日期、页码和内容类型；Prompt 中的定义不能代替服务端验证。一次计划最多两个固定读取，不允许根据第一次结果再规划、循环、无上限下载或遍历。

模型没有任意 URL、表名、select、SQL、RPC、认证头、管理员 action 或业务写操作入口。公告正文、昵称、参数、历史和附件都是不可信数据，不能覆盖固定规则。

人机俄罗斯方块/贪吃蛇的最高分差允许为负数；五子棋按累计积分；行于无垠只查公开总分视图，绝不查账户/进度底表。大整数保持精确。结果位置不自动称为全站排名；筛选后的第1条不等于全站第1名。并列极值和完整人数需要继续核实，不能从单条结果推断“唯一最高”。

## 接口、权限与 Secret

`club-drive` 动作 `assistant_read_query` 要求已验证登录身份，输入 `{action,query}`。该动作内部只允许 member_points/announcements/events 的固定投影和筛选，不允许客户端提供表名/字段或 published=false。成员积分同名探测在分页和分数筛选前执行，避免用分数条件偷偷选择某个同名身份。原有列表动作保留。

Chat 入口仍要求绑定成员，并检查助手启用、发布模型、供应商、黑名单、额度与租约。管理员/超管使用助手也得到相同成员级范围。Chat 读取执行器不使用 service-role；游戏公开读取使用 anon 认证，成员 JWT 仅用于固定 club-drive 查询动作。

`club-drive` 服务端仍读取名为 `CLUB_SERVICE_ROLE_KEY` 的 Secret；本次没有增加回退到 `SUPABASE_SERVICE_ROLE_KEY` 或其它名称的代码。后续部署前须在 Supabase Dashboard → Edge Functions → Secrets **明确确认 `CLUB_SERVICE_ROLE_KEY` 这一名称存在**；仅有 `SUPABASE_SERVICE_ROLE_KEY` 不满足此检查。若缺失，须由管理员在 Secrets 中安全配置，不能把值写进文档、代码、前端、模型配置或验收记录。两阶段流程不引入新的密钥类型，也不扩大模型权限。

固定项目 HTTPS 主机，不跟随重定向，不重试其它密钥或自动切换供应商。站点及对应功能维护开关保留，行于无垠还检查独立的公开服务状态。失败、暂停、空结果、歧义分别返回，非空但字段错误的响应是 unavailable，不能伪装成 empty。

## 调用与预算

正常完成固定为规划和回答两次模型请求，一个计划最多两个固定读取；每页1–50条、页码1–100。允许查看数据库两端和有界分页，不允许无上限下载或遍历。

现有单次读取限制保留：整体最多5秒、原响应最多64 KiB、返回 envelope 最多6000字节。一个计划最多两个读取，汇总 evidence 序列化后最多16000字节，每个读取仍须各自满足6000字节上限。计划 JSON 最多8192字节。旧原生工具历史不再是运行时所需上下文。内容或行数删减明确标记，`has_more` 可为 true/false/null，不虚构总页数和总人数。每次模型请求实际序列化字节仍受原有12 MiB限制，普通上游 SSE 每次最多2 MiB。

规划、读取和最终回答共用最多120秒的整体期限，不是每阶段各120秒；仍受 Edge Functions/供应商自身更短限制。用户取消同时中止模型/数据读取。无关问题的 `answer` 计划及 `clarify` 计划均零业务数据读取；catalog和压缩始终不执行实时读取。

同一提问只有一个 request_id、一次准入、一个租约和一条审计。准入须覆盖两次模型输入及有界计划/结果上下文，不再按三次请求或多轮原生工具历史预留。输出总预算由当前模型默认输出和额度收缩结果共同限制，两次请求共享；规划输出也消耗预算，必须为最终回答留出空间，不能每次重新获得完整输出。每次发送前复核上下文、字节与剩余输出预算，累计两次实际模型用量后统一结算，界面与审计使用合并用量。

预留在成功或保守结算时替换为实际 token；尚未发送上游且数据库能确认未启动的失败才安全退款。任一阶段缺失完整 usage 时，不以较小的部分 usage 退款，保留保守预留；上游已启动后的失败/取消保留既有保守计量语义。准备/校验失败或取消只有在确定未启动时才退款并释放租约；已尝试持久化 upstream_started 后的不确定失败不承诺退款。第二阶段前失败也不能把第一阶段已产生的用量当成免费。

每日配额读取当天 UTC `global/day` 桶（北京时间08:00重置），不按90天 usage 汇总计算。管理页的90天 token仅是审计报表。Chat 页面在返回前台时重新读取额度快照；助手刷新 catalog 配额；过期额度错误只在新快照确认所有有限配额周期都有余额后清除。当天“已用”包含尚未结算请求的预留，直到结算替换为实际用量或确定未启动时安全退款。提高配额只改上限、不清空既有用量；如果线上仍有历史未结算预留，更新流程不会自动回退它们，应先只读核对审计和 reservation 状态，再按数据库可证明的未启动条件处理。

既有结算成功路径遇到暂时性 finish RPC 错误时，以相同幂等结算数据重试；仍失败时进入既有失败兜底，不把未确认结算报告为已完成。规划请求移除 `reasoning` 和 `include`，Claude Messages 规划阶段显式发送 disabled thinking；最终回答保留模型配置的 thinking/reasoning，并使用共享输出预算的剩余额度。Claude 手动 enabled thinking 的最低输出要求只为最终回答预留，不要求规划阶段再满足一份思考最低预算。当前模型配置可以保持不变；预算不足明确失败，不新增请求或静默修改保存的配置。

## 来源与前端

静态最多4条；新流程最多两个读取来源，总计最多6条，不再使用旧循环最多8条实时来源的额度。静态来源编码头小于4000字符，每个实时来源小于等于980个编码字符，组合头小于12000个ASCII字符。响应头不含数据行和原始筛选值；最终模型收到有界读取结果，前端来源保存时间、状态、排序、方向、页码、每页上限、返回数和是否有后续结果。只显示答案实际引用的合法编号；中英文切换动态刷新。

为了在响应头中携带本轮完整来源并在交付成功前完成审计，服务端收集规划、读取与最终回答后，再按标准 Responses SSE 返回最终回答。界面在准备期间维持生成状态；首字可能比普通 Chat 更晚。规划 JSON、规划文字/分析和内部参数均隐藏，不发送给前端、不保存到浏览器对话历史。浏览器历史只保留最终回答及其来源，不包含密钥或内部规划上下文。

## 安全错误分类

审计中的 `error_code` 仅记录安全的失败类别，不包含原始规划 JSON、读取参数/结果、供应商响应正文、认证头或密钥。类别不能作为已读取成功或可退款的证明；计量仍遵守前述启动状态与 usage 规则。

| error_code | 含义 |
| --- | --- |
| `assistant_plan_json` | 规划文本不是合法 JSON |
| `assistant_plan_invalid` | 计划结构、action、字段或读取数量不合法 |
| `assistant_plan_arguments` | 固定读取名称或参数验证失败 |
| `assistant_plan_size` | 计划超过字节上限 |
| `assistant_plan_http` / `assistant_plan_network` / `assistant_plan_stream` | 规划阶段 HTTP/SSE 响应、网络或流协议失败 |
| `assistant_plan_usage` | 规划输出 usage 缺失，无法安全分配剩余输出预算 |
| `assistant_answer_http` / `assistant_answer_network` / `assistant_answer_stream` | 最终回答阶段 HTTP/SSE 响应、网络或流协议失败 |
| `assistant_output_budget` / `assistant_context` | 输出预算或上下文限制不满足 |
| `assistant_request_size` / `assistant_evidence_size` | 模型请求或汇总证据超过字节上限 |
| `assistant_plan_failed` | 未归入上述类别的安全兜底 |

既有取消、数据库、鉴权、额度及协议错误继续使用各自的安全分类，不以错误详情泄露内部内容。

## 验证记录

以下均为本地离线测试，未开放真实网络权限，不证明线上供应商语义质量、目标端点权限或线上数据可读：

- `deno run --allow-env tools/test-chat-backend.ts`：187 项真实 handler mock 集成用例通过。覆盖两次普通模型请求、无原生工具字段、非法计划零读取、共享准入/租约/审计、合并 usage、额度收缩、取消、失败与退款边界。
- `deno test --no-config --no-lock tools/test-chat-assistant-plan.ts`：115 项计划、三协议普通 SSE、参数边界、完整静态资料、Claude thinking 预算及取消回归通过。
- `deno run --no-remote --allow-read tools/test-chat-assistant-tools.ts`：10 组固定执行器及真实 club-drive handler 模拟通过，涵盖权限投影、维护状态、大整数、分页、同名和读取限额。
- `tools/test-chat-protocol.ts`、`tools/test-chat-assistant-tool-protocol.ts`、`tools/test-chat-assistant-tool-loop.ts`、`tools/test-chat-assistant-live.ts` 的协议与保留旧路径回归通过。旧工具循环的通过不作为新运行时接入证据。
- `node tools/test-chat-core.mjs`、`node tools/test-assistant-knowledge.mjs` 和 `node tools/build-assistant-preset.mjs --check` 通过。
- Chat、club-drive、共享助手模块、相关测试及三份 Dashboard 单文件均通过 `deno check`。`node tools/build-chat-dashboard-bundles.mjs --check` 确认三个 bundle 与完整 SQL 副本匹配源码；实际内容变更仅涉及 Chat bundle。`git diff --check` 通过。

未运行浏览器或线上部署验收；本更新未改前端、数据库 schema、club-drive 源码或 Gomoku 数据/assets。

## 网页部署范围（本次不执行）

已有当前助手且 `club-drive` 已包含 `assistant_read_query` 时，两阶段切换只需在部署产物核对后，将完整 `chat-dashboard-index.ts` 替换到 `chat` 的 `index.ts`。无需仅为此重部署 `club-drive` 或 `chat-api-proxy`，无需发布前端、file bundle、预设或 seed，无需重新保存/发布助手配置；当前模型配置可以保持不变。

部署前仍明确核实 `CLUB_SERVICE_ROLE_KEY` 名称存在，没有代码回退。若 `club-drive` 尚不含上述动作，属于此前只读查询功能的升级，须另行使用完整 `club-drive-dashboard-index.ts`；首次安装和此前数学/静态资源更新也按 [网页部署说明](../chat-deployment/README.md) 对应章节单独处理，不是两阶段后端切换的前置发布清单。

供应商只需满足所选协议的普通 SSE 和有效 JSON 计划要求，无原生工具调用前置条件。本更新不改 SQL、不执行 SQL；本次没有部署函数、发布线上资料或实际试调密钥。
