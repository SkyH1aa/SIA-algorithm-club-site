-- 仅当已经执行过旧版 platformer-schema.sql、但近战仍被限制在 49 级时执行。
-- 该迁移会清理旧数据库中所有绑定 melee_upgrade 的 CHECK 约束，并重建 0-150 级上限。

alter table public.platformer_users
  add column if not exists melee_upgrade bigint not null default 0;

do $$
declare constraint_name text;
begin
  -- 不依赖旧约束名称，直接按 CHECK 定义识别所有近战等级限制。
  for constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.platformer_users'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%melee_upgrade%'
  loop
    execute format('alter table public.platformer_users drop constraint %I', constraint_name);
  end loop;
end $$;

update public.platformer_users
set melee_upgrade = least(150, greatest(0, coalesce(melee_upgrade, 0)));

alter table public.platformer_users
  add constraint platformer_users_melee_upgrade_check
  check (melee_upgrade between 0 and 150);
