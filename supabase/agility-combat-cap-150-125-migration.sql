-- 行于无垠：身法上限 150、作战狂人上限 125
-- 适用于已经部署过旧版 platformer-schema.sql 的数据库。
-- 请单独执行本文件，不要与其它迁移文件拼接。

begin;

alter table public.platformer_users
  add column if not exists agility_upgrade bigint not null default 0,
  add column if not exists combat_upgrade bigint not null default 0;

do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.platformer_users'::regclass
      and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%agility_upgrade%'
        or pg_get_constraintdef(oid) ilike '%combat_upgrade%')
  loop
    execute format('alter table public.platformer_users drop constraint if exists %I', c);
  end loop;
end;
$$;

update public.platformer_users
set agility_upgrade = least(150, greatest(0, coalesce(agility_upgrade, 0))),
    combat_upgrade = least(125, greatest(0, coalesce(combat_upgrade, 0)));

alter table public.platformer_users
  add constraint platformer_users_agility_upgrade_check check (agility_upgrade between 0 and 150),
  add constraint platformer_users_combat_upgrade_check check (combat_upgrade between 0 and 125);

drop function if exists public.platformer_save_profile(text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint);
create or replace function public.platformer_save_profile(
  p_username text, p_token text, p_coins bigint, p_hp_upgrade bigint,
  p_atk_upgrade bigint, p_shot_upgrade bigint, p_agility_upgrade bigint,
  p_melee_upgrade bigint, p_ammo_upgrade bigint, p_armor_upgrade bigint,
  p_combat_upgrade bigint, p_life_evo_upgrade bigint, p_unlocked bigint
)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
begin
  update public.platformer_users as u
  set coins = greatest(0, coalesce(p_coins, 0)),
      hp_upgrade = greatest(0, coalesce(p_hp_upgrade, 0)),
      atk_upgrade = greatest(0, coalesce(p_atk_upgrade, 0)),
      shot_upgrade = least(125, greatest(0, coalesce(p_shot_upgrade, 0))),
      agility_upgrade = least(150, greatest(0, coalesce(p_agility_upgrade, 0))),
      melee_upgrade = least(150, greatest(0, coalesce(p_melee_upgrade, 0))),
      ammo_upgrade = least(100, greatest(0, coalesce(p_ammo_upgrade, 0))),
      armor_upgrade = least(100, greatest(0, coalesce(p_armor_upgrade, 0))),
      combat_upgrade = least(125, greatest(0, coalesce(p_combat_upgrade, 0))),
      life_evo_upgrade = greatest(0, coalesce(p_life_evo_upgrade, 0)),
      unlocked = greatest(u.unlocked, 1, coalesce(p_unlocked, 1)),
      updated_at = now()
  where u.username = p_username and u.session_token = p_token;
  return found;
end;
$$;

grant execute on function public.platformer_save_profile(text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint) to anon, authenticated;
commit;
