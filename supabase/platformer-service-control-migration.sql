-- 《行于无垠》游戏服务总开关
-- 在已执行 platformer-schema.sql 和后续养成迁移的 Supabase 项目中执行一次。
-- 基础版本允许游戏独立账号 chm 操作服务状态；执行 platformer-admin-migration.sql 后，
-- 社团盘超级管理员也会自动获得同等权限，并覆盖下面的服务开关函数。
-- 请将本文件完整复制到 SQL Editor 后执行，不要继续使用旧版缓存内容。

create table if not exists public.platformer_service_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.platformer_service_settings(singleton, enabled)
values (true, true)
on conflict (singleton) do nothing;

create table if not exists public.platformer_event_claims (
  username text not null references public.platformer_users(username) on delete cascade,
  claim_key text not null,
  claimed_at timestamptz not null default now(),
  primary key (username, claim_key)
);
-- 战神 I 无等级上限；前端按 50/100 级里程碑计算当前等级的倍数成长。
alter table public.platformer_users add column if not exists battle_god_upgrade bigint not null default 0;
alter table public.platformer_users add column if not exists battle_god_ii_upgrade bigint not null default 0;
update public.platformer_users set battle_god_ii_upgrade = least(750, greatest(0, coalesce(battle_god_ii_upgrade, 0)));
update public.platformer_users set battle_god_upgrade = greatest(0, coalesce(battle_god_upgrade, 0));
alter table public.platformer_users drop constraint if exists platformer_users_battle_god_upgrade_check;
alter table public.platformer_users add constraint platformer_users_battle_god_upgrade_check check (battle_god_upgrade >= 0);
alter table public.platformer_users drop constraint if exists platformer_users_battle_god_ii_upgrade_check;
alter table public.platformer_users add constraint platformer_users_battle_god_ii_upgrade_check check (battle_god_ii_upgrade between 0 and 750);
alter table public.platformer_event_claims enable row level security;
revoke all on table public.platformer_event_claims from anon, authenticated;

alter table public.platformer_service_settings enable row level security;
revoke all on table public.platformer_service_settings from anon, authenticated;

create or replace function public.platformer_service_is_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select enabled from public.platformer_service_settings where singleton), true);
$$;

create or replace function public.platformer_service_status()
returns table(enabled boolean)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.enabled from public.platformer_service_settings s where s.singleton), true);
$$;

create or replace function public.platformer_claim_event_rewards(
  p_username text,
  p_token text,
  p_endless_best bigint,
  p_completed_levels bigint
)
returns table(reward bigint, endless_claimed bigint, level_claimed bigint)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  total_reward bigint := 0;
  wave bigint;
  milestone bigint;
  inserted bigint;
  best_wave bigint := greatest(0, least(10000, coalesce(p_endless_best, 0)));
  completed_levels bigint := greatest(0, least(100000, coalesce(p_completed_levels, 0)));
begin
  if not public.platformer_service_is_open() and p_username <> 'chm' then
    raise exception '服务器升级维护中，请稍后再试';
  end if;
  if not exists(select 1 from public.platformer_users u where u.username=p_username and u.session_token=p_token) then
    raise exception '登录会话已失效，请重新登录';
  end if;
  -- 关卡活动奖励以服务器中的已通关记录为准，不信任浏览器传入的数量。
  select count(*)::bigint into completed_levels
  from public.platformer_progress p
  where p.username = p_username and p.completed;
  if now() < timestamptz '2026-08-30 16:00:00+00' or now() >= timestamptz '2026-09-14 16:00:00+00' then
    return query select 0,0,0;
    return;
  end if;
  for wave in 1..best_wave loop
    insert into public.platformer_event_claims(username,claim_key) values(p_username,'endless:'||wave) on conflict do nothing;
    get diagnostics inserted = row_count;
    if inserted > 0 then total_reward := total_reward + 10000 * wave; end if;
  end loop;
  for milestone in 1..(completed_levels / 10) loop
    insert into public.platformer_event_claims(username,claim_key) values(p_username,'level10:'||milestone) on conflict do nothing;
    get diagnostics inserted = row_count;
    if inserted > 0 then total_reward := total_reward + 30000; end if;
  end loop;
  if total_reward > 0 then
    update public.platformer_users u set coins=coalesce(u.coins,0)+total_reward,updated_at=now() where u.username=p_username and u.session_token=p_token;
  end if;
  return query select total_reward,best_wave,completed_levels/10;
