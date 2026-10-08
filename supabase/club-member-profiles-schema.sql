-- 社员资料绑定表（独立新表，不修改旧表结构）
-- 用于把社团盘登录账号绑定到中文姓名与班级。
-- 注意：club_member_points.id 实际类型为 uuid。

-- 若上次因类型错误建表失败，可直接重新执行本脚本。
drop table if exists public.club_member_profiles cascade;

create table public.club_member_profiles (
  user_id uuid primary key,
  username text not null,
  email text not null,
  member_name text not null,
  member_class text not null,
  points_member_id uuid not null references public.club_member_points (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint club_member_profiles_username_check check (char_length(trim(username)) between 1 and 64),
  constraint club_member_profiles_email_check check (char_length(trim(email)) between 3 and 254),
  constraint club_member_profiles_name_chinese check (member_name ~ '^[一-龥]{2,20}$'),
  constraint club_member_profiles_class_check check (char_length(trim(member_class)) between 1 and 40)
);

create unique index if not exists club_member_profiles_member_name_uidx
  on public.club_member_profiles (member_name);

create unique index if not exists club_member_profiles_points_member_id_uidx
  on public.club_member_profiles (points_member_id);

create index if not exists club_member_profiles_email_idx
  on public.club_member_profiles (email);

alter table public.club_member_profiles enable row level security;

drop policy if exists "deny all club_member_profiles" on public.club_member_profiles;
create policy "deny all club_member_profiles"
on public.club_member_profiles
for all
using (false)
with check (false);

create or replace function public.get_club_member_profile(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.club_member_profiles%rowtype;
  v_points public.club_member_points%rowtype;
begin
  if p_user_id is null then
    raise exception '您还不是算法社社员！';
  end if;

  select *
  into v_profile
  from public.club_member_profiles
  where user_id = p_user_id;

  if not found then
    return jsonb_build_object(
      'bound', false,
      'profile', null
    );
  end if;

  select *
  into v_points
  from public.club_member_points
  where id = v_profile.points_member_id;

  return jsonb_build_object(
    'bound', true,
    'profile', jsonb_build_object(
      'user_id', v_profile.user_id,
      'username', v_profile.username,
      'email', v_profile.email,
      'member_name', v_profile.member_name,
      'member_class', v_profile.member_class,
      'points_member_id', v_profile.points_member_id,
      'points', coalesce(v_points.points, 0),
      'points_updated_at', v_points.updated_at,
      'created_at', v_profile.created_at,
      'updated_at', v_profile.updated_at
    )
  );
end;
$$;

revoke all on function public.get_club_member_profile(uuid) from public;
grant execute on function public.get_club_member_profile(uuid) to service_role;

create or replace function public.bind_club_member_profile(
  p_user_id uuid,
  p_email text,
  p_member_name text,
  p_member_class text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_username text;
  v_member_name text := trim(coalesce(p_member_name, ''));
  v_member_class text := trim(coalesce(p_member_class, ''));
  v_match_count integer := 0;
  v_points public.club_member_points%rowtype;
  v_existing public.club_member_profiles%rowtype;
  v_name_owner public.club_member_profiles%rowtype;
  v_created_points boolean := false;
begin
  if p_user_id is null then
    raise exception '您还不是算法社社员！';
  end if;

  if v_email = '' then
    raise exception '当前账号缺少邮箱信息，无法绑定资料。';
  end if;

  v_username := split_part(v_email, '@', 1);
  if v_username = '' then
    v_username := v_email;
  end if;

  if v_member_name !~ '^[一-龥]{2,20}$' then
    raise exception '姓名必须是 2 到 20 个连续中文字符。';
  end if;

  if char_length(v_member_class) < 1 or char_length(v_member_class) > 40 then
    raise exception '班级长度必须在 1 到 40 个字符之间。';
  end if;

  select *
  into v_existing
  from public.club_member_profiles
  where user_id = p_user_id;

  select *
  into v_name_owner
  from public.club_member_profiles
  where member_name = v_member_name;

  if found and v_name_owner.user_id <> p_user_id then
    raise exception '该中文姓名已被其他账号绑定，请联系管理员。';
  end if;

  select count(*)
  into v_match_count
  from public.club_member_points
  where member_name = v_member_name;

  if v_match_count > 1 then
    raise exception '积分榜中存在多个同名记录，请联系管理员处理后再绑定。';
  end if;

  if v_match_count = 1 then
    select *
    into v_points
    from public.club_member_points
    where member_name = v_member_name
    limit 1;

    if exists (
      select 1
      from public.club_member_profiles
      where points_member_id = v_points.id
        and user_id <> p_user_id
    ) then
      raise exception '该积分榜记录已被其他账号绑定，请联系管理员。';
    end if;

    update public.club_member_points
    set member_class = v_member_class,
        updated_at = timezone('utc', now())
    where id = v_points.id
    returning * into v_points;
  else
    insert into public.club_member_points (member_name, member_class, points)
    values (v_member_name, v_member_class, 0)
    returning * into v_points;
    v_created_points := true;
  end if;

  insert into public.club_member_profiles (
    user_id,
    username,
    email,
    member_name,
    member_class,
    points_member_id
  )
  values (
    p_user_id,
    v_username,
    v_email,
    v_member_name,
    v_member_class,
    v_points.id
  )
  on conflict (user_id) do update
  set username = excluded.username,
      email = excluded.email,
      member_name = excluded.member_name,
      member_class = excluded.member_class,
      points_member_id = excluded.points_member_id,
      updated_at = timezone('utc', now())
  returning * into v_existing;

  return jsonb_build_object(
    'bound', true,
    'created_points', v_created_points,
    'profile', jsonb_build_object(
      'user_id', v_existing.user_id,
      'username', v_existing.username,
      'email', v_existing.email,
      'member_name', v_existing.member_name,
      'member_class', v_existing.member_class,
      'points_member_id', v_existing.points_member_id,
      'points', v_points.points,
      'points_updated_at', v_points.updated_at,
      'created_at', v_existing.created_at,
      'updated_at', v_existing.updated_at
    )
  );
end;
$$;

revoke all on function public.bind_club_member_profile(uuid, text, text, text) from public;
grant execute on function public.bind_club_member_profile(uuid, text, text, text) to service_role;
