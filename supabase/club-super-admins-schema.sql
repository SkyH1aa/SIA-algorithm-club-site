-- 动态超管名单：支持社长权限交接。
-- 初始写入 Haimingadmin / Collen；之后由现任超管升级或撤销其他账号。
-- 所有读写仅通过 club-drive Edge Function（service_role）完成。

create table if not exists public.club_super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  email text not null,
  note text,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists club_super_admins_username_uidx
  on public.club_super_admins (lower(username));

create unique index if not exists club_super_admins_email_uidx
  on public.club_super_admins (lower(email));

create index if not exists club_super_admins_updated_idx
  on public.club_super_admins (updated_at desc);

alter table public.club_super_admins enable row level security;
revoke all on table public.club_super_admins from public, anon, authenticated;
grant select, insert, update, delete on table public.club_super_admins to service_role;

-- 种子：把已存在的初始超管账号写入名单（可重复执行）。
insert into public.club_super_admins (user_id, username, email, note)
select
  u.id,
  split_part(lower(u.email), '@', 1),
  lower(u.email),
  '初始超管'
from auth.users u
where lower(u.email) in ('haimingadmin@club.local', 'collen@club.local')
on conflict (user_id) do update
set
  username = excluded.username,
  email = excluded.email,
  updated_at = timezone('utc', now());
