-- 弹药强化旧版迁移（现行上限为 100 级；建议优先执行 ammo-level-100-migration.sql）
alter table public.platformer_users add column if not exists ammo_upgrade bigint not null default 0;

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

drop function if exists public.platformer_save_profile(text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint);
create or replace function public.platformer_save_profile(
  p_username text,p_token text,p_coins bigint,p_hp_upgrade bigint,p_atk_upgrade bigint,
  p_shot_upgrade bigint,p_agility_upgrade bigint,p_melee_upgrade bigint,p_ammo_upgrade bigint,p_unlocked bigint
)
returns boolean
language plpgsql security definer set search_path=public,extensions
as $$
begin
  update public.platformer_users
  set coins=greatest(0,coalesce(p_coins,0)),hp_upgrade=greatest(0,coalesce(p_hp_upgrade,0)),
      atk_upgrade=greatest(0,coalesce(p_atk_upgrade,0)),shot_upgrade=least(125,greatest(0,coalesce(p_shot_upgrade,0))),
      agility_upgrade=least(150,greatest(0,coalesce(p_agility_upgrade,0))),melee_upgrade=least(150,greatest(0,coalesce(p_melee_upgrade,0))),
      ammo_upgrade=least(100,greatest(0,coalesce(p_ammo_upgrade,0))),unlocked=greatest(unlocked,1,coalesce(p_unlocked,1)),updated_at=now()
  where username=p_username and session_token=p_token;
  return found;
end;
$$;
grant execute on function public.platformer_save_profile(text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint) to anon,authenticated;

drop function if exists public.platformer_register(text,text);
create or replace function public.platformer_register(p_username text,p_password text)
returns table(username text,session_token text,coins bigint,hp_upgrade bigint,atk_upgrade bigint,shot_upgrade bigint,agility_upgrade bigint,melee_upgrade bigint,ammo_upgrade bigint,unlocked bigint)
language plpgsql security definer set search_path=public,extensions
as $$ declare t text; begin
  if p_username is null or char_length(p_username) not between 3 and 64 or p_username !~ '^[A-Za-z0-9_一-龥]{3,64}$' then raise exception '用户名需为 3-64 位中文、英文、数字或下划线，不能包含空格和其他符号'; end if;
  if p_password is null or length(p_password)<6 then raise exception '密码至少需要 6 位'; end if;
  if exists(select 1 from public.platformer_users where username=p_username) then raise exception '用户名已存在'; end if;
  t=encode(gen_random_bytes(24),'hex'); insert into public.platformer_users(username,userpassword,session_token) values(p_username,crypt(p_password,gen_salt('bf')),t);
  return query select u.username,u.session_token,u.coins,u.hp_upgrade,u.atk_upgrade,u.shot_upgrade,u.agility_upgrade,u.melee_upgrade,u.ammo_upgrade,greatest(u.unlocked,1) from public.platformer_users u where u.username=p_username;
end $$;

drop function if exists public.platformer_login(text,text);
create or replace function public.platformer_login(p_username text,p_password text)
returns table(username text,session_token text,coins bigint,hp_upgrade bigint,atk_upgrade bigint,shot_upgrade bigint,agility_upgrade bigint,melee_upgrade bigint,ammo_upgrade bigint,unlocked bigint)
language plpgsql security definer set search_path=public,extensions
as $$ begin
  update public.platformer_users set session_token=encode(gen_random_bytes(24),'hex'),updated_at=now() where username=p_username and userpassword=crypt(p_password,userpassword);
  if not found then return; end if;
  return query select u.username,u.session_token,u.coins,u.hp_upgrade,u.atk_upgrade,u.shot_upgrade,u.agility_upgrade,u.melee_upgrade,u.ammo_upgrade,greatest(u.unlocked,1) from public.platformer_users u where u.username=p_username;
end $$;

drop function if exists public.platformer_resume(text,text);
create or replace function public.platformer_resume(p_username text,p_token text)
returns table(username text,session_token text,coins bigint,hp_upgrade bigint,atk_upgrade bigint,shot_upgrade bigint,agility_upgrade bigint,melee_upgrade bigint,ammo_upgrade bigint,unlocked bigint)
language sql security definer set search_path=public,extensions
as $$ select u.username,u.session_token,u.coins,u.hp_upgrade,u.atk_upgrade,u.shot_upgrade,u.agility_upgrade,u.melee_upgrade,u.ammo_upgrade,greatest(u.unlocked,1) from public.platformer_users u where u.username=p_username and u.session_token=p_token $$;
grant execute on function public.platformer_register(text,text) to anon,authenticated;
grant execute on function public.platformer_login(text,text) to anon,authenticated;
grant execute on function public.platformer_resume(text,text) to anon,authenticated;
