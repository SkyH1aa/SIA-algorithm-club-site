-- 社员积分公示
-- 访客可读取；写入只经由 club-drive Edge Function 的社长权限执行。

create table if not exists public.club_member_points (
  id uuid primary key default gen_random_uuid(),
  member_name text not null check (char_length(trim(member_name)) between 1 and 40),
  member_class text not null check (char_length(trim(member_class)) between 1 and 40),
  points integer not null default 0 check (points >= 0 and points <= 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_name, member_class)
);

create index if not exists club_member_points_order_index
  on public.club_member_points (points desc, member_name asc);

alter table public.club_member_points enable row level security;

drop policy if exists "Anyone can read club member points" on public.club_member_points;
create policy "Anyone can read club member points"
  on public.club_member_points for select
  using (true);

-- 不创建 anon / authenticated 的写入策略。
-- Edge Function 使用 service_role 写入，不受 RLS 限制。

create or replace function public.set_club_member_points_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists club_member_points_updated_at on public.club_member_points;
create trigger club_member_points_updated_at
before update on public.club_member_points
for each row execute function public.set_club_member_points_updated_at();
