## 修复目标
让单张约 2040 KiB 的图片在模型配置 `context_window = 200000`、`default_max_output_tokens = 32000` 时不再因为 Base64 传输字节被误算为约 928k token 而失败；同时继续严格执行单附件 5 MiB 和整个 JSON 请求 12 MiB 的传输限制。

## 实施步骤

1. **拆分 token 估算与传输字节估算**
   - 修改 `public/chat-core.js`：保留 JSON/UTF-8 字节检查作为请求体限制，但新增面向 Responses input 的估算函数。
   - `input_text`、`output_text` 和必要的文本字段继续按当前近似规则估算；`input_image.image_url`、`input_file.file_data` 等 Base64 data URL 不再按完整字符串字节数折算 token。
   - 对图片和原生文件使用明确的、保守且与传输大小独立的媒体 token估算常量，按 `detail` 做有限区分或采用统一保守上限；这样大文件的 token 估算不会随 Base64 字符串线性膨胀。
   - `buildContext()` 使用新的 token 估算函数，同时继续使用真实 `JSON.stringify` 字节数检查。历史轮仍按完整轮次裁剪；当前轮如果是 token 超限抛出 `context`，如果是 JSON 传输体超限抛出独立的 `request_too_large`。
   - 保持 `context_window - outputTokens` 的预算语义不变，确保 200000/32000 仍预留 168000 输入 token。

2. **同步 Edge Function 的最终校验**
   - 修改 `supabase/functions/chat/index.ts`，增加与前端一致的 input token 估算逻辑：文本按近似文本预算，图片/PDF data URL 按媒体预算，不按完整 Base64 字节 `/3` 计算。
   - 将 `callResponses()` 当前对完整上游 JSON 的 `encodedBytes / 3 + outputTokens` 校验替换为新的 input token估算加输出预算；完整序列化字节仍单独检查 `MAX_REQUEST_BYTES`。
   - 保留现有附件解码字节、附件数量、模型能力、输入结构和 12 MiB JSON 校验，确保这次修复不会放宽真正的请求限制。
   - 前端和后端使用相同常量、同样的媒体处理规则，并在代码中明确这是发送前的保守近似，不替代供应商最终 usage。

3. **区分前端错误状态和文案**
   - 修改 `public/chat.js` 的错误码映射，使 `request_too_large` 不再被归类为普通请求失败或 `context`。
   - 修改 `public/chat-i18n.js`，分别提供“模型上下文预算不足”和“请求体超过 12 MiB，请减少附件或历史内容”的中英文提示；保留现有文件/附件错误提示。
   - `generate()` 的重复请求字节检查改为抛出 `request_too_large`，避免把传输限制误报成上下文限制。

4. **补充边界测试**
   - 修改 `tools/test-chat-core.mjs`：构造约 2040 KiB decoded bytes 的图片 data URL，在 `context_window: 200000`、`outputTokens: 32000` 下验证 `buildContext()` 可以通过；再验证真实序列化体超过 12 MiB 时仍单独失败，并覆盖历史图片累计和文本上下文超限。
   - 修改 `tools/test-chat-backend.ts`：增加相同 2040 KiB 图片、200000 上下文、32000 默认输出的真实 handler mock 集成用例，断言单附件和请求体均通过、上游收到请求且使用 32000 输出预算；保留现有超大请求 413、文本上下文 413、附件大小和数量测试。
   - 若 mock 的本地 token 统计与生产预算逻辑存在差异，补充注释或最小同步，使 mock 不再暗示 Base64 字节就是生产 token；不使用 mock 结果替代真实 handler 测试。

5. **运行验证**
   - 运行 Chat core/UI 测试、真实 handler mock 集成测试、本地 mock 自检、相关 JS 语法检查和 `git diff --check`。
   - 用本地浏览器复现 2040 KiB 图片上传场景，确认 UI 不再显示合并的“上下文或请求限制”错误；同时验证 12 MiB 请求体边界仍被拒绝且错误文案准确。
   - 不调用付费供应商、不部署、不执行线上 SQL、不提交或 push，并保留现有 Gomoku/训练数据工作区改动。数据库 schema 不需要变更。