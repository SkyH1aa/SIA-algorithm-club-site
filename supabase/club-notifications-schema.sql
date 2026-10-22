-- 站内通知与社员个人主页展示设置（独立新表，不修改任何既有表结构）
-- 在 Supabase SQL Editor 执行本脚本后，再部署 club-drive Edge Function。
--
-- 设计要点：
-- * 两张表都只授予 service_role，前端一律通过 club-drive 的投影读取，
--   避免把 email / user_id 暴露给 anon。
-- * 脚本幂等：可重复执行，不会 drop 任何既有表。

create table if not exists public.club_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null default 'system',
  title text not null,
  body text not null default '',
  link text not null default '',
  -- 同一事件对同一用户只写一次（例如一条公告只通知一次）。
  dedupe_key text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint club_notifications_kind_check
    check (kind in ('announcement', 'event', 'signup', 'points', 'message', 'mall', 'account', 'system')),
  constraint club_notifications_title_check check (char_length(title) between 1 and 160),
  constraint club_notifications_body_check check (char_length(body) <= 2000),
  constraint club_notifications_link_check check (char_length(link) <= 500),
  constraint club_notifications_dedupe_check check (char_length(dedupe_key) <= 200)
);

create index if not exists club_notifications_user_created_idx
  on public.club_notifications (user_id, created_at desc);

create index if not exists club_notifications_unread_idx
  on public.club_notifications (user_id, created_at desc)
  where read_at is null;

create unique index if not exists club_notifications_dedupe_uidx
  on public.club_notifications (user_id, dedupe_key)
  where dedupe_key <> '';

alter table public.club_notifications enable row level security;

drop policy if exists "deny all club_notifications" on public.club_notifications;
create policy "deny all club_notifications"
on public.club_notifications
for all
using (false)
with check (false);

revoke all on table public.club_notifications from public, anon, authenticated;
grant select, insert, update, delete on table public.club_notifications to service_role;


-- 个人主页展示开关。没有绑定社团账号的积分记录没有对应设置行，
-- 个人主页对这类社员只显示姓名、班级与积分。
create table if not exists public.club_member_profile_settings (
  user_id uuid primary key,
  show_points boolean not null default true,
  show_donations boolean not null default false,
  show_games boolean not null default true,
  show_checkin boolean not null default false,
  headline text not null default '',
  updated_at timestamptz not null default timezone('utc', now()),
  constraint club_member_profile_settings_headline_check
    check (char_length(headline) <= 80)
);

alter table public.club_member_profile_settings enable row level security;

drop policy if exists "deny all club_member_profile_settings" on public.club_member_profile_settings;
create policy "deny all club_member_profile_settings"
on public.club_member_profile_settings
for all
using (false)
with check (false);

revoke all on table public.club_member_profile_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.club_member_profile_settings to service_role;


-- 读取本人展示设置；未设置时返回默认值（积分/战绩开，捐赠/签到关）。
create or replace function public.get_club_member_profile_settings(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.club_member_profile_settings%rowtype;
begin
  if p_user_id is null then
    raise exception '您还不是算法社社员！';
  end if;

  select * into v_row
  from public.club_member_profile_settings
  where user_id = p_user_id;

  if not found then
    return jsonb_build_object(
      'exists', false,
      'show_points', true,
      'show_donations', false,
      'show_games', true,
      'show_checkin', false,
      'headline', ''
    );
  end if;

  return jsonb_build_object(
    'exists', true,
    'show_points', v_row.show_points,
    'show_donations', v_row.show_donations,
    'show_games', v_row.show_games,
    'show_checkin', v_row.show_checkin,
    'headline', v_row.headline,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.get_club_member_profile_settings(uuid) from public;
grant execute on function public.get_club_member_profile_settings(uuid) to service_role;


-- 写入本人展示设置（整体覆盖，调用方必须传完整四项）。
create or replace function public.set_club_member_profile_settings(
  p_user_id uuid,
  p_show_points boolean,
  p_show_donations boolean,
  p_show_games boolean,
  p_show_checkin boolean,
  p_headline text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headline text := coalesce(trim(p_headline), '');
begin
  if p_user_id is null then
    raise exception '您还不是算法社社员！';
  end if;
  if char_length(v_headline) > 80 then
    raise exception '个人简介最多 80 个字符。';
  end if;

  insert into public.club_member_profile_settings
    (user_id, show_points, show_donations, show_games, show_checkin, headline, updated_at)
  values
    (p_user_id, coalesce(p_show_points, true), coalesce(p_show_donations, false),
     coalesce(p_show_games, true), coalesce(p_show_checkin, false), v_headline,
     timezone('utc', now()))
  on conflict (user_id) do update set
    show_points = excluded.show_points,
    show_donations = excluded.show_donations,
    show_games = excluded.show_games,
    show_checkin = excluded.show_checkin,
    headline = excluded.headline,
    updated_at = excluded.updated_at;

  return public.get_club_member_profile_settings(p_user_id);
end;
$$;

revoke all on function public.set_club_member_profile_settings(uuid, boolean, boolean, boolean, boolean, text) from public;
grant execute on function public.set_club_member_profile_settings(uuid, boolean, boolean, boolean, boolean, text) to service_role;
