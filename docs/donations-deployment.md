# 社团捐赠名单部署

捐赠名单是一个独立附属页面，仅超级管理员可新增、编辑、删除；已登录社员只读查看。入口有三处：社团功能页卡片、跳转模块、管理总览（超管专属）。

## 1. 执行数据库脚本

在 Supabase Dashboard → SQL Editor 新建查询，全文粘贴并运行：

```
supabase/club-donations-schema.sql
```

脚本是幂等的，可重复执行。它会创建：

- 表 `club_donations`：`donor_name`、`donated_on`（date）、`amount`（numeric(12,2)）、`created_by/updated_by`、`created_at/updated_at`。
- 单行配置表 `club_donation_settings`：`payment_qr_url`（图床直链，默认空串）。脚本会幂等插入 `id = true` 这一行，并复用同一个更新时间触发器。
- 索引 `amount desc, donated_on desc, created_at desc`，保证默认按金额从大到小。
- RLS 全关，`public/anon/authenticated` 全部撤权，只授予 `service_role`。
- 更新时间触发器。

不使用 `club_staff_permissions` 的新权限位：捐赠的写操作只认超级管理员。

## 2. 部署 Edge Function

将 [club-drive-dashboard-index.ts](club-drive-dashboard-index.ts) 全文替换到 Edge Functions → `club-drive` → `index.ts`，点击部署更新。

本次新增四个动作：

| 动作 | 权限 | 说明 |
| --- | --- | --- |
| `donations_list` | 已登录 | 只读列表，未登录返回 401 |
| `admin_donations_list` | 超管 | 管理列表 |
| `admin_donations_save` | 超管 | 新增（无 `id`）或修改（带 `id`） |
| `admin_donations_delete` | 超管 | 按 UUID 删除 |
| `admin_donation_settings_save` | 超管 | 保存或清空收款码 URL（空串表示不展示） |

服务端校验：姓名 1–60 字符；日期必须是合法的 `YYYY-MM-DD`（拒绝 2026-02-30 这类）；金额大于 0、不超过 9999999999.99、最多两位小数，并统一格式化为两位小数字符串写入数据库。

收款码只接受 `http:`/`https:` 绝对地址，拒绝 `javascript:`、`data:`、`ftp:`、带账号密码的 URL 以及超长地址（>800 字符）。`donations_list` 与 `admin_donations_list` 会同时返回 `settings.payment_qr_url`，页面据此展示；空串时显示“暂无收款码”，图片加载失败时显示“收款码暂时无法显示”。`chat`、`chat-api-proxy`、`club-chat-schema.sql` 本次不需要重新部署或执行。

## 3. 发布静态文件

按网站原有方式发布：

- 新增 `public/donations.html`
- 修改 `public/club-features.html`（卡片入口）
- 修改 `public/club-shell.js`（跳转模块 + 管理模块横栏）
- 修改 `public/admin-hub.html`（管理总览超管专属入口）
- 修改 `public/i18n-dict.js`（中英文案）

## 4. 上线后验证

1. 未登录打开 `donations.html`：显示“请先登录”，不发起任何数据请求，收款码也不展示。
2. 普通社员登录：能看到收款码（若已配置）与名单，按金额从大到小，看不到任何管理表单。
3. 未配置收款码时，名单上方显示“暂无收款码”。
4. 超级管理员登录：出现收款码配置表单与“新增 / 编辑捐赠记录”表单；保存一个图床直链后收款码立即显示，点“清除收款码”后回到“暂无收款码”。
5. 非超管账号直接构造 `admin_donations_save` 或 `admin_donation_settings_save` 请求：应返回 403，且不产生数据库写入。
6. 检查首页跳转模块、社团功能页、管理总览三处入口均可达。

## 本地已验证

- `npm exec --yes deno -- run --allow-read tools/test-club-donations.ts`：权限、校验、排序、错误映射、收款码 URL 校验与旧库 upsert。
- `node tools/test-club-donations-page.mjs`：页面接线、三处入口、i18n 中英覆盖、转义与主题安全、SQL 契约。
- `node tools/test-club-donations-ui.mjs`：内联脚本在桩 DOM 中的登录门禁、只读视图、超管编辑、客户端校验与收款码空态/配置/清除。
- 无头 Chrome 实际渲染：暗色/亮色两种主题、社员与超管两种视图均已截图确认。

本地测试使用 mock，不连接真实 Supabase 或数据库；上线后仍需按第 4 节用真实账号验收。
