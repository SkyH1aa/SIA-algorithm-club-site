-- 社团盘容量配额（独立新表，不修改任何既有表结构）
-- 在 Supabase SQL Editor 执行本脚本后，再部署 club-drive Edge Function。
--
-- 设计：
-- * 每个用户在社团盘里有一个以 user_<uuid> 命名的专属目录。
-- * 超管可以给单个用户设配额，也可以设全局默认配额（user_id 为 null 的那一行）。
-- * 只记录「上限」，实际用量由 Edge Function 实时遍历 WebDAV 目录统计，
--   避免本地缓存与实际文件不一致。

create table if not exists public.club_drive_quotas (
  id uuid primary key default gen_random_uuid(),
  -- null 表示全局默认配额；非 null 表示该用户的专属配额。
  user_id uuid,
  -- 上限字节数：
  --   -1 = 禁止使用社团盘（不可上传、不可归档）
  --    0 = 不限制
  --   >0 = 上限
  max_bytes bigint not null default 0,
  note text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint club_drive_quotas_max_bytes_check check (max_bytes >= -1),
  constraint club_drive_quotas_note_check check (char_length(note) <= 200)
);

-- 一个用户只能有一条专属配额；全局默认最多一条（user_id 为 null）。
create unique index if not exists club_drive_quotas_user_uidx
  on public.club_drive_quotas (user_id)
  where user_id is not null;

create unique index if not exists club_drive_quotas_global_uidx
  on public.club_drive_quotas ((true))
  where user_id is null;

alter table public.club_drive_quotas enable row level security;

drop policy if exists "deny all club_drive_quotas" on public.club_drive_quotas;
create policy "deny all club_drive_quotas"
on public.club_drive_quotas
for all
using (false)
with check (false);

revoke all on table public.club_drive_quotas from public, anon, authenticated;
grant select, insert, update, delete on table public.club_drive_quotas to service_role;


-- 读取某用户生效的配额：优先专属，其次全局默认，都没有则不限制。
create or replace function public.get_club_drive_quota(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_own public.club_drive_quotas%rowtype;
  v_global public.club_drive_quotas%rowtype;
begin
  if p_user_id is not null then
    select * into v_own from public.club_drive_quotas where user_id = p_user_id;
    if found then
      return jsonb_build_object('max_bytes', v_own.max_bytes, 'source', 'user', 'note', v_own.note,
                                'blocked', v_own.max_bytes = -1);
    end if;
  end if;

  select * into v_global from public.club_drive_quotas where user_id is null;
  if found then
    return jsonb_build_object('max_bytes', v_global.max_bytes, 'source', 'global', 'note', v_global.note,
                              'blocked', v_global.max_bytes = -1);
  end if;

  return jsonb_build_object('max_bytes', 0, 'source', 'none', 'note', '', 'blocked', false);
end;
$$;

revoke all on function public.get_club_drive_quota(uuid) from public;
grant execute on function public.get_club_drive_quota(uuid) to service_role;


-- 写入配额（user_id 传 null 即设置全局默认）。
create or replace function public.set_club_drive_quota(
  p_user_id uuid,
  p_max_bytes bigint,
  p_note text,
  p_updated_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := coalesce(trim(p_note), '');
begin
  if p_max_bytes is null or p_max_bytes < -1 then
    raise exception '容量上限必须 ≥ -1（-1 表示禁止使用）。';
  end if;
  if char_length(v_note) > 200 then
    raise exception '备注最多 200 个字符。';
  end if;

  if p_user_id is null then
    update public.club_drive_quotas
       set max_bytes = p_max_bytes, note = v_note, updated_by = p_updated_by, updated_at = timezone('utc', now())
     where user_id is null;
    if not found then
      insert into public.club_drive_quotas (user_id, max_bytes, note, updated_by)
      values (null, p_max_bytes, v_note, p_updated_by);
    end if;
  else
    insert into public.club_drive_quotas (user_id, max_bytes, note, updated_by, updated_at)
    values (p_user_id, p_max_bytes, v_note, p_updated_by, timezone('utc', now()))
    on conflict (user_id) where user_id is not null do update set
      max_bytes = excluded.max_bytes,
      note = excluded.note,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;
  end if;

  return public.get_club_drive_quota(p_user_id);
end;
$$;

revoke all on function public.set_club_drive_quota(uuid, bigint, text, uuid) from public;
grant execute on function public.set_club_drive_quota(uuid, bigint, text, uuid) to service_role;


-- 删除某用户的专属配额，回落到全局默认。
create or replace function public.clear_club_drive_quota(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception '缺少用户标识。';
  end if;
  delete from public.club_drive_quotas where user_id = p_user_id;
  return public.get_club_drive_quota(p_user_id);
end;
$$;

revoke all on function public.clear_club_drive_quota(uuid) from public;
grant execute on function public.clear_club_drive_quota(uuid) to service_role;
