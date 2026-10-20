-- 社团捐赠名单
-- 独立新表：只记录捐赠人姓名、捐赠日期与金额，供已登录社员只读查看。
-- 新增 / 编辑 / 删除仅限超级管理员（服务端 requireSuperAdmin）。
-- 金额统一用 numeric(12,2)，避免浮点误差；默认按金额从大到小排序。

create table if not exists public.club_donations (
  id uuid primary key default gen_random_uuid(),
  donor_name text not null check (char_length(trim(donor_name)) between 1 and 60),
  donated_on date not null,
  amount numeric(12,2) not null check (amount > 0 and amount <= 9999999999.99),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- 列表默认按金额降序；同额时用日期、创建时间保证稳定顺序。
create index if not exists club_donations_amount_idx
  on public.club_donations (amount desc, donated_on desc, created_at desc);
create index if not exists club_donations_date_idx
  on public.club_donations (donated_on desc);

alter table public.club_donations enable row level security;
revoke all on table public.club_donations from public, anon, authenticated;
grant select, insert, update, delete on table public.club_donations to service_role;
create or replace function public.set_club_donations_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists club_donations_updated_at on public.club_donations;
create trigger club_donations_updated_at
before update on public.club_donations
for each row execute function public.set_club_donations_updated_at();
