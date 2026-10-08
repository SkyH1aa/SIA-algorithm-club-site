-- 全站服务运行开关。执行一次即可。
create table if not exists public.club_site_service_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  random_enabled boolean not null default false,
  report_zh text not null default '',
  report_en text not null default '',
  feature_settings jsonb not null default '{}'::jsonb,
  title_zh text not null default '网站暂不可用',
  subtitle_zh text not null default '网站暂不可用',
  title_en text not null default 'Website temporarily unavailable',
  subtitle_en text not null default 'Website temporarily unavailable',
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.club_site_service_settings(singleton, enabled)
values (true, true) on conflict (singleton) do nothing;
alter table public.club_site_service_settings add column if not exists random_enabled boolean not null default false;
alter table public.club_site_service_settings add column if not exists report_zh text not null default '';
alter table public.club_site_service_settings add column if not exists report_en text not null default '';
alter table public.club_site_service_settings add column if not exists feature_settings jsonb not null default '{}'::jsonb;
alter table public.club_site_service_settings enable row level security;
revoke all on table public.club_site_service_settings from anon, authenticated;

drop function if exists public.club_site_service_status();
create or replace function public.club_site_service_status()
returns table(enabled boolean, random_enabled boolean, title_zh text, subtitle_zh text, title_en text, subtitle_en text, report_zh text, report_en text, feature_settings jsonb)
language sql stable security definer set search_path = public
as $$ select enabled,random_enabled,title_zh,subtitle_zh,title_en,subtitle_en,report_zh,report_en,feature_settings
       from public.club_site_service_settings where singleton
       union all select true,false,'网站暂不可用','网站暂不可用','Website temporarily unavailable','Website temporarily unavailable','','','{}'::jsonb
       where not exists (select 1 from public.club_site_service_settings where singleton)
       limit 1 $$;

drop function if exists public.club_site_service_set(boolean,text,text,text,text,uuid);
drop function if exists public.club_site_service_set(boolean,boolean,text,text,text,text,uuid);
create or replace function public.club_site_service_set(
  p_enabled boolean, p_random_enabled boolean default false, p_title_zh text default null, p_subtitle_zh text default null,
  p_title_en text default null, p_subtitle_en text default null, p_report_zh text default null, p_report_en text default null, p_feature_settings jsonb default null, p_updated_by uuid default null
)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  update public.club_site_service_settings set
    enabled = coalesce(p_enabled, enabled), random_enabled = coalesce(p_random_enabled, random_enabled),
    title_zh = coalesce(nullif(left(trim(p_title_zh),200),''), '网站暂不可用'),
    subtitle_zh = coalesce(nullif(left(trim(p_subtitle_zh),500),''), '网站暂不可用'),
    title_en = coalesce(nullif(left(trim(p_title_en),200),''), 'Website temporarily unavailable'),
    subtitle_en = coalesce(nullif(left(trim(p_subtitle_en),500),''), 'Website temporarily unavailable'),
    report_zh = coalesce(left(coalesce(p_report_zh,''),10000), ''),
    report_en = coalesce(left(coalesce(p_report_en,''),10000), ''),
    feature_settings = coalesce(p_feature_settings, feature_settings),
    updated_at = now(), updated_by = p_updated_by where singleton;
  return found;
end $$;
revoke execute on function public.club_site_service_status() from public;
grant execute on function public.club_site_service_status() to anon, authenticated;
revoke execute on function public.club_site_service_set(boolean,boolean,text,text,text,text,text,text,jsonb,uuid) from public, anon, authenticated;

-- APPMonitor V7.5+ 发布版本（仅超管可通过 Edge Function 管理）
create table if not exists public.appmonitor_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  release_date date not null default current_date,
  intro_zh text not null default '',
  intro_en text not null default '',
  download_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.appmonitor_releases enable row level security;
revoke all on table public.appmonitor_releases from anon, authenticated;
create index if not exists appmonitor_releases_date_idx on public.appmonitor_releases(release_date desc, created_at desc);

drop function if exists public.appmonitor_releases_list();
create or replace function public.appmonitor_releases_list()
returns setof public.appmonitor_releases
language sql stable security definer set search_path = public
as $$ select * from public.appmonitor_releases order by release_date desc, created_at desc $$;
grant execute on function public.appmonitor_releases_list() to anon, authenticated;
