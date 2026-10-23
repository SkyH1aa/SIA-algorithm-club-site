-- 故障页（502 / 503 / 404）的自定义文案与展示方式。
-- 在 Supabase SQL Editor 执行本脚本；可重复执行。
--
-- 设计要点：
-- * 页面结构固定在 502.html / 503.html / 404.html 里，超管只能改文案字段与 Markdown 正文，
--   不能注入任意 HTML/脚本（避免同源脚本注入，也避免把故障页改坏后无法恢复）。
-- * 每个功能开关可以单独选择「遮罩」或「跳转到 502/503/404」；
--   站点总开关关闭时，由总开关自己的 display_mode 统一决定，忽略各功能自己的设置。

create table if not exists public.club_error_pages (
  -- 502 / 503 / 404，只允许这三个。
  code smallint primary key,
  title_zh text not null default '',
  title_en text not null default '',
  subtitle_zh text not null default '',
  subtitle_en text not null default '',
  -- Markdown 正文；渲染时只支持标题/列表/链接/代码/表格等安全子集。
  body_zh text not null default '',
  body_en text not null default '',
  -- 主按钮文案与链接；留空则用页面内置默认值。
  action_label_zh text not null default '',
  action_label_en text not null default '',
  action_href text not null default '',
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid,
  constraint club_error_pages_code_check check (code in (502, 503, 404)),
  constraint club_error_pages_title_check check (char_length(title_zh) <= 200 and char_length(title_en) <= 200),
  constraint club_error_pages_subtitle_check check (char_length(subtitle_zh) <= 500 and char_length(subtitle_en) <= 500),
  constraint club_error_pages_body_check check (char_length(body_zh) <= 20000 and char_length(body_en) <= 20000),
  constraint club_error_pages_action_check check (char_length(action_href) <= 500 and char_length(action_label_zh) <= 80 and char_length(action_label_en) <= 80)
);

-- 默认模板：首次执行时写入，之后不再覆盖超管的修改。
insert into public.club_error_pages (code, title_zh, title_en, subtitle_zh, subtitle_en, body_zh, body_en, action_label_zh, action_label_en, action_href)
values
  (404,
   '这个页面不存在',
   'This page does not exist',
   '链接可能已经失效，或者地址输入有误。',
   'The link may have expired, or the address was mistyped.',
   E'## 可以试试\n\n- 返回首页，从首页重新进入需要的模块\n- 打开「社团功能」总览，找到你要的页面\n- 如果你是从收藏夹进来的，链接可能已经更新',
   E'## Try this\n\n- Go back to the home page and navigate from there\n- Open the club features overview to find what you need\n- If you came from a bookmark, the link may have changed',
   '返回首页', 'Back to home', 'index.html'),
  (502,
   '上游服务暂时不可用',
   'Upstream service unavailable',
   '网站本身正常，但它依赖的一个服务（例如 AI 模型或数据库）返回了异常。',
   'The site itself is fine, but a service it depends on (such as an AI model or the database) returned an error.',
   E'## 这是什么意思\n\n502 表示**网关从上游收到了无效响应**。通常是临时的。\n\n## 你可以做什么\n\n- 等待一两分钟后刷新重试\n- 如果是 AI 对话，换一个模型再试\n- 反复出现时，把时间和操作步骤告诉管理员',
   E'## What this means\n\n502 means **the gateway received an invalid response from upstream**. It is usually temporary.\n\n## What you can do\n\n- Wait a minute or two, then refresh\n- If this is AI chat, try another model\n- If it keeps happening, tell an admin the time and what you were doing',
   '重试', 'Retry', ''),
  (503,
   '网站暂时停止服务',
   'The site is temporarily unavailable',
   '管理员正在维护或临时关闭了这项服务，请稍后再来。',
   'An administrator is maintaining or has temporarily disabled this service. Please check back later.',
   E'## 说明\n\n这是**管理员主动关闭**，不是故障。\n\n- 已保存的数据不受影响\n- 服务恢复后本页会自动可用\n- 紧急情况请联系社团管理员',
   E'## Notes\n\nThis is a **deliberate shutdown by an administrator**, not a failure.\n\n- Saved data is unaffected\n- This page becomes usable again once service resumes\n- Contact a club admin if it is urgent',
   '返回首页', 'Back to home', 'index.html')
