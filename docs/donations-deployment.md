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

按网站原有方式发布本轮全部前端变更（这次不只影响捐赠页）：

- 新增 `public/donations.html`、`public/club-common.js`、`public/favicon.svg`
- 新增**仓库根目录**的 `404.html`（GitHub Pages 只识别仓库根的这一份，放在 `public/` 下不会生效）
- 新增 `public/vendor/supabase/supabase.min.js`（固定版本 UMD，约 108 KB）
- 新增 `public/asset-versions.json`（资源版本清单）
- 修改全部 `public/*.html`、根 `index.html` 与根游戏页（脚本引用、i18n defer、favicon、版本号）
- 修改 `public/club-ui.css`（打印样式）、`public/club-shell.js`、`public/admin-hub.html`、`public/i18n-dict.js`
- 修改 `public/service-gate.js`（捐赠页与 Satori 实验室的功能开关）

如果站点是整目录发布，直接覆盖 `public/` 即可；若逐文件发布，务必包含新增的 `vendor/supabase/`。

> 本轮把 Supabase JS 从 `cdn.jsdelivr.net` 改为本地 `public/vendor/supabase/supabase.min.js`。这是为了在 CDN 不可达时仍能登录。以后升级 SDK 需要手工替换该文件并重跑 `node tools/version-static-assets.mjs`。

## 4. 上线后验证

1. 未登录打开 `donations.html`：显示“请先登录”，不发起任何数据请求，收款码也不展示。
2. 普通社员登录：能看到收款码（若已配置）与名单，按金额从大到小，看不到任何管理表单。
3. 未配置收款码时，名单上方显示“暂无收款码”。
4. 超级管理员登录：出现收款码配置表单与“新增 / 编辑捐赠记录”表单；保存一个图床直链后收款码立即显示，点“清除收款码”后回到“暂无收款码”。
5. 非超管账号直接构造 `admin_donations_save` 或 `admin_donation_settings_save` 请求：应返回 403，且不产生数据库写入。
6. 检查首页跳转模块、社团功能页、管理总览三处入口均可达。

## 自定义 404 页

GitHub Pages 只把**仓库根目录**的 `404.html` 用于未知路径；`public/404.html` 不会被路由。因此：

- 文件必须放在仓库根：`404.html`（与 `index.html` 同级）。
- 页面用 `<base>` 动态指向站点根（项目页为 `/<repo>/`），所以从任意深路径返回首页都会落到
  `https://<user>.github.io/<repo>/index.html`，不会跳到账户根 `https://<user>.github.io/index.html`。
- 根 `404.html` 里的资源写 `public/...` 相对路径，不能用 `/public/...`。

`node tools/test-404-page.mjs` 会校验文件位置、base 推导与资源引用。

## 资源版本号

静态资源改为按内容哈希自动加 `?v=`：

```bash
node tools/version-static-assets.mjs          # 重写引用并生成 asset-versions.json
node tools/version-static-assets.mjs --check  # 只校验，CI/提交前使用
```

只要改过 `club-common.js`、`club-ui.css`、`i18n-dict.js` 等共享文件，就必须重跑一次，否则浏览器会继续使用旧缓存。`tools/test-asset-versions.mjs` 会校验清单与实际文件哈希一致。

## 本地已验证

- `npm exec --yes deno -- run --allow-read tools/test-club-donations.ts`：权限、校验、排序、错误映射、收款码 URL 校验与旧库 upsert。
- `node tools/test-club-donations-page.mjs`：页面接线、三处入口、i18n 中英覆盖、转义与主题安全、SQL 契约。
- `node tools/test-club-donations-ui.mjs`：内联脚本在桩 DOM 中的登录门禁、只读视图、超管编辑、客户端校验与收款码空态/配置/清除。
- `node tools/test-club-common.mjs`：共享确认框、撤销、列表三态、401 映射。
- `node tools/test-asset-versions.mjs` / `test-vendor-supabase.mjs`：资源版本与本地 SDK。
- 无头 Chrome 实际渲染（1440×1100 与 390×844）：暗色/亮色、社员与超管视图、搜索筛选、合计金额、CSV 按钮、删除确认框、撤销提示、手机卡片布局（无横向滚动）、404 页均截图确认。

> 说明：浏览器验收使用桩会话直接驱动页面渲染函数，未登录真实 Supabase；登录门禁与权限分支由 `test-club-donations-ui.mjs` 在 vm 中覆盖。

本地测试使用 mock，不连接真实 Supabase 或数据库；上线后仍需按第 4 节用真实账号验收。
