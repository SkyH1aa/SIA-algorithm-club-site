-- 独立于社团盘的横屏闯关游戏账号、进度与排行榜
-- 在 Supabase SQL Editor 中完整执行一次。
-- 请从第 1 行执行整个文件；不要只执行函数中的 RETURNS TABLE 行。
-- 文件中的字段名使用普通下划线（如 session_token），不要在下划线前添加转义符。

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.platformer_users (
  username text primary key,
  userpassword text not null,
  session_token text unique,
  coins bigint not null default 0 check (coins >= 0),
  hp_upgrade bigint not null default 0 check (hp_upgrade >= 0),
  atk_upgrade bigint not null default 0 check (atk_upgrade >= 0),
  shot_upgrade bigint not null default 0 check (shot_upgrade between 0 and 125),
  agility_upgrade bigint not null default 0 check (agility_upgrade between 0 and 150),
  melee_upgrade bigint not null default 0 check (melee_upgrade between 0 and 150),
  ammo_upgrade bigint not null default 0 check (ammo_upgrade between 0 and 100),
  armor_upgrade bigint not null default 0 check (armor_upgrade between 0 and 100),
  combat_upgrade bigint not null default 0 check (combat_upgrade between 0 and 125),
  life_evo_upgrade bigint not null default 0 check (life_evo_upgrade >= 0),
  attack_evo_upgrade bigint not null default 0 check (attack_evo_upgrade >= 0),
  armor_evo_upgrade bigint not null default 0 check (armor_evo_upgrade >= 0),
  -- 战神 I 无等级上限；前端按 50/100 级里程碑计算当前等级的倍数成长。
  battle_god_upgrade bigint not null default 0 check (battle_god_upgrade >= 0),
  battle_god_ii_upgrade bigint not null default 0 check (battle_god_ii_upgrade >= 0),
  unlocked bigint not null default 1 check (unlocked >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 用户名仅允许中文、英文、数字或下划线，长度为 3-64 个字符。
-- 使用 NOT VALID 兼容历史账号；新注册账号会立即受到约束。
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'platformer_users_username_format_check' and conrelid = 'public.platformer_users'::regclass) then
    alter table public.platformer_users add constraint platformer_users_username_format_check
      check (char_length(username) between 3 and 64 and username ~ '^[A-Za-z0-9_一-龥]{3,64}$') not valid;
  end if;
end $$;

-- 兼容更早只创建了基础账号字段的版本。
alter table public.platformer_users add column if not exists userpassword text;
alter table public.platformer_users add column if not exists session_token text;
alter table public.platformer_users add column if not exists coins bigint not null default 0;
alter table public.platformer_users add column if not exists hp_upgrade bigint not null default 0;
alter table public.platformer_users add column if not exists atk_upgrade bigint not null default 0;
alter table public.platformer_users add column if not exists shot_upgrade bigint not null default 0;
alter table public.platformer_users add column if not exists unlocked bigint not null default 1;
alter table public.platformer_users add column if not exists created_at timestamptz not null default now();
alter table public.platformer_users add column if not exists updated_at timestamptz not null default now();

create table if not exists public.platformer_progress (
  username text not null references public.platformer_users(username) on delete cascade,
  level_id bigint not null check (level_id > 0),
  best_score bigint not null default 0 check (best_score >= 0),
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (username, level_id)
);

-- 兼容之前已经执行过旧版本 SQL 的项目：同步射击 125 级、身法 150 级上限。
alter table public.platformer_users add column if not exists agility_upgrade bigint not null default 0;
alter table public.platformer_users add column if not exists melee_upgrade bigint not null default 0;
alter table public.platformer_users add column if not exists ammo_upgrade bigint not null default 0;
alter table public.platformer_users add column if not exists armor_upgrade bigint not null default 0;
alter table public.platformer_users add column if not exists combat_upgrade bigint not null default 0;
alter table public.platformer_users add column if not exists life_evo_upgrade bigint not null default 0;
alter table public.platformer_users add column if not exists attack_evo_upgrade bigint not null default 0;
alter table public.platformer_users add column if not exists armor_evo_upgrade bigint not null default 0;
alter table public.platformer_users add column if not exists battle_god_upgrade bigint not null default 0;
alter table public.platformer_users add column if not exists battle_god_ii_upgrade bigint not null default 0;
alter table public.platformer_users drop constraint if exists platformer_users_shot_upgrade_check;
alter table public.platformer_users drop constraint if exists platformer_users_agility_upgrade_check;
-- 旧版本可能把等级约束命名成自动生成的其他名称；按约束定义清理所有涉及
-- agility_upgrade / melee_upgrade 的旧 CHECK，避免升级后仍卡在旧上限。
do $$
declare constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.platformer_users'::regclass
      and c.contype = 'c'
      and (pg_get_constraintdef(c.oid) ilike '%agility_upgrade%'
        or pg_get_constraintdef(c.oid) ilike '%melee_upgrade%'
        or pg_get_constraintdef(c.oid) ilike '%ammo_upgrade%'
        or pg_get_constraintdef(c.oid) ilike '%armor_upgrade%'
        or pg_get_constraintdef(c.oid) ilike '%combat_upgrade%'
        or pg_get_constraintdef(c.oid) ilike '%life_evo_upgrade%'
        or pg_get_constraintdef(c.oid) ilike '%attack_evo_upgrade%'
        or pg_get_constraintdef(c.oid) ilike '%armor_evo_upgrade%')
  loop
    execute format('alter table public.platformer_users drop constraint %I', constraint_name);
  end loop;
end $$;
update public.platformer_users
set shot_upgrade = least(125, greatest(0, coalesce(shot_upgrade, 0))),
    agility_upgrade = least(150, greatest(0, coalesce(agility_upgrade, 0))),
    melee_upgrade = least(150, greatest(0, coalesce(melee_upgrade, 0))),
    ammo_upgrade = least(100, greatest(0, coalesce(ammo_upgrade, 0))),
    armor_upgrade = least(100, greatest(0, coalesce(armor_upgrade, 0))),
    combat_upgrade = least(125, greatest(0, coalesce(combat_upgrade, 0))),
    life_evo_upgrade = greatest(0, coalesce(life_evo_upgrade, 0)),
    attack_evo_upgrade = greatest(0, coalesce(attack_evo_upgrade, 0)),
    armor_evo_upgrade = greatest(0, coalesce(armor_evo_upgrade, 0)),
    battle_god_upgrade = greatest(0, coalesce(battle_god_upgrade, 0));
update public.platformer_users
set battle_god_ii_upgrade = greatest(0, coalesce(battle_god_ii_upgrade, 0));
alter table public.platformer_users add constraint platformer_users_shot_upgrade_check check (shot_upgrade between 0 and 125);
alter table public.platformer_users add constraint platformer_users_agility_upgrade_check check (agility_upgrade between 0 and 150);
alter table public.platformer_users add constraint platformer_users_melee_upgrade_check check (melee_upgrade between 0 and 150);
alter table public.platformer_users add constraint platformer_users_ammo_upgrade_check check (ammo_upgrade between 0 and 100);
alter table public.platformer_users add constraint platformer_users_armor_upgrade_check check (armor_upgrade between 0 and 100);
alter table public.platformer_users add constraint platformer_users_combat_upgrade_check check (combat_upgrade between 0 and 125);
alter table public.platformer_users add constraint platformer_users_attack_evo_upgrade_check check (attack_evo_upgrade >= 0);
alter table public.platformer_users add constraint platformer_users_armor_evo_upgrade_check check (armor_evo_upgrade >= 0);
alter table public.platformer_users drop constraint if exists platformer_users_battle_god_upgrade_check;
alter table public.platformer_users add constraint platformer_users_battle_god_upgrade_check check (battle_god_upgrade >= 0);
alter table public.platformer_users drop constraint if exists platformer_users_battle_god_ii_upgrade_check;
alter table public.platformer_users add constraint platformer_users_battle_god_ii_upgrade_check check (battle_god_ii_upgrade >= 0);

drop function if exists public.platformer_register(text, text);
drop function if exists public.platformer_login(text, text);
drop function if exists public.platformer_resume(text, text);

create or replace function public.platformer_register(p_username text, p_password text)
returns table(username text, session_token text, coins bigint, hp_upgrade bigint, atk_upgrade bigint, shot_upgrade bigint, agility_upgrade bigint, melee_upgrade bigint, ammo_upgrade bigint, armor_upgrade bigint, combat_upgrade bigint, life_evo_upgrade bigint, attack_evo_upgrade bigint, armor_evo_upgrade bigint, unlocked bigint)
language plpgsql security definer set search_path = public, extensions
as $$
declare new_token text;
begin
  if p_username is null or char_length(p_username) not between 3 and 64 or p_username !~ '^[A-Za-z0-9_一-龥]{3,64}$' then
    raise exception '用户名需为 3-64 位中文、英文、数字或下划线，不能包含空格和其他符号';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception '密码至少需要 6 位';
  end if;
  if exists (select 1 from public.platformer_users u where u.username = p_username) then
    raise exception '用户名已存在';
  end if;
  new_token := encode(gen_random_bytes(24), 'hex');
  insert into public.platformer_users as u(username, userpassword, session_token)
    values (p_username, crypt(p_password, gen_salt('bf')), new_token);
  return query
    select u.username, u.session_token, u.coins, u.hp_upgrade, u.atk_upgrade, u.shot_upgrade, u.agility_upgrade, u.melee_upgrade, u.ammo_upgrade,
           u.armor_upgrade, u.combat_upgrade, u.life_evo_upgrade, u.attack_evo_upgrade, u.armor_evo_upgrade, greatest(u.unlocked, coalesce((select max(p.level_id) + 1 from public.platformer_progress p where p.username = u.username and p.completed), 1))
    from public.platformer_users u where u.username = p_username;
end;
$$;

create or replace function public.platformer_login(p_username text, p_password text)
returns table(username text, session_token text, coins bigint, hp_upgrade bigint, atk_upgrade bigint, shot_upgrade bigint, agility_upgrade bigint, melee_upgrade bigint, ammo_upgrade bigint, armor_upgrade bigint, combat_upgrade bigint, life_evo_upgrade bigint, attack_evo_upgrade bigint, armor_evo_upgrade bigint, unlocked bigint)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  update public.platformer_users as u
  set session_token = encode(gen_random_bytes(24), 'hex'), updated_at = now()
  where u.username = p_username
    and u.userpassword = crypt(p_password, u.userpassword);
  if not found then
    return;
  end if;
  return query
    select u.username, u.session_token, u.coins, u.hp_upgrade, u.atk_upgrade, u.shot_upgrade, u.agility_upgrade, u.melee_upgrade, u.ammo_upgrade,
           u.armor_upgrade, u.combat_upgrade, u.life_evo_upgrade, u.attack_evo_upgrade, u.armor_evo_upgrade, greatest(u.unlocked, coalesce((select max(p.level_id) + 1 from public.platformer_progress p where p.username = u.username and p.completed), 1))
    from public.platformer_users u where u.username = p_username;
end;
$$;

create or replace function public.platformer_resume(p_username text, p_token text)
returns table(username text, session_token text, coins bigint, hp_upgrade bigint, atk_upgrade bigint, shot_upgrade bigint, agility_upgrade bigint, melee_upgrade bigint, ammo_upgrade bigint, armor_upgrade bigint, combat_upgrade bigint, life_evo_upgrade bigint, attack_evo_upgrade bigint, armor_evo_upgrade bigint, unlocked bigint)
language sql security definer set search_path = public, extensions
as $$
  select u.username, u.session_token, u.coins, u.hp_upgrade, u.atk_upgrade, u.shot_upgrade, u.agility_upgrade, u.melee_upgrade, u.ammo_upgrade,
         u.armor_upgrade, u.combat_upgrade, u.life_evo_upgrade, u.attack_evo_upgrade, u.armor_evo_upgrade, greatest(u.unlocked, coalesce((select max(p.level_id) + 1 from public.platformer_progress p where p.username = u.username and p.completed), 1))
  from public.platformer_users u
  where u.username = p_username and u.session_token = p_token;
$$;

drop function if exists public.platformer_save_profile(text, text, bigint, bigint, bigint, bigint, bigint);
drop function if exists public.platformer_save_profile(text, text, bigint, bigint, bigint, bigint, bigint, bigint);
drop function if exists public.platformer_save_profile(text, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint);
drop function if exists public.platformer_save_profile(text, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint);
drop function if exists public.platformer_save_profile(text, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint);
drop function if exists public.platformer_save_profile(text, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint);
drop function if exists public.platformer_save_profile(text, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint);
drop function if exists public.platformer_save_profile(text, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint);
create or replace function public.platformer_save_profile(
  p_username text, p_token text, p_coins bigint, p_hp_upgrade bigint,
  p_atk_upgrade bigint, p_shot_upgrade bigint, p_agility_upgrade bigint, p_melee_upgrade bigint, p_ammo_upgrade bigint, p_armor_upgrade bigint, p_combat_upgrade bigint, p_life_evo_upgrade bigint, p_attack_evo_upgrade bigint, p_armor_evo_upgrade bigint, p_unlocked bigint
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
      attack_evo_upgrade = greatest(0, coalesce(p_attack_evo_upgrade, 0)),
      armor_evo_upgrade = greatest(0, coalesce(p_armor_evo_upgrade, 0)),
      -- 解锁进度只允许前进，避免旧客户端覆盖新进度。
      unlocked = greatest(u.unlocked, 1, coalesce(p_unlocked, 1)),
      updated_at = now()
  where u.username = p_username and u.session_token = p_token;
  return found;
end;
$$;

-- 返回本次写入后的最高分，以及是否首次完成该关卡，供前端计算首通奖励。
drop function if exists public.platformer_record_score(text, text, bigint, bigint);
create or replace function public.platformer_record_score(p_username text, p_token text, p_level_id bigint, p_score bigint)
returns table(best_score bigint, is_first_completion boolean)
language plpgsql security definer set search_path = public, extensions
as $$
declare saved_score bigint; was_completed boolean := false;
begin
  if not exists (select 1 from public.platformer_users u where u.username = p_username and u.session_token = p_token) then
    return;
  end if;
  select coalesce(p.completed, false) into was_completed
    from public.platformer_progress p
    where p.username = p_username and p.level_id = p_level_id;
  insert into public.platformer_progress as progress(username, level_id, best_score, completed)
    values (p_username, p_level_id, greatest(0, coalesce(p_score, 0)), true)
  on conflict (username, level_id) do update
    set best_score = greatest(progress.best_score, excluded.best_score),
        completed = true,
        updated_at = now();
  select p.best_score into saved_score
    from public.platformer_progress p
    where p.username = p_username and p.level_id = p_level_id;
  update public.platformer_users as u
  set unlocked = greatest(u.unlocked, p_level_id + 1), updated_at = now()
  where u.username = p_username and u.session_token = p_token;
  return query select saved_score, not was_completed;
end;
$$;

create or replace view public.platformer_leaderboard as
select u.username, coalesce(sum(p.best_score), 0)::bigint as total_score
from public.platformer_users u
left join public.platformer_progress p on p.username = u.username
group by u.username;

drop function if exists public.platformer_change_password(text,text,text,text);
create or replace function public.platformer_change_password(
  p_username text, p_token text, p_old_password text, p_new_password text
)
returns table(session_token text)
language plpgsql security definer set search_path = public, extensions
as $$
declare new_token text;
begin
  if p_username is null or p_token is null or not exists (
    select 1 from public.platformer_users u
    where u.username = p_username and u.session_token = p_token
      and u.userpassword = crypt(p_old_password, u.userpassword)
  ) then raise exception '当前密码不正确或登录会话已失效'; end if;
  if p_new_password is null or length(p_new_password) < 6 then raise exception '新密码至少需要 6 位'; end if;
  if p_new_password = p_old_password then raise exception '新密码不能与当前密码相同'; end if;
  new_token := encode(gen_random_bytes(24), 'hex');
  update public.platformer_users as u set userpassword=crypt(p_new_password,gen_salt('bf')),session_token=new_token,updated_at=now()
  where u.username=p_username and u.session_token=p_token;
  if not found then raise exception '登录会话已失效，请重新登录'; end if;
  return query select new_token;
end;
$$;

drop function if exists public.platformer_change_username(text, text, text);
create or replace function public.platformer_change_username(
  p_username text,
  p_token text,
  p_new_username text
)
returns table(username text, session_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  account_payload jsonb;
  new_token text;
begin
  if p_username is null or p_token is null or p_new_username is null then
    raise exception '用户名、会话或新用户名不能为空';
  end if;
  if char_length(p_new_username) not between 3 and 64
     or p_new_username !~ '^[A-Za-z0-9_一-龥]{3,64}$' then
    raise exception '用户名需为 3-64 位中文、英文、数字或下划线，不能包含空格和其他符号';
  end if;
  if p_new_username = p_username then
    raise exception '新用户名不能与当前用户名相同';
  end if;
  if exists (select 1 from public.platformer_users u where u.username = p_new_username) then
    raise exception '新用户名已存在';
  end if;

  select to_jsonb(u) into account_payload
  from public.platformer_users u
  where u.username = p_username and u.session_token = p_token
  for update;
  if account_payload is null then
    raise exception '登录会话已失效，请重新登录';
  end if;

  new_token := encode(gen_random_bytes(24), 'hex');
  account_payload := account_payload || jsonb_build_object(
    'username', p_new_username,
    'session_token', new_token,
    'updated_at', now()
  );
  insert into public.platformer_users
    select (jsonb_populate_record(null::public.platformer_users, account_payload)).*;

  if to_regclass('public.platformer_progress') is not null then
    update public.platformer_progress set username = p_new_username where username = p_username;
  end if;
  if to_regclass('public.platformer_event_claims') is not null then
    update public.platformer_event_claims set username = p_new_username where username = p_username;
  end if;
  if to_regclass('public.platformer_announcement_claims') is not null then
    update public.platformer_announcement_claims set username = p_new_username where username = p_username;
  end if;
  if to_regclass('public.platformer_pk_rooms') is not null then
    update public.platformer_pk_rooms set host_username = p_new_username where host_username = p_username;
    update public.platformer_pk_rooms set guest_username = p_new_username where guest_username = p_username;
  end if;
  if to_regclass('public.platformer_pk_members') is not null then
    update public.platformer_pk_members set username = p_new_username where username = p_username;
  end if;
  if to_regclass('public.platformer_pk_matches') is not null then
    update public.platformer_pk_matches set winner_username = p_new_username where winner_username = p_username;
  end if;
  if to_regclass('public.platformer_pk_coin_ledger') is not null then
    update public.platformer_pk_coin_ledger set username = p_new_username where username = p_username;
  end if;
  if to_regclass('public.platformer_announcements') is not null then
    update public.platformer_announcements set created_by = p_new_username where created_by = p_username;
    update public.platformer_announcements set updated_by = p_new_username where updated_by = p_username;
  end if;
  if to_regclass('public.platformer_service_settings') is not null then
    update public.platformer_service_settings set updated_by = p_new_username where updated_by = p_username;
  end if;

  delete from public.platformer_users where username = p_username;
  return query select p_new_username, new_token;
end;
$$;

alter table public.platformer_users enable row level security;
alter table public.platformer_progress enable row level security;

revoke all on table public.platformer_users, public.platformer_progress from anon, authenticated;
grant select on public.platformer_leaderboard to anon, authenticated;
revoke execute on function public.platformer_register(text, text) from public;
revoke execute on function public.platformer_login(text, text) from public;
revoke execute on function public.platformer_resume(text, text) from public;
revoke execute on function public.platformer_save_profile(text, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint) from public;
revoke execute on function public.platformer_record_score(text, text, bigint, bigint) from public;
revoke execute on function public.platformer_change_password(text, text, text, text) from public;
revoke execute on function public.platformer_change_username(text, text, text) from public;
grant execute on function public.platformer_register(text, text) to anon, authenticated;
grant execute on function public.platformer_login(text, text) to anon, authenticated;
grant execute on function public.platformer_resume(text, text) to anon, authenticated;
grant execute on function public.platformer_save_profile(text, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint) to anon, authenticated;
grant execute on function public.platformer_record_score(text, text, bigint, bigint) to anon, authenticated;
grant execute on function public.platformer_change_password(text, text, text, text) to anon, authenticated;
grant execute on function public.platformer_change_username(text, text, text) to anon, authenticated;

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
  update public.platformer_users as u
  set battle_god_ii_upgrade = greatest(0, coalesce(p_level, 0)), updated_at = now()
  where u.username = p_username and u.session_token = p_token;
  return found;
end;
$$;

revoke execute on function public.platformer_get_battle_god_ii(text, text) from public;
revoke execute on function public.platformer_save_battle_god_ii(text, text, bigint) from public;
grant execute on function public.platformer_get_battle_god_ii(text, text) to anon, authenticated;
grant execute on function public.platformer_save_battle_god_ii(text, text, bigint) to anon, authenticated;
