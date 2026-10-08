-- 社团盘账号资料与邀请码系统
-- 密码仅由 Supabase Auth 保存，绝不写入任何数据表。

create table if not exists public.club_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[A-Za-z0-9_]{3,64}$'),
  created_at timestamptz not null default now()
);

-- 用户名不区分大小写，数据库作为并发注册的最终约束。
create unique index if not exists club_profiles_username_lower_key
  on public.club_profiles (lower(username));

alter table public.club_profiles enable row level security;

drop policy if exists "Users can read own club profile" on public.club_profiles;
create policy "Users can read own club profile"
  on public.club_profiles for select to authenticated
  using (id = auth.uid());

drop policy if exists "Users can create own club profile" on public.club_profiles;
create policy "Users can create own club profile"
  on public.club_profiles for insert to authenticated
  with check (id = auth.uid());

create table if not exists public.club_invite_codes (
  code text primary key check (code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  reserved_at timestamptz,
  reservation_token uuid unique
);

alter table public.club_invite_codes
  add column if not exists reserved_at timestamptz,
  add column if not exists reservation_token uuid unique;

alter table public.club_invite_codes enable row level security;

-- 原子占用邀请码，防止同一邀请码被并发注册重复使用。
create or replace function public.consume_club_invite(invite_code text, member_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := upper(trim(invite_code));
begin
  update public.club_invite_codes
  set used_at = now(), used_by = member_id
  where code = normalized_code and used_at is null;

  if found then
    return 'ok';
  end if;

  if exists (select 1 from public.club_invite_codes where code = normalized_code) then
    return 'used';
  end if;

  return 'invalid';
end;
$$;

revoke all on function public.consume_club_invite(text, uuid) from public;
grant execute on function public.consume_club_invite(text, uuid) to service_role;

-- 在创建 Auth 用户前原子预占邀请码，避免错误邀请码创建出残留用户。
create or replace function public.reserve_club_invite(invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := upper(trim(invite_code));
  current_row public.club_invite_codes%rowtype;
  token uuid := gen_random_uuid();
begin
  select * into current_row
  from public.club_invite_codes
  where code = normalized_code
  for update;

  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  if current_row.used_at is not null then
    return jsonb_build_object('status', 'used');
  end if;

  if current_row.reservation_token is not null
     and current_row.reserved_at > now() - interval '15 minutes' then
    return jsonb_build_object('status', 'reserved');
  end if;

  update public.club_invite_codes
  set reserved_at = now(), reservation_token = token
  where code = normalized_code;

  return jsonb_build_object('status', 'reserved_ok', 'token', token::text);
end;
$$;

-- Auth 用户创建成功后，将预占邀请码正式标记为已使用。
create or replace function public.commit_club_invite(reservation_token_value uuid, member_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update public.club_invite_codes
  set used_at = now(), used_by = member_id,
      reserved_at = null, reservation_token = null
  where reservation_token = reservation_token_value
    and used_at is null;

  get diagnostics updated_count = row_count;
  if updated_count = 1 then return 'ok'; end if;
  return 'invalid';
end;
$$;

-- Auth 用户创建失败时释放邀请码预占。
create or replace function public.release_club_invite(reservation_token_value uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update public.club_invite_codes
  set reserved_at = null, reservation_token = null
  where reservation_token = reservation_token_value
    and used_at is null;

  get diagnostics updated_count = row_count;
  if updated_count = 1 then return 'ok'; end if;
  return 'invalid';
end;
$$;

revoke all on function public.reserve_club_invite(text) from public, anon, authenticated;
revoke all on function public.commit_club_invite(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_club_invite(uuid) from public, anon, authenticated;
grant execute on function public.reserve_club_invite(text) to service_role;
grant execute on function public.commit_club_invite(uuid, uuid) to service_role;
grant execute on function public.release_club_invite(uuid) to service_role;

-- 注册后自动同步用户名资料。
create or replace function public.handle_club_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.club_profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_club_profile on auth.users;
create trigger on_auth_user_created_club_profile
after insert on auth.users
for each row execute function public.handle_club_user_created();
