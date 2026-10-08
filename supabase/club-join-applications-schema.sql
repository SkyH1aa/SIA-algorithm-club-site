-- 社团报名申请表
-- 独立新表；权限字段 can_join 追加到 club_staff_permissions。
-- 公开提交走 Edge Function；仅超管 / 有报名管理权限账号可列表与删除。

alter table public.club_staff_permissions
  add column if not exists can_join boolean not null default false;

create table if not exists public.club_join_applications (
  id uuid primary key default gen_random_uuid(),
  chinese_name text not null check (char_length(trim(chinese_name)) between 2 and 20),
  member_class text not null check (char_length(trim(member_class)) between 1 and 80),
  contact_type text not null check (contact_type in ('wechat', 'phone', 'qq', 'email')),
  contact_value text not null check (char_length(trim(contact_value)) between 1 and 120),
  self_intro text not null default '' check (char_length(self_intro) <= 500),
  attraction text not null default '' check (char_length(attraction) <= 500),
  expectation text not null default '' check (char_length(expectation) <= 500),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists club_join_applications_created_idx
  on public.club_join_applications (created_at desc);

create index if not exists club_join_applications_name_idx
  on public.club_join_applications (chinese_name);

alter table public.club_join_applications enable row level security;
revoke all on table public.club_join_applications from public, anon, authenticated;
grant select, insert, update, delete on table public.club_join_applications to service_role;
