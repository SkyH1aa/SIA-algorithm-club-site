## 实施计划：ChatAI 超管管理的 Responses API 代理

### 一、已确定的方案

采用你选择的方案：
- **自有代理 URL + 自有代理 API key**，不向社员提供上游原生 key。
- 第一版只支持 **POST `/responses`**，同时兼容普通 JSON 响应与 SSE 流式响应。
- 上游真实 key 保存在 **Supabase Edge Function Secrets**；管理页只填写 Secret 引用名，不填写或回显真实 key。
- 销售、收款、发货由你自行处理；网站不增加支付、套餐或自动售卖。

使用方式示例：
```text
超管填写的上游 Base URL：https://api.example.com/v1
Secret 引用名：CHAT_KEY_RESELL_A

系统生成的代理 Base URL：
https://<project>.supabase.co/functions/v1/chat-api-proxy/<随机路由ID>/v1

社员调用：POST <代理BaseURL>/responses
Authorization: Bearer <你签发的代理APIkey>
```
上游实际请求地址为 `<上游BaseURL>/responses`。输入必须是基础地址，不含 `/responses`；你示例中的 `/response`（单数）不会被默认为标准端点。第一版按标准 `/responses` 实现，若供应商只有非标准端点会明确报配置问题，不静默猜测或改写。

### 二、独立于现有网站对话

新增独立 Edge Function `chat-api-proxy`，避免改动现有成员 Chat 的 Responses 校验、模型配置、token 配额和审计结算。

- **管理接口**仍放在现有 `chat` Edge Function 中，使用 Supabase 登录和动态超级管理员校验。
- **调用接口**只验证代理 API key，不要求社员登录网站或传 Supabase publishable key。
- 新函数配置 `verify_jwt=false`，由函数内部验证代理 key；否则 Supabase 网关会把代理 key 误当作 JWT 拒绝。
- 代理路由、代理 key 的启停是后端强制检查，不只是前端遮罩。
- 网站内 Chat 的用户配额、黑名单、页面服务开关不自动作用于对外代理；对外代理由自己的路由/key 状态控制。

### 三、数据库与密钥

在现有 `supabase/club-chat-schema.sql` 中增加幂等迁移，不删除或重建旧 Chat 数据：

1. **代理路由表**：随机路由 ID、内部名称、上游 Base URL、Secret 引用名、启用状态、配置版本号、创建/修改人及时间。
2. **代理 key 表**：路由 ID、key 标签、SHA-256 摘要、供识别的短前缀/尾号、启用/撤销状态、创建人及时间。

两表启用 RLS，普通匿名/登录用户不能直接访问；只允许 service role 及受控管理逻辑使用。

代理 key 由后端使用安全随机数生成（至少 256 位随机熵），只在生成成功时返回明文一次。数据库不存明文；忘记后只能签发新 key、撤销旧 key。生成响应使用 `Cache-Control: no-store`，key 不放 URL、不写日志、不写 localStorage/IndexedDB。上游 key 始终只从 Secrets 读取。

每个路由可签发多把 key，方便你分别发给不同社员并单独撤销。第一版不加入按 key 计费、token 套餐或售卖流程。

### 四、ChatAI 管理界面

新增“对外 Responses API 代理”区域，仅超管可见、可操作：
- 创建/编辑路由：名称、上游 Base URL、Secret 引用名、启用状态。
- 展示并复制自动生成的代理 Base URL，不在对外 URL 中出现上游域名。
- 路由列表可启用/禁用，使用版本检查避免覆盖其他管理员配置。
- 按路由生成代理 key，填写识别标签，支持复制一次性明文、查看已有 key 的掩码及启用/禁用/撤销。
- 生成后提供无真实 key 的 curl/Python 配置示例，不自动发起供应商调用。
- 中英文、亮暗主题、错误提示、账号切换清空敏感数据沿用现有约定。

