-- 《行于无垠》数值扩容迁移
-- PostgreSQL 的 bigint 等价于 C/C++ 的 long long（有符号 64 位整数）。
-- 请在已经部署平台游戏 SQL 的 Supabase SQL Editor 中完整执行一次。
-- 该迁移会保留现有数据，并自动重建 public.platformer_* RPC，避免
-- integer 与 bigint 同名重载导致 PostgREST RPC 调用歧义。

begin;

-- leaderboard 视图依赖 progress.best_score；先解除依赖，字段转换后再重建。
-- 不使用 CASCADE，避免误删用户项目中的其他对象。
drop view if exists public.platformer_leaderboard;

-- 1. 所有平台游戏表中的 32 位整数列改为 64 位整数列。
do $$
declare
  item record;
begin
  for item in
    select n.nspname as schema_name, c.relname as table_name, a.attname as column_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname like 'platformer_%'
      and a.attnum > 0
      and not a.attisdropped
      and a.atttypid = 'int4'::regtype
  loop
    execute format(
      'alter table %I.%I alter column %I type bigint using %I::bigint',
      item.schema_name, item.table_name, item.column_name, item.column_name
    );
  end loop;
end $$;

-- 恢复标准排行榜视图（字段类型已统一为 bigint）。
create view public.platformer_leaderboard as
select u.username, coalesce(sum(p.best_score), 0)::bigint as total_score
from public.platformer_users u
left join public.platformer_progress p on p.username = u.username
group by u.username;
grant select on public.platformer_leaderboard to anon, authenticated;

-- 2. 旧版 RPC 的参数/返回值仍可能是 integer。读取数据库中真实的函数定义，
--    将其完整转换为 bigint 后重建。函数体中的 integer 局部变量也同步升级。
do $$
declare
  item record;
  converted_definition text;
  converted_arguments text;
  target_oid oid;
begin
  for item in
    select p.oid,
           p.proname,
           -- pg_get_function_identity_arguments 在部分旧版本中会包含
           -- 参数名；regprocedure / DROP FUNCTION 需要纯类型列表。
           coalesce(
             (
               select string_agg(format_type(t.oid, null), ', ' order by u.ordinality)
               from unnest(p.proargtypes) with ordinality as u(type_oid, ordinality)
               join pg_type t on t.oid = u.type_oid
             ),
             ''
           ) as identity_arguments,
           pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname like 'platformer_%'
      and pg_get_functiondef(p.oid) ~* '\minteger\M'
  loop
    converted_definition := regexp_replace(item.definition, '\minteger\M', 'bigint', 'gi');
    converted_definition := replace(converted_definition, '2147483647', '9223372036854775807');
    converted_arguments := regexp_replace(item.identity_arguments, '\minteger\M', 'bigint', 'gi');

    -- bigint 版本已存在时，只删除旧 integer 重载，保留现有实现，
    -- 避免 CREATE OR REPLACE 用旧迁移逻辑覆盖新版本函数。
    target_oid := to_regprocedure(format('public.%I(%s)', item.proname, converted_arguments));
    execute format('drop function public.%I(%s)', item.proname, item.identity_arguments);
    if target_oid is null or target_oid = item.oid then
      execute converted_definition;
      execute format('grant execute on function public.%I(%s) to anon, authenticated', item.proname, converted_arguments);
    end if;
  end loop;
end $$;

-- 3. 上面的按表扫描已经覆盖所有现存 platformer_* 表；已经是 bigint
-- 的列会自动跳过，因此脚本可重复执行，也不依赖某一版表结构必须存在。

commit;

-- 前端和后续数据库迁移请使用 supabase/platformer-schema.sql、
-- platformer-service-control-migration.sql、platformer-admin-migration.sql、
-- platformer-pk-migration.sql 的 bigint 版本。
