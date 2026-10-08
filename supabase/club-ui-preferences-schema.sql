-- 社员界面偏好（主题等），独立新表，不修改旧资料表结构。
-- 在 Supabase SQL Editor 执行本脚本后，再部署 club-drive Edge Function。

create table if not exists public.club_ui_preferences (
  user_id uuid primary key,
  theme_mode text not null default 'auto',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint club_ui_preferences_theme_mode_check
    check (theme_mode in ('auto', 'light', 'dark'))
);

alter table public.club_ui_preferences enable row level security;

drop policy if exists "deny all club_ui_preferences" on public.club_ui_preferences;
create policy "deny all club_ui_preferences"
on public.club_ui_preferences
for all
using (false)
with check (false);

create or replace function public.get_club_ui_preferences(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.club_ui_preferences%rowtype;
begin
  if p_user_id is null then
    raise exception '您还不是算法社社员！';
  end if;

  select *
  into v_row
  from public.club_ui_preferences
  where user_id = p_user_id;

  if not found then
    return jsonb_build_object(
      'theme_mode', 'auto',
      'exists', false
    );
  end if;

  return jsonb_build_object(
    'theme_mode', v_row.theme_mode,
    'exists', true,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.get_club_ui_preferences(uuid) from public;
grant execute on function public.get_club_ui_preferences(uuid) to service_role;

create or replace function public.set_club_ui_theme_mode(
  p_user_id uuid,
  p_theme_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := lower(trim(coalesce(p_theme_mode, '')));
  v_row public.club_ui_preferences%rowtype;
begin
  if p_user_id is null then
    raise exception '您还不是算法社社员！';
  end if;

  if v_mode not in ('auto', 'light', 'dark') then
    raise exception '主题偏好只能是 auto、light 或 dark。';
  end if;

  insert into public.club_ui_preferences (user_id, theme_mode)
  values (p_user_id, v_mode)
  on conflict (user_id) do update
  set theme_mode = excluded.theme_mode,
      updated_at = timezone('utc', now())
  returning * into v_row;

  return jsonb_build_object(
    'theme_mode', v_row.theme_mode,
    'exists', true,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.set_club_ui_theme_mode(uuid, text) from public;
grant execute on function public.set_club_ui_theme_mode(uuid, text) to service_role;
