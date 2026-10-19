# 社团 AI 助手本地验证与交付记录

> 本文保留首次交付时的验证记录。后续知识全量核对、小Bru预设和管理页自动加载的最新结果见 [2026-10-19 知识校准记录](knowledge-refresh.md)：新版资料正文 10,575 字节，管理页回归 179 次请求；助手数据现已自动加载。

验证日期：2026-10-19。此次完成代码与本地验证，未部署 Supabase、执行线上 SQL、读取真实供应商密钥、调用付费上游、在线导入或发布资料，也未 commit/push。

## 实现范围

- 全站公共壳层懒加载圆形入口；Chat、平台游戏和根目录四个游戏页面补充轻量入口。助手自身与嵌套 iframe 不再挂载入口。
- 桌面浮窗、放大/还原、移动全屏、停止、收起保留实例；跳页发送取消并尽力保存已有记录。
- 复用 Chat 控制器、附件和流解析能力，包括会话、编辑重发、重试、导出、思考内容折叠、自动/手动摘要。助手使用独立 `club-ai-assistant` IndexedDB，并按账号隔离。
- 仅绑定成员可调用；模型由服务端发布快照固定，每轮复核模型、供应商和全员可见性。回答与压缩共用普通 Chat 的黑名单、额度、并发租约及结算流程。
- 超管维护配置、草稿、归档恢复、JSON/Markdown/文本导入、纯文本预览、不可变发布与回滚；所有变更共用 `config.version` 乐观锁。
- 数据库采用配置、文档和发布快照三张表，发布快照保存资料内容，服务端按需切块检索；未单独创建 chunks 表。
- 来源卡片只展示正文实际引用且通过校验的编号，包含标题、分类、摘录、当轮发布 UUID 和受控站内链接。历史来源随本地回答保留，不重新套用现行版本。
- 14 篇中文种子资料共 6,122 UTF-8 正文字节，默认待审核、未发布。资料边界和具体出处见 [来源清单](../assistant/source-manifest.json)。

## 自动化验证

以下命令均在本地通过。测试中的认证、数据库调用和模型响应采用受控模拟；后端集成测试没有网络权限。

| 验证 | 结果与范围 |
| --- | --- |
| `node tools/test-assistant-launcher.mjs` | 懒加载、项目子目录路径、窗口/origin 校验、非法导航、收起保留、pagehide、file/null 消息、手机 inert、嵌套排除、40 个站点页面入口检查（public 页面、首页与根目录四个游戏） |
| `node tools/test-chat-core.mjs` | SSE、上下文、账号隔离、取消保存、编辑重发、重试、自动压缩、三协议和助手专属契约、独立存储、摘要只发送一次、来源/发布版本、模型名称、语言刷新、父子同步、压缩 suspend |
| `node tools/test-chat-thinking.mjs` | 三协议实际返回的思考字段、分片、取消/中断、保守标签识别及续写隔离 |
| `node tools/test-chat-admin.mjs` | 139 次模拟请求；精确动作与 payload、版本递进、模型资格、导入边界、安全预览、发布回滚、409 保留草稿并禁写、双语与迟到响应隔离、种子出处校验 |
| `node docs/assistant-validation/fixtures/self-test.mjs` | 本地 HTTP/SDK/CSP 重写、生产 `/public/*` 和根首页路径、catalog、回答/思考/摘要 SSE、来源头、取消/租约、401/403/503、管理动作、CAS、原子导入、发布回滚、模型不可用、总闸 |
| `deno run --allow-env tools/test-chat-backend.ts` | 116 项真实 handler 模拟集成测试；含助手准入、客户端覆盖拒绝、不可信摘要、检索、多行/追问、附件排除、来源边界、共享额度/租约、取消与动态超管；未授予网络权限 |
| `node tools/test-chat-assistant-sql.mjs <PGlite module>` | 本地 PostgreSQL 执行：重复安装、动态超管、CAS、导入原子性、不可变触发器、发布/回滚、草稿隔离、字段边界、service-only ACL 和共享额度准入 |
| `python tools/test-chat-quota-sql.py --syntax-only` | pglast 解析 141 条 Chat SQL 语句、27 个 PL/pgSQL 函数 |
| `node tools/check-gomoku-sql-syntax.mjs` | 仓库要求的五子棋主 SQL 真实解析通过；此检查不替代 Chat SQL 解析 |
| `node tools/build-chat-dashboard-bundles.mjs --check` | 两份 Dashboard TypeScript 与完整 SQL 副本均与源文件一致 |
| `deno check docs/chat-deployment/chat-dashboard-index.ts docs/chat-deployment/chat-api-proxy-dashboard-index.ts` | 两份可粘贴单文件均通过类型检查；已修复只有内联后才出现的私有名称冲突 |
| `node tools/build-chat-file-bundle.mjs` | 已重建共享 file 包，约 100.7 KB，脚本语法检查通过 |
| `git diff --check` | 通过；Windows LF/CRLF 提示不属于 whitespace 错误 |

本地 PGlite 模块来自临时安装目录，运行方式示例：

```bash
node tools/test-chat-assistant-sql.mjs C:/Users/ASUS/AppData/Local/Temp/zcode-chat-retention-pg/node_modules/@electric-sql/pglite/dist/index.js
```

PGlite 是本地单连接 PostgreSQL/WASM 执行验证，不能代替线上 Supabase 配置与多连接并发验证。CAS 与租约另有 handler 模拟覆盖。

