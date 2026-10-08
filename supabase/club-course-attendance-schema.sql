-- 课程签到日统计：请在 Supabase SQL Editor 中执行一次。
-- 记录管理员确认后的课程签到，不受申请记录删除影响。
create table if not exists public.club_course_checkin_attendance (
  id uuid primary key default gen_random_uuid(),
  member_name text not null check (member_name ~ '^[一-龥]{2,20}$'),
  member_class text not null check (char_length(trim(member_class)) between 1 and 40),
  checked_in_at timestamptz not null default now(),
  source_request_id uuid unique,
  created_at timestamptz not null default now()
);

create index if not exists club_course_checkin_attendance_checked_in_at_index
  on public.club_course_checkin_attendance (checked_in_at desc);
create index if not exists club_course_checkin_attendance_date_index
  on public.club_course_checkin_attendance ((checked_in_at at time zone 'Asia/Shanghai'));
alter table public.club_course_checkin_attendance enable row level security;

-- 替换原确认函数：加分与写入日签到记录在同一事务中完成。
create or replace function public.approve_club_course_checkin(input_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  request_row public.club_course_checkin_requests%rowtype;
  matched_member public.club_member_points%rowtype;
  matching_count integer;
  attendance_row public.club_course_checkin_attendance%rowtype;
begin
  select * into request_row from public.club_course_checkin_requests where id = input_request_id for update;
  if not found then raise exception '未找到课程签到记录。'; end if;
  select count(*) into matching_count from public.club_member_points where member_name = request_row.member_name;
  if matching_count <> 1 then raise exception '积分榜中不存在唯一同名成员，无法确认签到。'; end if;
  select * into matched_member from public.club_member_points where member_name = request_row.member_name;
  update public.club_member_points set points = points + 2 where id = matched_member.id;
  insert into public.club_course_checkin_attendance (member_name, member_class, source_request_id)
    values (matched_member.member_name, matched_member.member_class, request_row.id)
    returning * into attendance_row;
  delete from public.club_course_checkin_requests where id = request_row.id;
  return jsonb_build_object('member_name', request_row.member_name, 'member_class', matched_member.member_class, 'points_awarded', 2, 'checked_in_at', attendance_row.checked_in_at);
end;
$$;
revoke all on function public.approve_club_course_checkin(uuid) from public;

-- 补录成员并确认课程签到时同样写入日统计。
create or replace function public.add_club_course_checkin_member(input_request_id uuid, input_class text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  request_row public.club_course_checkin_requests%rowtype;
  matching_count integer;
  created_member public.club_member_points%rowtype;
  attendance_row public.club_course_checkin_attendance%rowtype;
begin
  if char_length(trim(input_class)) not between 1 and 40 then raise exception '班级需要为 1 到 40 个字符。'; end if;
  select * into request_row from public.club_course_checkin_requests where id = input_request_id for update;
  if not found then raise exception '未找到课程签到记录。'; end if;
  select count(*) into matching_count from public.club_member_points where member_name = request_row.member_name;
  if matching_count = 1 then raise exception '积分榜中已存在唯一同名成员，请直接确认签到。'; end if;
  insert into public.club_member_points (member_name, member_class, points) values (request_row.member_name, trim(input_class), 2) returning * into created_member;
  insert into public.club_course_checkin_attendance (member_name, member_class, source_request_id) values (created_member.member_name, created_member.member_class, request_row.id) returning * into attendance_row;
  delete from public.club_course_checkin_requests where id = request_row.id;
  return jsonb_build_object('member_name', created_member.member_name, 'member_class', created_member.member_class, 'points_awarded', 2, 'checked_in_at', attendance_row.checked_in_at);
exception when unique_violation then raise exception '该姓名与班级组合已存在，请修改班级后重试。';
end;
$$;
revoke all on function public.add_club_course_checkin_member(uuid, text) from public;
