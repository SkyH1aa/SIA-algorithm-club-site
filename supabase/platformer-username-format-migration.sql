-- 《行于无垠》用户名格式迁移
-- 适用于已经部署过 platformer-schema.sql 及后续迁移的项目。
-- 只新增用户名格式约束，不重建登录、存档、服务开关、管理员或 PK 函数。
--
-- 新注册用户名规则：3-64 个中文、英文、数字或下划线字符；
-- 不允许空格及其他特殊符号。
-- NOT VALID 用于兼容历史账号；历史账号不会被强制改名，
-- 但之后新增或修改的用户名必须满足该规则。

begin;

do $$
begin
  if to_regclass('public.platformer_users') is null then
    raise exception '缺少 public.platformer_users，请先部署 platformer-schema.sql';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'platformer_users_username_format_check'
      and conrelid = 'public.platformer_users'::regclass
  ) then
    alter table public.platformer_users
      add constraint platformer_users_username_format_check
      check (
        char_length(username) between 3 and 64
        and username ~ '^[A-Za-z0-9_一-龥]{3,64}$'
      ) not valid;
  end if;
end
$$;

-- 修改用户名 RPC。
-- 通过复制账号记录并迁移所有已知关联表，避免 username 外键阻塞更新。
drop function if exists public.platformer_change_username(text, text, text);
create or replace function public.platformer_change_username(
  p_username text,
  p_token text,
  p_new_username text
)
returns table(username text, session_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  account_payload jsonb;
  new_token text;
begin
  if p_username is null or p_token is null or p_new_username is null then
    raise exception '用户名、会话或新用户名不能为空';
  end if;
  if char_length(p_new_username) not between 3 and 64
     or p_new_username !~ '^[A-Za-z0-9_一-龥]{3,64}$' then
    raise exception '用户名需为 3-64 位中文、英文、数字或下划线，不能包含空格和其他符号';
  end if;
  if p_new_username = p_username then
    raise exception '新用户名不能与当前用户名相同';
  end if;
  if exists (
    select 1 from public.platformer_users u
    where u.username = p_new_username
  ) then
    raise exception '新用户名已存在';
  end if;

  select to_jsonb(u)
    into account_payload
  from public.platformer_users u
  where u.username = p_username
    and u.session_token = p_token
  for update;

  if account_payload is null then
    raise exception '登录会话已失效，请重新登录';
  end if;

  new_token := encode(gen_random_bytes(24), 'hex');
  account_payload := account_payload
    || jsonb_build_object(
      'username', p_new_username,
      'session_token', new_token,
      'updated_at', now()
    );

  insert into public.platformer_users
    select (jsonb_populate_record(null::public.platformer_users, account_payload)).*;

  if to_regclass('public.platformer_progress') is not null then
    update public.platformer_progress
    set username = p_new_username
    where username = p_username;
  end if;
  if to_regclass('public.platformer_event_claims') is not null then
    update public.platformer_event_claims
    set username = p_new_username
    where username = p_username;
  end if;
  if to_regclass('public.platformer_announcement_claims') is not null then
    update public.platformer_announcement_claims
    set username = p_new_username
    where username = p_username;
  end if;
  if to_regclass('public.platformer_pk_rooms') is not null then
    update public.platformer_pk_rooms
    set host_username = p_new_username
    where host_username = p_username;
    update public.platformer_pk_rooms
    set guest_username = p_new_username
    where guest_username = p_username;
  end if;
  if to_regclass('public.platformer_pk_members') is not null then
    update public.platformer_pk_members
    set username = p_new_username
    where username = p_username;
  end if;
  if to_regclass('public.platformer_pk_matches') is not null then
    update public.platformer_pk_matches
    set winner_username = p_new_username
    where winner_username = p_username;
  end if;
  if to_regclass('public.platformer_pk_coin_ledger') is not null then
    update public.platformer_pk_coin_ledger
    set username = p_new_username
    where username = p_username;
  end if;
  if to_regclass('public.platformer_announcements') is not null then
    update public.platformer_announcements
    set created_by = p_new_username
    where created_by = p_username;
    update public.platformer_announcements
    set updated_by = p_new_username
    where updated_by = p_username;
  end if;
  if to_regclass('public.platformer_service_settings') is not null then
    update public.platformer_service_settings
    set updated_by = p_new_username
    where updated_by = p_username;
  end if;

  delete from public.platformer_users
  where username = p_username;

  return query select p_new_username, new_token;
end;
$$;

revoke execute on function public.platformer_change_username(text, text, text) from public;
grant execute on function public.platformer_change_username(text, text, text) to anon, authenticated;

commit;