不在网页管理 Supabase Secrets；文档说明如何先在 Supabase 后台设置 `CHAT_KEY_*`。保存或启用路由时检查引用的 Secret 是否存在，但不通过付费调用验证 key。

### 五、转发行为与安全边界

1. 每次请求验证路由和 key 状态及所属关系，禁用后阻止新请求；已建立的流不承诺即时强杀。
2. 只接受固定路由的 `/v1/responses`，拒绝其他路径、方法、路径逃逸和任意目标 URL，不能成为开放代理。
3. 上游只允许公网 HTTPS，保存和调用时检查域名/DNS/地址，禁止内网、loopback、凭据、query、fragment 和重定向；禁止代理回环。
4. 客户端只传本站代理 key。函数替换为上游 `Authorization: Bearer <Secret>`，绝不把代理 key、Supabase 凭证、Cookie 或客户端任意认证头上送。
5. 不重写 `model`、`input`、`stream` 等 Responses 请求字段，不强制 SSE，不执行网站 Chat 的上下文裁剪或额度预扣。限制 JSON 请求体为 12 MiB，禁止压缩请求以免大小限制被绕过。
6. 成功 JSON/SSE 响应按流转发，不解析或修改模型内容，不积攒整条回复；客户端取消时中止上游，不自动重试以避免重复计费。
7. 不转发上游 `Server`、`Location`、Cookie、内部诊断等可能泄露信息或不安全的响应头；不透出上游 URL、异常堆栈、认证信息。
8. **错误响应取舍**：保留上游 HTTP 错误状态（如 401/429），但非成功响应正文改为本站统一 OpenAI 风格错误，避免供应商 HTML/错误文本直接暴露上游；因此不是所有错误正文都逐字透传。已经进入成功 SSE 的内容不做全流脱敏。
9. 公网 API CORS 与管理端独立：支持非浏览器客户端及携带 Bearer key 的浏览器请求，不启用 Cookie 凭证；CORS 不是权限控制。
10. 每次请求都查后端状态；基础并发保护与可配置请求时限用于保护 Supabase 资源，不宣称是精确计费或完整商业网关。运行时上限按实际 Supabase 套餐文档核实，不能承诺无限时长。超时/平台终止可能留下部分回复，也可能产生费用。

**诚实边界**：此方案能隐藏连接用的上游地址及真实 key，但模型名称、回复内容、SSE 错误或行为特征仍可能透露供应商；不能保证上游身份完全不可识别。还需你自行确认上游服务允许转售及代理使用。

### 六、测试

新增独立代理处理器无网络测试，并扩展管理端测试/mock：
- 超管权限；普通用户不能管理或读取上游配置。
- key 生成只显示一次、数据库仅存摘要、跨路由/未知/撤销/禁用 key 拒绝。
- 路由启停在后端生效，拒绝时不调用上游。
- JSON 与碎片 SSE 原字节转发，任意合法 Responses 字段保留，非流式响应可用。
- 上游 key 替换正确、客户端 key/内部头不泄露，错误正文脱敏且状态保留。
- SSRF、DNS、重定向、路径逃逸、请求过大、错误方法、取消和超时。
- 管理端账号隔离、版本冲突、中英文、复制/一次性 key 清理。
- 旧 Chat 的 core、admin、42 项 handler 回归不退化。
- pglast 解析 SQL 和 PL/pgSQL；真实数据库测试仅使用可用的本地 PostgreSQL，环境缺失则明确标记未运行，不操作线上数据库。

### 七、交付与部署

更新代码、mock、测试和部署文档，提供管理操作步骤及客户端接入示例。

上线顺序：执行更新后的 Chat SQL → 设置上游 Secrets → 部署 `chat` 管理函数和新 `chat-api-proxy` 函数 → 发布静态管理页 → 由超管创建路由并签发 key。

本次实施仅在本地完成：**不执行线上 SQL、不部署、不调用真实付费供应商、不提交或推送**。任何上线与真实调用另行授权。