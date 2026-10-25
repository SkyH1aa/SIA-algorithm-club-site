-- 模块启动器收藏 / 最近使用（跟随社团账号）
-- 在 Supabase SQL Editor 执行本脚本后，再部署 club-drive Edge Function。
--
-- 设计要点：
-- * 独立新表，不修改任何既有表；脚本幂等，可重复执行。
-- * 只授予 service_role，前端一律通过 club-drive 的鉴权动作读写，
--   anon / authenticated 永远拿不到别人的收藏。
-- * 一个用户一项一行，kind 区分收藏与最近使用；最近使用靠 updated_at 排序。
-- * 收藏上限 24、最近使用上限 6 由 Edge Function 与数据库触发器共同保证。

create table if not exists public.club_launcher_items (
  user_id uuid not null,
  kind text not null,
  item_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, kind, item_key),
  constraint club_launcher_items_kind_check
    check (kind in ('favorite', 'recent')),
  constraint club_launcher_items_key_check
    check (char_length(item_key) between 1 and 200)
);

create index if not exists club_launcher_items_user_kind_idx
  on public.club_launcher_items (user_id, kind, updated_at desc);

alter table public.club_launcher_items enable row level security;

drop policy if exists "deny all club_launcher_items" on public.club_launcher_items;
create policy "deny all club_launcher_items"
on public.club_launcher_items
for all
using (false)
with check (false);

revoke all on table public.club_launcher_items from public, anon, authenticated;
grant select, insert, update, delete on table public.club_launcher_items to service_role;


-- 裁剪：每次写入后把超出上限的旧行删掉。
-- 最近使用按更新时间保留最新 6 条，收藏保留最早收藏的 24 条
-- （收藏是用户主动选择的，超出时淘汰最早加入的，避免新收藏把旧收藏挤掉顺序混乱）。
create or replace function public.trim_club_launcher_items(
  p_user_id uuid,
  p_kind text
)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.club_launcher_items
  where user_id = p_user_id
    and kind = p_kind
    and item_key in (
      select item_key
      from public.club_launcher_items
      where user_id = p_user_id
        and kind = p_kind
      order by updated_at desc
      offset case when p_kind = 'recent' then 6 else 24 end
    );
$$;

revoke all on function public.trim_club_launcher_items(uuid, text) from public;
grant execute on function public.trim_club_launcher_items(uuid, text) to service_role;


-- 读取：返回两个有序数组，没有记录时返回空数组。
create or replace function public.get_club_launcher_items(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_favorites text[];
  v_recents text[];
begin
  if p_user_id is null then
    raise exception '您还不是算法社社员！';
  end if;

  select coalesce(array_agg(item_key order by updated_at desc), '{}')
  into v_favorites
  from public.club_launcher_items
  where user_id = p_user_id and kind = 'favorite';

  select coalesce(array_agg(item_key order by updated_at desc), '{}')
  into v_recents
  from public.club_launcher_items
  where user_id = p_user_id and kind = 'recent';

  return jsonb_build_object(
    'favorites', to_jsonb(v_favorites),
    'recents', to_jsonb(v_recents)
  );
end;
$$;

revoke all on function public.get_club_launcher_items(uuid) from public;
grant execute on function public.get_club_launcher_items(uuid) to service_role;


-- 收藏开关：幂等。favorite=true 时插入/刷新时间，false 时删除。
create or replace function public.set_club_launcher_favorite(
  p_user_id uuid,
  p_item_key text,
  p_favorite boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := trim(coalesce(p_item_key, ''));
begin
  if p_user_id is null then
    raise exception '您还不是算法社社员！';
  end if;
  if v_key = '' or char_length(v_key) > 200 then
    raise exception '收藏项不合法。';
  end if;

  if coalesce(p_favorite, false) then
    insert into public.club_launcher_items (user_id, kind, item_key, updated_at)
    values (p_user_id, 'favorite', v_key, timezone('utc', now()))
    on conflict (user_id, kind, item_key)
    do update set updated_at = timezone('utc', now());
    perform public.trim_club_launcher_items(p_user_id, 'favorite');
  else
    delete from public.club_launcher_items
    where user_id = p_user_id and kind = 'favorite' and item_key = v_key;
  end if;

  return jsonb_build_object('ok', true, 'favorite', coalesce(p_favorite, false));
end;
$$;

revoke all on function public.set_club_launcher_favorite(uuid, text, boolean) from public;
grant execute on function public.set_club_launcher_favorite(uuid, text, boolean) to service_role;


-- 最近使用：插入或刷新到最前，随后裁剪到 6 条。
create or replace function public.push_club_launcher_recent(
  p_user_id uuid,
  p_item_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := trim(coalesce(p_item_key, ''));
begin
  if p_user_id is null then
    raise exception '您还不是算法社社员！';
  end if;
  if v_key = '' or char_length(v_key) > 200 then
    raise exception '最近使用项不合法。';
  end if;

  insert into public.club_launcher_items (user_id, kind, item_key, updated_at)
  values (p_user_id, 'recent', v_key, timezone('utc', now()))
  on conflict (user_id, kind, item_key)
  do update set updated_at = timezone('utc', now());

  perform public.trim_club_launcher_items(p_user_id, 'recent');
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.push_club_launcher_recent(uuid, text) from public;
grant execute on function public.push_club_launcher_recent(uuid, text) to service_role;


-- 清空最近使用（收藏不受影响）。
create or replace function public.clear_club_launcher_recents(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception '您还不是算法社社员！';
  end if;

  delete from public.club_launcher_items
  where user_id = p_user_id and kind = 'recent';

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.clear_club_launcher_recents(uuid) from public;
grant execute on function public.clear_club_launcher_recents(uuid) to service_role;


-- 一次性迁移：把本机已有的收藏/最近使用写入账号（登录后的首次同步用）。
-- 只补不删，重复执行安全。
create or replace function public.merge_club_launcher_items(
  p_user_id uuid,
  p_favorites text[],
  p_recents text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if p_user_id is null then
    raise exception '您还不是算法社社员！';
  end if;

  if p_favorites is not null then
    foreach v_key in array p_favorites loop
      v_key := trim(coalesce(v_key, ''));
      continue when v_key = '' or char_length(v_key) > 200;
      insert into public.club_launcher_items (user_id, kind, item_key, updated_at)
      values (p_user_id, 'favorite', v_key, timezone('utc', now()))
      on conflict (user_id, kind, item_key) do nothing;
    end loop;
    perform public.trim_club_launcher_items(p_user_id, 'favorite');
  end if;

  if p_recents is not null then
    foreach v_key in array p_recents loop
      v_key := trim(coalesce(v_key, ''));
      continue when v_key = '' or char_length(v_key) > 200;
      insert into public.club_launcher_items (user_id, kind, item_key, updated_at)
      values (p_user_id, 'recent', v_key, timezone('utc', now()))
      on conflict (user_id, kind, item_key)
      do update set updated_at = timezone('utc', now());
    end loop;
    perform public.trim_club_launcher_items(p_user_id, 'recent');
  end if;

  return public.get_club_launcher_items(p_user_id);
end;
$$;

revoke all on function public.merge_club_launcher_items(uuid, text[], text[]) from public;
grant execute on function public.merge_club_launcher_items(uuid, text[], text[]) to service_role;
