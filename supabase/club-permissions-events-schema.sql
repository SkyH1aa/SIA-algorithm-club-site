-- 社团权限下放 + 活动公告系统
-- 独立新表，不修改旧表结构。
-- 超管名单见 club-super-admins-schema.sql（动态维护，可交接）。
-- 可下放权限：checkin / points / messages / invites / events / mall
-- 超管专属：密码重置、直接改密、姓名班级账号绑定查看、权限分配、超管升级/撤销

create table if not exists public.club_staff_permissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  email text not null,
  can_checkin boolean not null default false,
  can_points boolean not null default false,
  can_messages boolean not null default false,
  can_invites boolean not null default false,
  can_events boolean not null default false,
  can_mall boolean not null default false,
  note text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- 已部署过权限表时，补齐积分商城权限字段。
alter table public.club_staff_permissions
  add column if not exists can_mall boolean not null default false;

create unique index if not exists club_staff_permissions_username_uidx
  on public.club_staff_permissions (lower(username));

create index if not exists club_staff_permissions_updated_idx
  on public.club_staff_permissions (updated_at desc);

alter table public.club_staff_permissions enable row level security;
revoke all on table public.club_staff_permissions from public, anon, authenticated;
grant select, insert, update, delete on table public.club_staff_permissions to service_role;

create table if not exists public.club_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  category text not null default '社团通知'
    check (category in ('社团通知', '课程安排', '比赛信息', '活动报名', '其他')),
  is_pinned boolean not null default false,
  is_featured boolean not null default false,
  is_published boolean not null default true,
  featured_push_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- 如果表已经创建过，则补齐首页推荐字段。
alter table public.club_announcements
  add column if not exists is_featured boolean not null default false;

-- 再次推送主页时更新该时间戳；前端据此让“不再提醒”失效并重新弹出。
alter table public.club_announcements
  add column if not exists featured_push_at timestamptz;

update public.club_announcements
set featured_push_at = coalesce(featured_push_at, updated_at, created_at, timezone('utc', now()))
where is_featured = true
  and featured_push_at is null;

create index if not exists club_announcements_published_idx
  on public.club_announcements (is_published, is_featured desc, is_pinned desc, updated_at desc);

alter table public.club_announcements enable row level security;
revoke all on table public.club_announcements from public, anon, authenticated;
grant select, insert, update, delete on table public.club_announcements to service_role;

create table if not exists public.club_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null default '',
  content text not null default '',
  category text not null default '活动报名'
    check (category in ('社团通知', '活动报名', '课程安排', '比赛信息', '其他')),
  status text not null default '报名中'
    check (status in ('草稿', '报名中', '进行中', '已截止', '已结束', '已取消')),
  location text not null default '',
  starts_at timestamptz,
  ends_at timestamptz,
  signup_deadline timestamptz,
  allow_signup boolean not null default true,
  signup_limit integer,
  is_featured boolean not null default false,
  is_published boolean not null default true,
  featured_push_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (signup_limit is null or signup_limit > 0)
);

-- 再次推送主页时更新该时间戳；前端据此让“不再提醒”失效并重新弹出。
alter table public.club_events
  add column if not exists featured_push_at timestamptz;

update public.club_events
set featured_push_at = coalesce(featured_push_at, updated_at, created_at, timezone('utc', now()))
where is_featured = true
  and featured_push_at is null;

create index if not exists club_events_published_idx
  on public.club_events (is_published, is_featured desc, starts_at nulls last, updated_at desc);

create index if not exists club_events_status_idx
  on public.club_events (status, signup_deadline nulls last);

alter table public.club_events enable row level security;
revoke all on table public.club_events from public, anon, authenticated;
grant select, insert, update, delete on table public.club_events to service_role;

create table if not exists public.club_event_signups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.club_events(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  username text not null default '',
  member_name text not null,
  member_class text not null default '',
  contact text not null default '',
  note text not null default '',
  status text not null default '已报名'
    check (status in ('已报名', '已取消', '已拒绝')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists club_event_signups_active_user_uidx
  on public.club_event_signups (event_id, user_id)
  where user_id is not null and status = '已报名';

create unique index if not exists club_event_signups_active_name_uidx
  on public.club_event_signups (event_id, member_name)
  where status = '已报名';

create index if not exists club_event_signups_event_idx
  on public.club_event_signups (event_id, created_at desc);

alter table public.club_event_signups enable row level security;
revoke all on table public.club_event_signups from public, anon, authenticated;
grant select, insert, update, delete on table public.club_event_signups to service_role;

-- 若之前已部署 find_club_auth_user，这里保持幂等。
create or replace function public.find_club_auth_user(p_email text)
returns table (id uuid, email text)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  return query
  select u.id, u.email::text
  from auth.users u
  where lower(u.email) = lower(p_email)
  limit 1;
end;
$$;

revoke all on function public.find_club_auth_user(text) from public, anon, authenticated;
grant execute on function public.find_club_auth_user(text) to service_role;