-- 社团盘密码重置申请与秘钥
-- 独立新表，不修改旧表结构。
-- 说明：Supabase Auth 只保存密码哈希，管理员无法明文查看用户密码。

create extension if not exists pgcrypto;

create table if not exists public.club_password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'used', 'cancelled', 'expired')),
  secret_hash text,
  secret_hint text,
  requested_at timestamptz not null default timezone('utc', now()),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz,
  used_at timestamptz,
  note text,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists club_password_resets_status_idx
  on public.club_password_resets (status, requested_at desc);

create index if not exists club_password_resets_username_idx
  on public.club_password_resets (lower(username), requested_at desc);

create unique index if not exists club_password_resets_one_pending_per_user
  on public.club_password_resets (user_id)
  where status = 'pending';

create unique index if not exists club_password_resets_one_active_secret_per_user
  on public.club_password_resets (user_id)
  where status = 'approved';

alter table public.club_password_resets enable row level security;

revoke all on table public.club_password_resets from public, anon, authenticated;
grant select, insert, update, delete on table public.club_password_resets to service_role;

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
