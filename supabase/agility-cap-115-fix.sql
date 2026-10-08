-- 行于无垠：将身法等级上限固定为 150
-- 文件名沿用旧版本；新部署建议使用 agility-combat-cap-150-125-migration.sql。
-- 请在 Supabase SQL Editor 中单独执行本文件，不要与旧迁移文件拼接。

begin;

alter table public.platformer_users
  add column if not exists agility_upgrade bigint not null default 0;

-- 删除历史版本留下的、定义中包含 agility_upgrade 的所有 CHECK 约束。
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.platformer_users'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%agility_upgrade%'
  loop
    execute format(
      'alter table public.platformer_users drop constraint if exists %I',
      constraint_name
    );
  end loop;
end;
$$;

-- 仅此处给 agility_upgrade 赋值一次，避免 multiple assignments 错误。
update public.platformer_users
set agility_upgrade = least(150, greatest(0, coalesce(agility_upgrade, 0)));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.platformer_users'::regclass
      and conname = 'platformer_users_agility_upgrade_check'
  ) then
    alter table public.platformer_users
      add constraint platformer_users_agility_upgrade_check
      check (agility_upgrade between 0 and 150);
  end if;
end;
$$;

commit;
