-- 《行于无垠》管理员、游戏公告与公告附件
-- 前置：platformer-schema.sql、platformer-service-control-migration.sql。
-- 本迁移支持两类游戏管理员：
--   1) 游戏独立账号 chm；
--   2) 当前 Supabase Auth 账号在 club_super_admins 中的社团盘超级管理员。

-- 兼容尚未执行社团超管表的项目；已存在时不会覆盖数据。
create table if not exists public.club_super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  email text not null,
  note text,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.club_super_admins enable row level security;
revoke all on table public.club_super_admins from public, anon, authenticated;
grant select, insert, update, delete on table public.club_super_admins to service_role;

create or replace function public.platformer_club_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.club_super_admins a
    where a.user_id = auth.uid()
  );
$$;

create or replace function public.platformer_game_is_admin(p_username text default null, p_token text default null)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.platformer_club_super_admin()
    or exists (
      select 1 from public.platformer_users u
      where lower(u.username) = lower(coalesce(p_username, ''))
        and u.session_token = p_token
        and lower(u.username) = 'chm'
    );
$$;

-- 服务开关改为社团超管或 chm 均可操作。
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
  if not public.platformer_game_is_admin(p_username, p_token) then
    raise exception '只有游戏管理员或社团盘超级管理员可以管理游戏服务';
  end if;
  update public.platformer_service_settings
  set enabled = coalesce(p_enabled, false), updated_at = now(),
      updated_by = coalesce(nullif(p_username, ''), 'club-super-admin')
  where singleton;
  return found;
end;
$$;

-- 游戏管理员查看已注册玩家，并直接调整金币。
create or replace function public.platformer_admin_list_players(p_username text, p_token text)
returns table(username text, coins bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.platformer_game_is_admin(p_username, p_token) then
    raise exception '无游戏管理员权限';
  end if;
  return query
    select u.username, u.coins
    from public.platformer_users u
    order by lower(u.username);
end;
$$;

create or replace function public.platformer_admin_set_player_coins(
  p_username text,
  p_token text,
  p_target_username text,
  p_coins bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.platformer_game_is_admin(p_username, p_token) then
    raise exception '无游戏管理员权限';
  end if;
  if p_target_username is null or length(trim(p_target_username)) = 0 then
    raise exception '请选择要修改的玩家';
  end if;
  update public.platformer_users
  set coins = greatest(0, coalesce(p_coins, 0)), updated_at = now()
  where username = trim(p_target_username);
  if not found then raise exception '未找到该游戏账号'; end if;
  return true;
end;
$$;

create table if not exists public.platformer_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  is_published boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platformer_announcement_attachments (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.platformer_announcements(id) on delete cascade,
  reward_type text not null default 'coins' check (reward_type = 'coins'),
  amount bigint not null check (amount > 0),
  label text not null default '金币附件',
  created_at timestamptz not null default now()
);

create table if not exists public.platformer_announcement_claims (
  attachment_id uuid not null references public.platformer_announcement_attachments(id) on delete cascade,
  username text not null references public.platformer_users(username) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (attachment_id, username)
);

create index if not exists platformer_announcements_published_idx
  on public.platformer_announcements (is_published, updated_at desc);
create index if not exists platformer_announcement_attachments_announcement_idx
  on public.platformer_announcement_attachments (announcement_id);

alter table public.platformer_announcements enable row level security;
alter table public.platformer_announcement_attachments enable row level security;
alter table public.platformer_announcement_claims enable row level security;
revoke all on table public.platformer_announcements from public, anon, authenticated;
revoke all on table public.platformer_announcement_attachments from public, anon, authenticated;
revoke all on table public.platformer_announcement_claims from public, anon, authenticated;
grant select, insert, update, delete on table public.platformer_announcements to service_role;
grant select, insert, update, delete on table public.platformer_announcement_attachments to service_role;
grant select, insert, update, delete on table public.platformer_announcement_claims to service_role;

create or replace function public.platformer_announcements_public(p_username text, p_token text)
returns table(id uuid, title text, content text, created_at timestamptz, updated_at timestamptz, attachments jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.platformer_users u where u.username = p_username and u.session_token = p_token) then
    raise exception '登录会话已失效，请重新登录';
  end if;
  return query
    select a.id, a.title, a.content, a.created_at, a.updated_at,
      coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'type', x.reward_type, 'amount', x.amount, 'label', x.label,
        'claimed', exists(select 1 from public.platformer_announcement_claims c where c.attachment_id=x.id and c.username=p_username)
      ) order by x.created_at, x.id) from public.platformer_announcement_attachments x where x.announcement_id=a.id), '[]'::jsonb)
    from public.platformer_announcements a
    where a.is_published
    order by a.updated_at desc;
end;
$$;

