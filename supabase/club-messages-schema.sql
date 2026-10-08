-- 独立社员留言箱
-- 读取与写入均通过 club-drive Edge Function 完成；前端不直接访问表。

create table if not exists public.club_member_messages (
  id uuid primary key default gen_random_uuid(),
  member_name text not null check (char_length(trim(member_name)) between 1 and 40),
  member_class text not null check (char_length(trim(member_class)) between 1 and 40),
  message_content text not null check (char_length(trim(message_content)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists club_member_messages_created_at_index
  on public.club_member_messages (created_at desc);

alter table public.club_member_messages enable row level security;

-- 不创建 anon / authenticated 的直接访问策略。
-- club-drive Edge Function 以 service_role 读取、写入和管理数据，并自行校验成员与社长权限。

create or replace function public.set_club_member_messages_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists club_member_messages_updated_at on public.club_member_messages;
create trigger club_member_messages_updated_at
before update on public.club_member_messages
for each row execute function public.set_club_member_messages_updated_at();
