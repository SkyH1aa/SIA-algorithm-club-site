-- 算法社签到系统：请在 Supabase SQL Editor 中执行一次。
-- 所有业务读写均通过 club-drive Edge Function 完成。

create table if not exists public.club_checkin_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6,20}$'),
  points integer not null check (points between 1 and 1000000),
  usage_mode text not null check (usage_mode in ('global_once', 'per_member_once')),
  expires_at timestamptz not null,
  created_by text not null,
  used_count integer not null default 0 check (used_count >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.club_checkin_uses (
  id uuid primary key default gen_random_uuid(),
  checkin_code_id uuid not null references public.club_checkin_codes(id) on delete cascade,
  member_name text not null,
  member_point_id uuid references public.club_member_points(id) on delete set null,
  checked_in_by uuid not null,
  checked_in_email text not null,
  points_awarded integer not null default 0 check (points_awarded >= 0),
  used_at timestamptz not null default now(),
  unique (checkin_code_id, member_name)
);

create table if not exists public.club_checkin_pending (
  id uuid primary key default gen_random_uuid(),
  checkin_use_id uuid not null unique references public.club_checkin_uses(id) on delete cascade,
  checkin_code_id uuid not null references public.club_checkin_codes(id) on delete cascade,
  member_name text not null,
  submitted_by uuid not null,
  submitted_email text not null,
  created_at timestamptz not null default now()
);

-- 课程签到不需要签到码，先进入管理员审核队列。
create table if not exists public.club_course_checkin_requests (
  id uuid primary key default gen_random_uuid(),
  member_name text not null check (member_name ~ '^[一-龥]{2,20}$'),
  submitted_by uuid not null,
  submitted_email text not null,
  created_at timestamptz not null default now()
);

create index if not exists club_checkin_codes_expires_at_index
  on public.club_checkin_codes (expires_at desc);
create index if not exists club_checkin_uses_code_used_at_index
  on public.club_checkin_uses (checkin_code_id, used_at desc);
create index if not exists club_checkin_pending_created_at_index
  on public.club_checkin_pending (created_at desc);
create index if not exists club_course_checkin_requests_created_at_index
  on public.club_course_checkin_requests (created_at desc);
create index if not exists club_course_checkin_requests_name_index
  on public.club_course_checkin_requests (member_name);

alter table public.club_checkin_codes enable row level security;
alter table public.club_checkin_uses enable row level security;
alter table public.club_checkin_pending enable row level security;
alter table public.club_course_checkin_requests enable row level security;

-- 原子处理签到，避免同一签到码被并发重复使用。
create or replace function public.redeem_club_checkin(
  input_code text,
  input_name text,
  input_user_id uuid,
  input_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_code public.club_checkin_codes%rowtype;
  matched_member public.club_member_points%rowtype;
  matching_count integer;
  created_use public.club_checkin_uses%rowtype;
begin
  if input_code !~ '^[A-Z0-9]{6,20}$' then
    raise exception '签到码格式不正确。';
  end if;
  if input_name !~ '^[一-龥]{2,20}$' then
    raise exception '姓名必须为 2 到 20 个连续中文字符。';
  end if;

  select * into current_code
  from public.club_checkin_codes
  where code = input_code
  for update;

  if not found then
    raise exception '签到码无效。';
  end if;
  if current_code.expires_at <= now() then
    raise exception '签到码已过期。';
  end if;
  if current_code.usage_mode = 'global_once' and current_code.used_count > 0 then
    raise exception '该签到码已被使用。';
  end if;
  if exists (
    select 1 from public.club_checkin_uses
    where checkin_code_id = current_code.id and member_name = input_name
  ) then
    raise exception '你已使用过该签到码。';
  end if;

  select count(*) into matching_count
  from public.club_member_points
  where member_name = input_name;

  if matching_count = 1 then
    select * into matched_member
    from public.club_member_points
    where member_name = input_name;

    update public.club_member_points
    set points = points + current_code.points
    where id = matched_member.id;

    insert into public.club_checkin_uses (
      checkin_code_id, member_name, member_point_id, checked_in_by,
      checked_in_email, points_awarded
    ) values (
      current_code.id, input_name, matched_member.id, input_user_id,
      input_email, current_code.points
    ) returning * into created_use;

    update public.club_checkin_codes
    set used_count = used_count + 1
    where id = current_code.id;

    return jsonb_build_object(
      'status', 'awarded', 'points', current_code.points,
      'member_name', input_name, 'used_at', created_use.used_at
    );
  end if;

  insert into public.club_checkin_uses (
    checkin_code_id, member_name, checked_in_by, checked_in_email, points_awarded
  ) values (
    current_code.id, input_name, input_user_id, input_email, 0
  ) returning * into created_use;

  insert into public.club_checkin_pending (
    checkin_use_id, checkin_code_id, member_name, submitted_by, submitted_email
  ) values (
    created_use.id, current_code.id, input_name, input_user_id, input_email
  );

  update public.club_checkin_codes
  set used_count = used_count + 1
  where id = current_code.id;

  return jsonb_build_object(
    'status', 'pending', 'member_name', input_name,
    'message', '积分表中未找到唯一同名成员，已提交管理员处理。'
  );
end;
$$;

-- 确认课程签到：仅在积分榜中存在唯一同名成员时增加 2 分并移除申请。
create or replace function public.approve_club_course_checkin(input_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.club_course_checkin_requests%rowtype;
  matched_member public.club_member_points%rowtype;
  matching_count integer;
begin
  select * into request_row
  from public.club_course_checkin_requests
  where id = input_request_id
  for update;
  if not found then
    raise exception '未找到课程签到记录。';
  end if;

  select count(*) into matching_count
  from public.club_member_points
  where member_name = request_row.member_name;
  if matching_count <> 1 then
    raise exception '积分榜中不存在唯一同名成员，无法确认签到。';
  end if;

  select * into matched_member
  from public.club_member_points
  where member_name = request_row.member_name;
  update public.club_member_points
  set points = points + 2
  where id = matched_member.id;
  delete from public.club_course_checkin_requests where id = request_row.id;

  return jsonb_build_object('member_name', request_row.member_name, 'points_awarded', 2);
end;
$$;

-- 补录课程签到：仅在不存在唯一同名成员时创建积分榜成员、增加 2 分并移除申请。
create or replace function public.add_club_course_checkin_member(
  input_request_id uuid,
  input_class text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.club_course_checkin_requests%rowtype;
  matching_count integer;
  created_member public.club_member_points%rowtype;
begin
  if char_length(trim(input_class)) not between 1 and 40 then
    raise exception '班级需要为 1 到 40 个字符。';
  end if;

  select * into request_row
  from public.club_course_checkin_requests
  where id = input_request_id
  for update;
  if not found then
    raise exception '未找到课程签到记录。';
  end if;

  select count(*) into matching_count
  from public.club_member_points
  where member_name = request_row.member_name;
  if matching_count = 1 then
    raise exception '积分榜中已存在唯一同名成员，请直接确认签到。';
  end if;

  insert into public.club_member_points (member_name, member_class, points)
  values (request_row.member_name, trim(input_class), 2)
  returning * into created_member;
  delete from public.club_course_checkin_requests where id = request_row.id;

  return jsonb_build_object(
    'member_name', created_member.member_name,
    'member_class', created_member.member_class,
    'points_awarded', 2
  );
exception
  when unique_violation then
    raise exception '该姓名与班级组合已存在，请修改班级后重试。';
end;
$$;

revoke all on function public.redeem_club_checkin(text, text, uuid, text) from public;
revoke all on function public.approve_club_course_checkin(uuid) from public;
revoke all on function public.add_club_course_checkin_member(uuid, text) from public;
