-- 行于无垠：生命/攻击/装甲进化体系
-- 适用于已经部署旧版 platformer-schema.sql 的数据库。请单独执行。
begin;

alter table public.platformer_users
  add column if not exists attack_evo_upgrade bigint not null default 0,
  add column if not exists armor_evo_upgrade bigint not null default 0;

do $$
declare c text;
begin
  for c in select conname from pg_constraint
    where conrelid='public.platformer_users'::regclass and contype='c'
      and (pg_get_constraintdef(oid) ilike '%attack_evo_upgrade%'
        or pg_get_constraintdef(oid) ilike '%armor_evo_upgrade%')
  loop execute format('alter table public.platformer_users drop constraint if exists %I',c); end loop;
end $$;

update public.platformer_users
set attack_evo_upgrade=greatest(0,coalesce(attack_evo_upgrade,0)),
    armor_evo_upgrade=greatest(0,coalesce(armor_evo_upgrade,0));
alter table public.platformer_users
  add constraint platformer_users_attack_evo_upgrade_check check (attack_evo_upgrade>=0),
  add constraint platformer_users_armor_evo_upgrade_check check (armor_evo_upgrade>=0);

drop function if exists public.platformer_register(text,text);
drop function if exists public.platformer_login(text,text);
drop function if exists public.platformer_resume(text,text);

create or replace function public.platformer_register(p_username text,p_password text)
returns table(username text,session_token text,coins bigint,hp_upgrade bigint,atk_upgrade bigint,shot_upgrade bigint,agility_upgrade bigint,melee_upgrade bigint,ammo_upgrade bigint,armor_upgrade bigint,combat_upgrade bigint,life_evo_upgrade bigint,attack_evo_upgrade bigint,armor_evo_upgrade bigint,unlocked bigint)
language plpgsql security definer set search_path=public,extensions as $$
declare new_token text;
begin
  if p_username is null or char_length(p_username) not between 3 and 64 or p_username !~ '^[A-Za-z0-9_一-龥]{3,64}$' then raise exception '用户名需为 3-64 位中文、英文、数字或下划线，不能包含空格和其他符号'; end if;
  if p_password is null or length(p_password)<6 then raise exception '密码至少需要 6 位'; end if;
  if exists(select 1 from public.platformer_users u where u.username=p_username) then raise exception '用户名已存在'; end if;
  new_token:=encode(gen_random_bytes(24),'hex');
  insert into public.platformer_users(username,userpassword,session_token) values(p_username,crypt(p_password,gen_salt('bf')),new_token);
  return query select u.username,u.session_token,u.coins,u.hp_upgrade,u.atk_upgrade,u.shot_upgrade,u.agility_upgrade,u.melee_upgrade,u.ammo_upgrade,u.armor_upgrade,u.combat_upgrade,u.life_evo_upgrade,u.attack_evo_upgrade,u.armor_evo_upgrade,greatest(u.unlocked,coalesce((select max(p.level_id)+1 from public.platformer_progress p where p.username=u.username and p.completed),1)) from public.platformer_users u where u.username=p_username;
end $$;

create or replace function public.platformer_login(p_username text,p_password text)
returns table(username text,session_token text,coins bigint,hp_upgrade bigint,atk_upgrade bigint,shot_upgrade bigint,agility_upgrade bigint,melee_upgrade bigint,ammo_upgrade bigint,armor_upgrade bigint,combat_upgrade bigint,life_evo_upgrade bigint,attack_evo_upgrade bigint,armor_evo_upgrade bigint,unlocked bigint)
language plpgsql security definer set search_path=public,extensions as $$
begin
  update public.platformer_users u set session_token=encode(gen_random_bytes(24),'hex'),updated_at=now() where u.username=p_username and u.userpassword=crypt(p_password,u.userpassword);
  if not found then return; end if;
  return query select u.username,u.session_token,u.coins,u.hp_upgrade,u.atk_upgrade,u.shot_upgrade,u.agility_upgrade,u.melee_upgrade,u.ammo_upgrade,u.armor_upgrade,u.combat_upgrade,u.life_evo_upgrade,u.attack_evo_upgrade,u.armor_evo_upgrade,greatest(u.unlocked,coalesce((select max(p.level_id)+1 from public.platformer_progress p where p.username=u.username and p.completed),1)) from public.platformer_users u where u.username=p_username;
end $$;

create or replace function public.platformer_resume(p_username text,p_token text)
returns table(username text,session_token text,coins bigint,hp_upgrade bigint,atk_upgrade bigint,shot_upgrade bigint,agility_upgrade bigint,melee_upgrade bigint,ammo_upgrade bigint,armor_upgrade bigint,combat_upgrade bigint,life_evo_upgrade bigint,attack_evo_upgrade bigint,armor_evo_upgrade bigint,unlocked bigint)
language sql security definer set search_path=public,extensions as $$
select u.username,u.session_token,u.coins,u.hp_upgrade,u.atk_upgrade,u.shot_upgrade,u.agility_upgrade,u.melee_upgrade,u.ammo_upgrade,u.armor_upgrade,u.combat_upgrade,u.life_evo_upgrade,u.attack_evo_upgrade,u.armor_evo_upgrade,greatest(u.unlocked,coalesce((select max(p.level_id)+1 from public.platformer_progress p where p.username=u.username and p.completed),1)) from public.platformer_users u where u.username=p_username and u.session_token=p_token;
$$;

drop function if exists public.platformer_save_profile(text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint);
drop function if exists public.platformer_save_profile(text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint);
create or replace function public.platformer_save_profile(p_username text,p_token text,p_coins bigint,p_hp_upgrade bigint,p_atk_upgrade bigint,p_shot_upgrade bigint,p_agility_upgrade bigint,p_melee_upgrade bigint,p_ammo_upgrade bigint,p_armor_upgrade bigint,p_combat_upgrade bigint,p_life_evo_upgrade bigint,p_attack_evo_upgrade bigint,p_armor_evo_upgrade bigint,p_unlocked bigint)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
begin
  update public.platformer_users u set coins=greatest(0,coalesce(p_coins,0)),hp_upgrade=greatest(0,coalesce(p_hp_upgrade,0)),atk_upgrade=greatest(0,coalesce(p_atk_upgrade,0)),shot_upgrade=least(125,greatest(0,coalesce(p_shot_upgrade,0))),agility_upgrade=least(150,greatest(0,coalesce(p_agility_upgrade,0))),melee_upgrade=least(150,greatest(0,coalesce(p_melee_upgrade,0))),ammo_upgrade=least(100,greatest(0,coalesce(p_ammo_upgrade,0))),armor_upgrade=least(100,greatest(0,coalesce(p_armor_upgrade,0))),combat_upgrade=least(125,greatest(0,coalesce(p_combat_upgrade,0))),life_evo_upgrade=greatest(0,coalesce(p_life_evo_upgrade,0)),attack_evo_upgrade=greatest(0,coalesce(p_attack_evo_upgrade,0)),armor_evo_upgrade=greatest(0,coalesce(p_armor_evo_upgrade,0)),unlocked=greatest(u.unlocked,1,coalesce(p_unlocked,1)),updated_at=now() where u.username=p_username and u.session_token=p_token;
  return found;
end $$;

grant execute on function public.platformer_register(text,text) to anon,authenticated;
grant execute on function public.platformer_login(text,text) to anon,authenticated;
grant execute on function public.platformer_resume(text,text) to anon,authenticated;
grant execute on function public.platformer_save_profile(text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint) to anon,authenticated;
commit;
