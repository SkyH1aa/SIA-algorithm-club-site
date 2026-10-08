-- 弹药强化等级上限从 45 提升到 100
-- 已执行旧版 platformer-schema.sql / armor-level-45-migration.sql 的项目执行一次。

alter table public.platformer_users
  add column if not exists armor_upgrade bigint not null default 0;

do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid='public.platformer_users'::regclass
      and contype='c'
      and pg_get_constraintdef(oid) ilike '%ammo_upgrade%'
  loop
    execute format('alter table public.platformer_users drop constraint %I', c);
  end loop;
end $$;

update public.platformer_users
set ammo_upgrade=least(100,greatest(0,coalesce(ammo_upgrade,0)));

alter table public.platformer_users
  add constraint platformer_users_ammo_upgrade_check check (ammo_upgrade between 0 and 100);

drop function if exists public.platformer_save_profile(text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint);
create or replace function public.platformer_save_profile(
  p_username text,p_token text,p_coins bigint,p_hp_upgrade bigint,p_atk_upgrade bigint,
  p_shot_upgrade bigint,p_agility_upgrade bigint,p_melee_upgrade bigint,p_ammo_upgrade bigint,p_armor_upgrade bigint,p_unlocked bigint
)
returns boolean language plpgsql security definer set search_path=public,extensions
as $$ begin
  update public.platformer_users
  set coins=greatest(0,coalesce(p_coins,0)),
      hp_upgrade=greatest(0,coalesce(p_hp_upgrade,0)),
      atk_upgrade=greatest(0,coalesce(p_atk_upgrade,0)),
      shot_upgrade=least(125,greatest(0,coalesce(p_shot_upgrade,0))),
      agility_upgrade=least(150,greatest(0,coalesce(p_agility_upgrade,0))),
      melee_upgrade=least(150,greatest(0,coalesce(p_melee_upgrade,0))),
      ammo_upgrade=least(100,greatest(0,coalesce(p_ammo_upgrade,0))),
      armor_upgrade=least(100,greatest(0,coalesce(p_armor_upgrade,0))),
      unlocked=greatest(unlocked,1,coalesce(p_unlocked,1)),updated_at=now()
  where username=p_username and session_token=p_token;
  return found;
end $$;

revoke execute on function public.platformer_save_profile(text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint) from public;
grant execute on function public.platformer_save_profile(text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint) to anon,authenticated;
