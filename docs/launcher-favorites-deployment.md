# 模块启动器收藏 / 最近使用：部署清单

账号级收藏与最近使用由一张新表 + club-drive 的 5 个动作组成。**不改任何既有表结构**，但三项都要部署，缺一项前端会退回本机缓存（不报错、不丢数据）。

## 1. Supabase 执行 SQL

在 Supabase SQL Editor 执行：

```
supabase/club-launcher-schema.sql
```

脚本幂等，可重复执行。创建：

- 表 `public.club_launcher_items`（主键 `user_id + kind + item_key`，RLS 全拒，仅 `service_role` 授权）
- `get_club_launcher_items` / `set_club_launcher_favorite` / `push_club_launcher_recent` / `clear_club_launcher_recents` / `merge_club_launcher_items`
- 容量裁剪函数 `trim_club_launcher_items`（收藏 24 / 最近使用 6，数据库侧兜底）

验证（在 SQL Editor）：

```sql
select proname from pg_proc
where proname like '%club_launcher%'
order by proname;
```

应返回 6 个函数。

## 2. 部署 Edge Function

```
supabase functions deploy club-drive
```

本次新增的 5 个动作：

| action | 说明 |
|---|---|
| `launcher_items_get` | 读取当前账号的收藏与最近使用 |
| `launcher_favorite_set` | 收藏 / 取消收藏（`itemKey`、`favorite`） |
| `launcher_recent_push` | 记录最近使用（`itemKey`） |
| `launcher_recents_clear` | 清空最近使用 |
| `launcher_items_merge` | 首次登录并入本机访客收藏（`favorites`、`recents`） |

五个动作都要求有效登录态，`user_id` 一律取自 token，**不接受请求体里的用户标识**。

## 3. 前端发布

`public/club-shell.js` 是共享层，所有 `club-shell.js` 页面都会生效。发布后：

- 未登录：仍可收藏/记录最近使用，数据只在本机。
- 首次登录：本机已有收藏会合并到账号，随后以服务端为准。
- 换设备/换浏览器登录：自动拉取该账号的收藏与最近使用。
- 退出登录：清除本机缓存，不影响账号里的数据。

## 4. 验收

```bash
node tools/test-club-launcher-favorites.mjs   # 表结构、权限、动作、前端同步契约
python -c "import pglast; pglast.parse_sql(open('supabase/club-launcher-schema.sql',encoding='utf-8').read())"
node tools/version-static-assets.mjs && node tools/test-asset-versions.mjs
node tools/check-ui-tokens.mjs
```

浏览器侧建议按顺序手测（登录后）：

1. 收藏两个模块 → 刷新 → 仍是两个，且置顶顺序一致。
2. 换一个浏览器/无痕窗口登录同一账号 → 收藏与最近使用应出现。
3. 退出登录 → 收藏区变空；重新登录 → 数据回来。
4. 未登录时先收藏一个 → 登录 → 该收藏应并入账号。

## 5. 回滚

前端回滚只需恢复 `public/club-shell.js`：账号动作调用消失后自动退回本地存储，数据库表与函数留着不影响其它功能。确认不再需要时再删表（本仓库约定不主动 drop 既有表）。
