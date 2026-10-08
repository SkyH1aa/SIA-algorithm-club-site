-- 已执行旧版 platformer-schema.sql 的项目执行此迁移。
-- 将身法等级上限固定为 150，并清理旧的 CHECK 约束。

alter table public.platformer_users
  add column if not exists agility_upgrade bigint not null default 0;

do $$
declare constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.platformer_users'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%agility_upgrade%'
  loop
    execute format('alter table public.platformer_users drop constraint %I', constraint_name);
  end loop;
end $$;

update public.platformer_users
set agility_upgrade = least(150, greatest(0, coalesce(agility_upgrade, 0)));

alter table public.platformer_users
  add constraint platformer_users_agility_upgrade_check
  check (agility_upgrade between 0 and 150);
