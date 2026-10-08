-- 首页成员展示后台
-- 独立新表；权限字段 can_members 追加到 club_staff_permissions。
-- 配图仅存可选 image_url（外链图床），不做 Storage 上传。

alter table public.club_staff_permissions
  add column if not exists can_members boolean not null default false;

create table if not exists public.club_showcase_members (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 40),
  member_class text not null default '' check (char_length(member_class) <= 80),
  intro text not null default '' check (char_length(intro) <= 500),
  image_url text not null default '' check (char_length(image_url) <= 500),
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists club_showcase_members_visible_idx
  on public.club_showcase_members (is_visible, sort_order asc, updated_at desc);

create index if not exists club_showcase_members_updated_idx
  on public.club_showcase_members (updated_at desc);

alter table public.club_showcase_members enable row level security;
revoke all on table public.club_showcase_members from public, anon, authenticated;
grant select, insert, update, delete on table public.club_showcase_members to service_role;

create or replace function public.set_club_showcase_members_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists club_showcase_members_updated_at on public.club_showcase_members;
create trigger club_showcase_members_updated_at
before update on public.club_showcase_members
for each row execute function public.set_club_showcase_members_updated_at();