end;
$$;

create or replace function public.platformer_set_service_enabled(
  p_username text,
  p_token text,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_username <> 'chm' or not exists (
    select 1
    from public.platformer_users u
    where u.username = 'chm' and u.session_token = p_token
  ) then
    raise exception '只有 chm 账号可以管理游戏服务';
  end if;

  update public.platformer_service_settings
  set enabled = coalesce(p_enabled, false), updated_at = now(), updated_by = 'chm'
  where singleton;
  return found;
end;
$$;

-- 服务关闭后：禁止注册；普通账号禁止登录与自动续登。
-- chm 保留登录通道，避免关闭后无法重新开启服务。
create or replace function public.platformer_register(p_username text, p_password text)
returns table(username text, session_token text, coins bigint, hp_upgrade bigint, atk_upgrade bigint, shot_upgrade bigint, agility_upgrade bigint, melee_upgrade bigint, ammo_upgrade bigint, armor_upgrade bigint, combat_upgrade bigint, life_evo_upgrade bigint, attack_evo_upgrade bigint, armor_evo_upgrade bigint, unlocked bigint)
language plpgsql security definer set search_path = public, extensions
as $$
declare new_token text;
begin
  if not public.platformer_service_is_open() then
    raise exception '服务器升级维护中，请稍后再试';
  end if;
  if p_username is null or char_length(p_username) not between 3 and 64 or p_username !~ '^[A-Za-z0-9_一-龥]{3,64}$' then raise exception '用户名需为 3-64 位中文、英文、数字或下划线，不能包含空格和其他符号'; end if;
  if p_password is null or length(p_password) < 6 then raise exception '密码至少需要 6 位'; end if;
  if exists (select 1 from public.platformer_users u where u.username = p_username) then raise exception '用户名已存在'; end if;
  new_token := encode(gen_random_bytes(24), 'hex');
  insert into public.platformer_users(username, userpassword, session_token) values (p_username, crypt(p_password, gen_salt('bf')), new_token);
  return query select u.username,u.session_token,u.coins,u.hp_upgrade,u.atk_upgrade,u.shot_upgrade,u.agility_upgrade,u.melee_upgrade,u.ammo_upgrade,u.armor_upgrade,u.combat_upgrade,u.life_evo_upgrade,u.attack_evo_upgrade,u.armor_evo_upgrade,greatest(u.unlocked,coalesce((select max(p.level_id)+1 from public.platformer_progress p where p.username=u.username and p.completed),1)) from public.platformer_users u where u.username=p_username;
end;
$$;

create or replace function public.platformer_login(p_username text, p_password text)
returns table(username text, session_token text, coins bigint, hp_upgrade bigint, atk_upgrade bigint, shot_upgrade bigint, agility_upgrade bigint, melee_upgrade bigint, ammo_upgrade bigint, armor_upgrade bigint, combat_upgrade bigint, life_evo_upgrade bigint, attack_evo_upgrade bigint, armor_evo_upgrade bigint, unlocked bigint)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not public.platformer_service_is_open() and p_username <> 'chm' then raise exception '服务器升级维护中，请稍后再试'; end if;
  update public.platformer_users u set session_token=encode(gen_random_bytes(24),'hex'),updated_at=now() where u.username=p_username and u.userpassword=crypt(p_password,u.userpassword);
  if not found then return; end if;
  return query select u.username,u.session_token,u.coins,u.hp_upgrade,u.atk_upgrade,u.shot_upgrade,u.agility_upgrade,u.melee_upgrade,u.ammo_upgrade,u.armor_upgrade,u.combat_upgrade,u.life_evo_upgrade,u.attack_evo_upgrade,u.armor_evo_upgrade,greatest(u.unlocked,coalesce((select max(p.level_id)+1 from public.platformer_progress p where p.username=u.username and p.completed),1)) from public.platformer_users u where u.username=p_username;
end;
$$;

create or replace function public.platformer_resume(p_username text, p_token text)
returns table(username text, session_token text, coins bigint, hp_upgrade bigint, atk_upgrade bigint, shot_upgrade bigint, agility_upgrade bigint, melee_upgrade bigint, ammo_upgrade bigint, armor_upgrade bigint, combat_upgrade bigint, life_evo_upgrade bigint, attack_evo_upgrade bigint, armor_evo_upgrade bigint, unlocked bigint)
language sql security definer set search_path = public, extensions
as $$
  select u.username,u.session_token,u.coins,u.hp_upgrade,u.atk_upgrade,u.shot_upgrade,u.agility_upgrade,u.melee_upgrade,u.ammo_upgrade,u.armor_upgrade,u.combat_upgrade,u.life_evo_upgrade,u.attack_evo_upgrade,u.armor_evo_upgrade,greatest(u.unlocked,coalesce((select max(p.level_id)+1 from public.platformer_progress p where p.username=u.username and p.completed),1))
  from public.platformer_users u
  where u.username=p_username and u.session_token=p_token
    and (public.platformer_service_is_open() or u.username='chm');
$$;

-- 关闭期间同时拒绝普通玩家的存档与分数提交，防止旧页面绕过登录页继续写数据。
create or replace function public.platformer_save_profile(
  p_username text,p_token text,p_coins bigint,p_hp_upgrade bigint,p_atk_upgrade bigint,p_shot_upgrade bigint,p_agility_upgrade bigint,p_melee_upgrade bigint,p_ammo_upgrade bigint,p_armor_upgrade bigint,p_combat_upgrade bigint,p_life_evo_upgrade bigint,p_attack_evo_upgrade bigint,p_armor_evo_upgrade bigint,p_unlocked bigint
)
returns boolean language plpgsql security definer set search_path=public,extensions
as $$
begin
  if not public.platformer_service_is_open() and p_username <> 'chm' then return false; end if;
  update public.platformer_users u set coins=greatest(0,coalesce(p_coins,0)),hp_upgrade=greatest(0,coalesce(p_hp_upgrade,0)),atk_upgrade=greatest(0,coalesce(p_atk_upgrade,0)),shot_upgrade=least(125,greatest(0,coalesce(p_shot_upgrade,0))),agility_upgrade=least(150,greatest(0,coalesce(p_agility_upgrade,0))),melee_upgrade=least(150,greatest(0,coalesce(p_melee_upgrade,0))),ammo_upgrade=least(100,greatest(0,coalesce(p_ammo_upgrade,0))),armor_upgrade=least(100,greatest(0,coalesce(p_armor_upgrade,0))),combat_upgrade=least(125,greatest(0,coalesce(p_combat_upgrade,0))),life_evo_upgrade=greatest(0,coalesce(p_life_evo_upgrade,0)),attack_evo_upgrade=greatest(0,coalesce(p_attack_evo_upgrade,0)),armor_evo_upgrade=greatest(0,coalesce(p_armor_evo_upgrade,0)),unlocked=greatest(u.unlocked,1,coalesce(p_unlocked,1)),updated_at=now() where u.username=p_username and u.session_token=p_token;
  return found;
end;
$$;

create or replace function public.platformer_record_score(p_username text,p_token text,p_level_id bigint,p_score bigint)
returns table(best_score bigint,is_first_completion boolean)
language plpgsql security definer set search_path=public,extensions
as $$
declare saved_score bigint; was_completed boolean:=false;
begin
  if not public.platformer_service_is_open() and p_username <> 'chm' then return; end if;
  if not exists(select 1 from public.platformer_users u where u.username=p_username and u.session_token=p_token) then return; end if;
  select coalesce(p.completed,false) into was_completed from public.platformer_progress p where p.username=p_username and p.level_id=p_level_id;
  insert into public.platformer_progress as progress(username,level_id,best_score,completed)
  values(p_username,p_level_id,greatest(0,coalesce(p_score,0)),true)
  on conflict(username,level_id) do update
    set best_score=greatest(progress.best_score,excluded.best_score),
        completed=true,
        updated_at=now();
  select p.best_score into saved_score from public.platformer_progress p where p.username=p_username and p.level_id=p_level_id;
  update public.platformer_users u set unlocked=greatest(u.unlocked,p_level_id+1),updated_at=now() where u.username=p_username and u.session_token=p_token;
  return query select saved_score,not was_completed;
end;
$$;

-- 登录后修改本游戏账号密码。必须提供当前有效会话令牌和旧密码，
-- 修改成功后立即刷新令牌，使旧会话失效。
drop function if exists public.platformer_change_password(text,text,text,text);
create or replace function public.platformer_change_password(
  p_username text,
  p_token text,
  p_old_password text,
  p_new_password text
)
returns table(session_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare new_token text;
begin
  if p_username is null or p_token is null
     or not exists (
       select 1 from public.platformer_users u
       where u.username = p_username
         and u.session_token = p_token
         and u.userpassword = crypt(p_old_password, u.userpassword)
     ) then
    raise exception '当前密码不正确或登录会话已失效';
  end if;
  if p_new_password is null or length(p_new_password) < 6 then
    raise exception '新密码至少需要 6 位';
  end if;
  if p_new_password = p_old_password then
    raise exception '新密码不能与当前密码相同';
  end if;
  new_token := encode(gen_random_bytes(24), 'hex');
  update public.platformer_users as u
  set userpassword = crypt(p_new_password, gen_salt('bf')),
      session_token = new_token,
      updated_at = now()
  where u.username = p_username and u.session_token = p_token;
  if not found then
    raise exception '登录会话已失效，请重新登录';
  end if;
  return query select new_token;
end;
$$;

revoke execute on function public.platformer_service_is_open() from public, anon, authenticated;
revoke execute on function public.platformer_service_status() from public;
revoke execute on function public.platformer_set_service_enabled(text,text,boolean) from public;
grant execute on function public.platformer_service_status() to anon,authenticated;
revoke execute on function public.platformer_claim_event_rewards(text,text,bigint,bigint) from public;
grant execute on function public.platformer_claim_event_rewards(text,text,bigint,bigint) to anon,authenticated;
grant execute on function public.platformer_set_service_enabled(text,text,boolean) to anon,authenticated;
grant execute on function public.platformer_register(text,text) to anon,authenticated;
grant execute on function public.platformer_login(text,text) to anon,authenticated;
grant execute on function public.platformer_resume(text,text) to anon,authenticated;
grant execute on function public.platformer_save_profile(text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint) to anon,authenticated;
grant execute on function public.platformer_record_score(text,text,bigint,bigint) to anon,authenticated;
grant execute on function public.platformer_change_password(text,text,text,text) to anon,authenticated;

-- 战神等级独立读写，避免改变已有登录/存档 RPC 的参数签名。
drop function if exists public.platformer_get_battle_god(text, text);
drop function if exists public.platformer_save_battle_god(text, text, bigint);
drop function if exists public.platformer_get_battle_god_ii(text, text);
drop function if exists public.platformer_save_battle_god_ii(text, text, bigint);
create or replace function public.platformer_get_battle_god(p_username text, p_token text)
returns table(battle_god_upgrade bigint)
language sql security definer set search_path = public
as $$
  select u.battle_god_upgrade
  from public.platformer_users as u
  where u.username = p_username and u.session_token = p_token;
$$;

create or replace function public.platformer_save_battle_god(p_username text, p_token text, p_level bigint)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.platformer_service_is_open() and p_username <> 'chm' then return false; end if;
  update public.platformer_users as u
  set battle_god_upgrade = greatest(0, coalesce(p_level, 0)), updated_at = now()
  where u.username = p_username and u.session_token = p_token;
  return found;
end;
$$;

revoke execute on function public.platformer_get_battle_god(text, text) from public;
revoke execute on function public.platformer_save_battle_god(text, text, bigint) from public;
grant execute on function public.platformer_get_battle_god(text, text) to anon, authenticated;
grant execute on function public.platformer_save_battle_god(text, text, bigint) to anon, authenticated;

create or replace function public.platformer_get_battle_god_ii(p_username text, p_token text)
returns table(battle_god_ii_upgrade bigint)
language sql security definer set search_path = public
as $$
  select u.battle_god_ii_upgrade from public.platformer_users as u
  where u.username = p_username and u.session_token = p_token;
$$;

create or replace function public.platformer_save_battle_god_ii(p_username text, p_token text, p_level bigint)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.platformer_service_is_open() and p_username <> 'chm' then return false; end if;
  update public.platformer_users as u
  set battle_god_ii_upgrade = least(750, greatest(0, coalesce(p_level, 0))), updated_at = now()
  where u.username = p_username and u.session_token = p_token;
  return found;
end;
$$;

revoke execute on function public.platformer_get_battle_god_ii(text, text) from public;
revoke execute on function public.platformer_save_battle_god_ii(text, text, bigint) from public;
grant execute on function public.platformer_get_battle_god_ii(text, text) to anon, authenticated;
grant execute on function public.platformer_save_battle_god_ii(text, text, bigint) to anon, authenticated;