on conflict (code) do nothing;

alter table public.club_error_pages enable row level security;
revoke all on table public.club_error_pages from anon, authenticated;

-- 公开读取（这三页本来就要给所有访客看，不含敏感字段）。
drop function if exists public.club_error_pages_get();
create or replace function public.club_error_pages_get()
returns setof public.club_error_pages
language sql stable security definer set search_path = public
as $$ select * from public.club_error_pages order by code $$;
revoke execute on function public.club_error_pages_get() from public;
grant execute on function public.club_error_pages_get() to anon, authenticated;

-- 超管保存（经 Edge Function 调用，函数本身只接受 service_role）。
drop function if exists public.club_error_pages_set(smallint,text,text,text,text,text,text,text,text,text,uuid);
create or replace function public.club_error_pages_set(
  p_code smallint,
  p_title_zh text, p_title_en text,
  p_subtitle_zh text, p_subtitle_en text,
  p_body_zh text, p_body_en text,
  p_action_label_zh text, p_action_label_en text,
  p_action_href text,
  p_updated_by uuid default null
)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if p_code not in (502, 503, 404) then
    raise exception '只支持 502 / 503 / 404。';
  end if;

  insert into public.club_error_pages (
    code, title_zh, title_en, subtitle_zh, subtitle_en, body_zh, body_en,
    action_label_zh, action_label_en, action_href, updated_at, updated_by
  ) values (
    p_code,
    coalesce(left(trim(p_title_zh), 200), ''),
    coalesce(left(trim(p_title_en), 200), ''),
    coalesce(left(trim(p_subtitle_zh), 500), ''),
    coalesce(left(trim(p_subtitle_en), 500), ''),
    coalesce(left(coalesce(p_body_zh, ''), 20000), ''),
    coalesce(left(coalesce(p_body_en, ''), 20000), ''),
    coalesce(left(trim(p_action_label_zh), 80), ''),
    coalesce(left(trim(p_action_label_en), 80), ''),
    coalesce(left(trim(p_action_href), 500), ''),
    timezone('utc', now()), p_updated_by
  )
  on conflict (code) do update set
    title_zh = excluded.title_zh,
    title_en = excluded.title_en,
    subtitle_zh = excluded.subtitle_zh,
    subtitle_en = excluded.subtitle_en,
    body_zh = excluded.body_zh,
    body_en = excluded.body_en,
    action_label_zh = excluded.action_label_zh,
    action_label_en = excluded.action_label_en,
    action_href = excluded.action_href,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  return true;
end;
$$;
revoke execute on function public.club_error_pages_set(smallint,text,text,text,text,text,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.club_error_pages_set(smallint,text,text,text,text,text,text,text,text,text,uuid) to service_role;

-- 恢复某一页的默认文案（删掉自定义后由前端内置默认值兜底）。
drop function if exists public.club_error_pages_reset(smallint);
create or replace function public.club_error_pages_reset(p_code smallint)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if p_code not in (502, 503, 404) then
    raise exception '只支持 502 / 503 / 404。';
  end if;
  update public.club_error_pages set
    title_zh = '', title_en = '', subtitle_zh = '', subtitle_en = '',
    body_zh = '', body_en = '', action_label_zh = '', action_label_en = '',
    action_href = '', updated_at = timezone('utc', now())
  where code = p_code;
  return found;
end;
$$;
revoke execute on function public.club_error_pages_reset(smallint) from public, anon, authenticated;
grant execute on function public.club_error_pages_reset(smallint) to service_role;


-- 站点总开关与每个功能开关的「展示方式」。
-- display_mode 取值：
--   'overlay' —— 全屏遮罩（默认，现有行为）
--   '502' / '503' / '404' —— 跳转到对应故障页
alter table public.club_site_service_settings
  add column if not exists display_mode text not null default 'overlay';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'club_site_service_settings_display_mode_check'
  ) then
    alter table public.club_site_service_settings
      add constraint club_site_service_settings_display_mode_check
      check (display_mode in ('overlay', '502', '503', '404'));
  end if;
end $$;