按仓库要求执行过训练模型重建与语法检查：累计归档 83 局、V9Pro 44 局、V9/V9Thinker 各 22 局、V10 83 局、Champion 166 局、Flash 102 局，历史期次仍保留；此次重建未产生训练模型文件差异。未改变引擎、棋力参数或训练数据。

## 浏览器实际验证

使用 ZCode 内置浏览器，访问仅监听回环地址的离线 fixture。页面注入明显的 MOCK ONLY 横幅，SDK、认证、资料与 SSE 均为本地模拟，不代表线上问答质量。

已实际观察：

1. 从公共壳层打开懒加载浮窗，生产入口 `/public/assistant.html?embed=1` 加载完成。
2. 生成前显示配置的 `MOCK 多模态` 展示名，没有成员模型选择器。
3. 完整 SSE 回答显示两个真实引用来源、发布 UUID；测试 HTML 片段按文本显示。
4. 实际点击出处卡片后，宿主页跳转到 `/public/guide.html`；新页面打开助手后恢复同一独立对话与来源。
5. 桌面暗色浮窗、亮色独立工作区及中文/英文动态文案已检查；来源原文保持原语言。
6. 390×844 手机模式的模态面板尺寸为 390×844，`aria-modal=true`，宿主 header/main 为 inert；Tab 进入 iframe。收起后宿主恢复、焦点回到球，iframe 仍为同一个实例。收起 API 的浏览器检查与 VM 覆盖互相补充，不等于所有软键盘/辅助技术均已验收。
7. 生成中收起时 busy=true、iframe 数量保持 1；停止后保留部分回复并显示停止/可能计费说明。
8. 手动压缩完成，界面显示早期一轮已摘要化、本地原文仍保留；跨页重新打开后摘要恢复。
9. 发送后立即跳页，恢复的最后一轮显示“连接中断，回复不完整”，停止按钮禁用，没有自动续跑。
10. 未绑定账户只显示姓名绑定引导，没有发送入口。
11. 管理页“助手知识库”首次未读取时禁写；显式刷新后显示固定模型、草稿列表和当前发布版本。

部分内置浏览器高层 click 会报告被后代元素覆盖或超时；确认新页面状态后，采用截图定位的实际点击、DOM 点击或控件处理器调用完成行为检查。因此行为通过不意味着所有操作都经过高层指针命中测试。来源宿主页跳转使用了截图定位的实际点击。

## 未覆盖与上线边界

- 内置浏览器不支持真实文件选择上传，也不允许 `file://` 导航。附件数量、大小、能力与转换、file/null 消息及生成包由现有前后端自动化覆盖；没有声称真实浏览器文件选择或 file 页面端到端通过。
- 手机英文/最新版手机截图与管理区截图多次发生浏览器截图 surface timeout；手机尺寸/inert/焦点和管理区内容已做 DOM 验证，但不把这些截图项目标记为视觉通过。已有桌面暗/亮及早期手机侧栏截图仅作为对应状态观察，不证明完整视觉矩阵。
- 未登录、503、账号切换、409、完整导入发布回滚等有自动化覆盖，未将所有组合逐项做浏览器视觉验收。
- 三协议和 Claude 配置由 mock 验证；没有真实供应商兼容性、真实用量、取消时延或模型事实遵循率的线上结论。
- 固定规则和引用校验不能保证模型绝不编造；检索遗漏、资料不足、过时或冲突时应保守说明。真实启用前需由超管审核资料及来源时效。
- CORS 不是授权；DNS/URL 校验不等于完整阻止 DNS rebinding；成功 SSE 内容不保证全面脱敏。供应商身份也不能保证完全隐藏。
- 取消仅发出请求并尽力保存，不能保证上游立即停算/停费，也不能保证强制关闭前最后片段落盘。生成仍受平台与原有后端时限影响。
- 上线前核对供应商条款/转售许可；本助手未新增 tools/MCP/远程资源权限。今后开放此类能力须另行评估可访问数据与权限。

## 手动部署材料

完整顺序见 [Supabase 网页部署说明](../chat-deployment/README.md#社团-ai-助手更新)：

1. SQL Editor 全文执行 [完整 SQL 副本](../chat-deployment/club-chat-schema.sql)。
2. Edge Functions → chat → index.ts 全文替换为 [Chat 单文件](../chat-deployment/chat-dashboard-index.ts)，部署更新。
3. 按网站原有方式发布静态资源；Supabase 编辑器不会更新前端。
4. 超管配置全员可用模型，导入 [seed.json](../assistant/seed.json) 为草稿，并审核 [来源清单](../assistant/source-manifest.json)。
5. 发布不可变资料版本，再启用助手；绑定成员完成线上验收。

无需 PowerShell 或 Supabase CLI。已有最新版对外代理无需仅为助手重部署；保留生成的代理文件作为完整交付材料。密钥只能放在 Edge Secrets，管理页只保存 `CHAT_KEY_*` 引用。

## 离线复现

开发者可运行：

```bash
node tools/assistant-mock-server.mjs
```

访问 `http://localhost:4193/assistant-fixtures` 设置账户和流场景，`/launcher-host.html` 检查浮窗，`/public/assistant.html` 检查生产路径工作区，`/chat-admin.html` 检查管理页。服务只监听回环地址，状态在内存，退出后不保留模拟后台数据；浏览器本地对话仍按其存储规则保留。