create or replace function public.platformer_admin_list_announcements(p_username text, p_token text)
returns table(id uuid, title text, content text, is_published boolean, created_at timestamptz, updated_at timestamptz, attachments jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.platformer_game_is_admin(p_username, p_token) then raise exception '无游戏管理员权限'; end if;
  return query
    select a.id, a.title, a.content, a.is_published, a.created_at, a.updated_at,
      coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'type', x.reward_type, 'amount', x.amount, 'label', x.label) order by x.created_at, x.id)
                from public.platformer_announcement_attachments x where x.announcement_id=a.id), '[]'::jsonb)
    from public.platformer_announcements a
    order by a.updated_at desc;
end;
$$;

create or replace function public.platformer_admin_save_announcement(
  p_username text,
  p_token text,
  p_id uuid,
  p_title text,
  p_content text,
  p_is_published boolean,
  p_attachments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_announcement_id uuid;
  item jsonb;
  amount_value bigint;
begin
  if not public.platformer_game_is_admin(p_username, p_token) then raise exception '无游戏管理员权限'; end if;
  if nullif(trim(p_title), '') is null then raise exception '公告标题不能为空'; end if;
  if nullif(trim(p_content), '') is null then raise exception '公告内容不能为空'; end if;
  if p_id is null then
    insert into public.platformer_announcements(title, content, is_published, created_by, updated_by)
    values (left(trim(p_title), 120), left(trim(p_content), 10000), coalesce(p_is_published, true), p_username, p_username)
    returning id into v_announcement_id;
  else
    update public.platformer_announcements
    set title=left(trim(p_title),120), content=left(trim(p_content),10000), is_published=coalesce(p_is_published,true), updated_by=p_username, updated_at=now()
    where id=p_id;
    if not found then raise exception '公告不存在'; end if;
    v_announcement_id := p_id;
    delete from public.platformer_announcement_attachments x where x.announcement_id=v_announcement_id;
  end if;
  for item in select value from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    amount_value := greatest(0, least(9223372036854775807,
      case when coalesce(item->>'amount','') ~ '^[0-9]+$' then (item->>'amount')::bigint else 0 end));
    if amount_value > 0 then
      insert into public.platformer_announcement_attachments(announcement_id, reward_type, amount, label)
      values (v_announcement_id, 'coins', amount_value, coalesce(nullif(left(item->>'label',80),''),'金币附件'));
    end if;
  end loop;
  return v_announcement_id;
end;
$$;

create or replace function public.platformer_admin_delete_announcement(p_username text, p_token text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.platformer_game_is_admin(p_username, p_token) then raise exception '无游戏管理员权限'; end if;
  delete from public.platformer_announcements where id=p_id;
  return found;
end;
$$;

create or replace function public.platformer_claim_announcement_attachment(p_username text, p_token text, p_attachment_id uuid)
returns table(reward bigint, already_claimed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  reward_value bigint;
  inserted_count bigint;
begin
  if not public.platformer_service_is_open() then raise exception '服务器升级维护中，请稍后再试'; end if;
  if not exists (select 1 from public.platformer_users u where u.username=p_username and u.session_token=p_token) then raise exception '登录会话已失效，请重新登录'; end if;
  select x.amount into reward_value
  from public.platformer_announcement_attachments x
  join public.platformer_announcements a on a.id=x.announcement_id
  where x.id=p_attachment_id and a.is_published;
  if reward_value is null then raise exception '附件不存在或已下线'; end if;
  insert into public.platformer_announcement_claims(attachment_id, username) values(p_attachment_id,p_username) on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count=0 then return query select 0, true; return; end if;
  update public.platformer_users set coins=greatest(0, coins+reward_value), updated_at=now() where username=p_username and session_token=p_token;
  return query select reward_value, false;
end;
$$;

revoke all on function public.platformer_club_super_admin() from public, anon, authenticated;
revoke all on function public.platformer_game_is_admin(text,text) from public, anon, authenticated;
grant execute on function public.platformer_club_super_admin() to anon, authenticated;
grant execute on function public.platformer_game_is_admin(text,text) to anon, authenticated;
grant execute on function public.platformer_set_service_enabled(text,text,boolean) to anon, authenticated;
grant execute on function public.platformer_admin_list_players(text,text) to anon, authenticated;
grant execute on function public.platformer_admin_set_player_coins(text,text,text,bigint) to anon, authenticated;
grant execute on function public.platformer_announcements_public(text,text) to anon, authenticated;
grant execute on function public.platformer_admin_list_announcements(text,text) to anon, authenticated;
grant execute on function public.platformer_admin_save_announcement(text,text,uuid,text,text,boolean,jsonb) to anon, authenticated;
grant execute on function public.platformer_admin_delete_announcement(text,text,uuid) to anon, authenticated;
grant execute on function public.platformer_claim_announcement_attachment(text,text,uuid) to anon, authenticated;
