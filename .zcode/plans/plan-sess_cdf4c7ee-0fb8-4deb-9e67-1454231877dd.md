## 修复目标

解决以下三个问题，同时保持每日配额、周/月配额和 90 天统计各自独立：

1. 小Bru一次请求不应因为“首轮尚不存在的工具历史”而过度预留输入 token。
2. 在真正发送上游前的审计标记失败时，若数据库能证明请求没有启动，必须退回预留额度；若状态已写入但响应丢失，则继续保守保留。
3. 普通 Chat 和小Bru都不能在“上游未收到请求”的确定场景保留配额；已真正开始上游或 usage 不确定的请求继续不退款。

## 实施步骤

1. **修正小Bru多轮输入预留**
   - 修改 `supabase/functions/_shared/chat-assistant-tool-loop.ts` 的 `assistantToolBudget()`：
     - 保留 `perTurnInputTokens` 的最大历史估算，用于上下文/目录展示；
     - 首轮只按实际基础输入 + 工具 schema + 固定余量估算；
     - 第二、三轮才按 48 KiB 历史上限估算；
     - 总预留改为 `firstTurn + maxLaterTurn * 2`，而不是把最大历史估算乘 3。
   - 这样仍然覆盖最多三次模型请求的安全输入上界，但不会把首轮不存在的 48 KiB 历史重复计算三次。

2. **修正上游启动标记的退款判定**
   - 修改 `supabase/functions/chat/index.ts` 普通 Chat 路径：`updateUsage(status=upstream_started)` 成功后才认定 `started=true`；失败时调用受 SQL 状态保护的 `finishGeneration(..., true)`。
   - 修改小Bru工具 dispatch 路径：同样在 status PATCH 成功后才设置 `started=true`；失败时走 guarded refund。
   - 保留 SQL 的 fail-closed refund guard：如果 PATCH 实际已写入 `upstream_started`、存在 upstream status 或任何 token evidence，退款会被拒绝，避免不安全返还。
   - 不改变真正发起 fetch 后的失败/取消策略：上游状态或 usage 不确定时继续保留预留。

3. **保留结算可靠性**
   - 保留当前“结算 RPC 成功后才标记 settled”的修复，并保留一次相同幂等结算数据重试；两次失败不向客户端伪造成功。
   - 不修改 SQL 的 first-settlement-wins、reservation 替换实际 usage、missing usage 保守保留规则。

4. **补充回归测试**
   - 更新 `tools/test-chat-assistant-tool-loop.ts`：断言预留从旧的三次最大历史估算改为首轮+两次后续上界；覆盖 enabled thinking 与多轮输出预算。
   - 更新 `tools/test-chat-backend.ts`：
     - 普通 Chat 的启动标记 PATCH 失败：无 provider fetch、`p_refund=true`、额度归零、租约释放；
     - 小Bru启动标记 PATCH 失败：同样验证 guarded refund；
     - PATCH 响应丢失但数据库已写入 marker：退款被 SQL guard 拒绝并保留额度；
     - 真实 upstream/network/stream/usage 不确定失败仍 `p_refund=false`；
     - finish RPC 暂时失败后幂等重试成功。
   - 保留 SQL 测试中对每日桶、周/月桶、预留、结算、退款拒绝和 90 天汇总独立性的覆盖，并增加“提高每日上限不重置已用量”的断言。

5. **同步部署产物与文档**
   - 运行 `node tools/build-chat-dashboard-bundles.mjs`，同步 `docs/chat-deployment/chat-dashboard-index.ts`；不修改 SQL，因为本修复沿用现有安全退款条件和每日桶逻辑。
   - 在 `docs/assistant-validation/semantic-read-tools.md` 和部署说明中明确：90 天统计不是每日准入来源；配额显示包含正在结算的预留，直到结算替换或安全退款。
   - 不修改助手知识配置作为修复手段；工具目录/提示词只在必要时更新说明。

6. **验证与现有数据处理**
   - 运行 Deno 类型检查、tool-loop/protocol/backend/read-tool 测试、SQL 语法/配额测试、Dashboard bundle 一致性和 `git diff --check`。
   - 不部署、不读取真实密钥、不访问线上数据、不调用付费上游、不 commit/push。
   - 对已经被错误保留的线上 reservation 不自动清零或重置每日桶；修复后先用只读查询识别 `audited + upstream_status is null + 未结算` 记录，再仅对数据库明确证明未启动的记录执行受保护退款。已启动、usage 不确定或状态不明的记录继续保留，避免错误返还。