-- 《行于无垠》联机 PK 第一版
-- 前置：platformer-schema.sql、platformer-service-control-migration.sql
-- 本文件使用现有 username + session_token 账号体系；所有写操作必须经过下方 RPC。

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.platformer_pk_rooms (
  room_id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  invite_code_hash text not null unique,
  host_username text not null references public.platformer_users(username) on delete cascade,
  guest_username text references public.platformer_users(username) on delete set null,
  status text not null default 'waiting' check (status in ('waiting','paired','started','finished','cancelled','disputed')),
  match_id uuid,
  seed bigint not null default 0,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platformer_pk_members (
  room_id uuid not null references public.platformer_pk_rooms(room_id) on delete cascade,
  username text not null references public.platformer_users(username) on delete cascade,
  role text not null check (role in ('host','guest')),
  accepted boolean not null default false,
  ready boolean not null default false,
  wager bigint not null default 0 check (wager between 0 and 1000000),
  wager_locked boolean not null default false,
  result_submitted boolean not null default false,
  result_won boolean,
  joined_at timestamptz not null default now(),
  primary key (room_id, username),
  unique (room_id, role)
);

create table if not exists public.platformer_pk_matches (
  match_id uuid primary key default gen_random_uuid(),
  room_id uuid not null unique references public.platformer_pk_rooms(room_id) on delete cascade,
  seed bigint not null,
  status text not null default 'started' check (status in ('started','finished','cancelled','disputed')),
  winner_username text references public.platformer_users(username) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.platformer_pk_coin_ledger (
  ledger_id bigint generated always as identity primary key,
  username text not null references public.platformer_users(username) on delete cascade,
  room_id uuid references public.platformer_pk_rooms(room_id) on delete set null,
  match_id uuid references public.platformer_pk_matches(match_id) on delete set null,
  amount bigint not null,
  reason text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

alter table public.platformer_pk_rooms enable row level security;
alter table public.platformer_pk_members enable row level security;
alter table public.platformer_pk_matches enable row level security;
alter table public.platformer_pk_coin_ledger enable row level security;
revoke all on table public.platformer_pk_rooms, public.platformer_pk_members, public.platformer_pk_matches, public.platformer_pk_coin_ledger from anon, authenticated;

create or replace function public.platformer_pk_session_valid(p_username text, p_token text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists(select 1 from public.platformer_users u where u.username=p_username and u.session_token=p_token);
$$;

create or replace function public.platformer_pk_room_snapshot(p_username text, p_token text, p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r public.platformer_pk_rooms; members jsonb;
begin
  if not public.platformer_pk_session_valid(p_username,p_token) then raise exception '登录会话已失效，请重新登录'; end if;
  select * into r from public.platformer_pk_rooms where room_id=p_room_id and (host_username=p_username or guest_username=p_username);
  if not found then raise exception '房间不存在或你不在该房间'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('username',m.username,'role',m.role,'accepted',m.accepted,'ready',m.ready,'wager',m.wager,'wager_locked',m.wager_locked,'result_submitted',m.result_submitted,'result_won',m.result_won) order by m.role), '[]'::jsonb) into members from public.platformer_pk_members m where m.room_id=r.room_id;
  return jsonb_build_object('id',r.room_id,'room_id',r.room_id,'invite_code',r.invite_code,'status',r.status,'match_id',r.match_id,'winner_username',(select winner_username from public.platformer_pk_matches where match_id=r.match_id),'seed',r.seed,'expires_at',r.expires_at,'members',members);
end;
$$;

create or replace function public.platformer_pk_create_room(p_username text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare code text; hash text; rid uuid; r public.platformer_pk_rooms;
begin
  if not public.platformer_pk_session_valid(p_username,p_token) then raise exception '登录会话已失效，请重新登录'; end if;
  if not public.platformer_service_is_open() and p_username <> 'chm' then raise exception '服务器升级维护中，请稍后再试'; end if;
  update public.platformer_pk_rooms set status='cancelled',updated_at=now() where host_username=p_username and status in ('waiting','paired') and expires_at<now();
  loop
    code=upper(substr(encode(gen_random_bytes(6),'hex'),1,8));
    hash=crypt(code,gen_salt('bf'));
    begin
      insert into public.platformer_pk_rooms(invite_code,invite_code_hash,host_username,seed) values(code,hash,p_username, floor(random()*9223372036854775807)::bigint) returning * into r;
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  insert into public.platformer_pk_members(room_id,username,role,accepted) values(r.room_id,p_username,'host',true);
  return public.platformer_pk_room_snapshot(p_username,p_token,r.room_id);
end;
$$;

create or replace function public.platformer_pk_join_room(p_username text, p_token text, p_invite_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r public.platformer_pk_rooms;
begin
  if not public.platformer_pk_session_valid(p_username,p_token) then raise exception '登录会话已失效，请重新登录'; end if;
  if not public.platformer_service_is_open() and p_username <> 'chm' then raise exception '服务器升级维护中，请稍后再试'; end if;
  select * into r from public.platformer_pk_rooms where status='waiting' and expires_at>now() and invite_code_hash=crypt(upper(trim(p_invite_code)),invite_code_hash) for update;
  if not found then raise exception '邀请码无效、已过期或房间已有人加入'; end if;
  if r.host_username=p_username then raise exception '不能加入自己创建的房间'; end if;
  update public.platformer_pk_rooms set guest_username=p_username,status='paired',updated_at=now() where room_id=r.room_id;
  insert into public.platformer_pk_members(room_id,username,role,accepted) values(r.room_id,p_username,'guest',false);
  return public.platformer_pk_room_snapshot(p_username,p_token,r.room_id);
end;
$$;

create or replace function public.platformer_pk_accept_invite(p_username text, p_token text, p_room_id uuid)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.platformer_pk_session_valid(p_username,p_token) then raise exception '登录会话已失效，请重新登录'; end if;
  update public.platformer_pk_members set accepted=true,ready=false where room_id=p_room_id and username=p_username and role='guest';
  if not found then raise exception '只有被邀请的对手可以接受邀请'; end if;
  update public.platformer_pk_rooms set updated_at=now() where room_id=p_room_id and status='paired';
  return true;
end;
$$;

create or replace function public.platformer_pk_lock_wager(p_username text, p_token text, p_room_id uuid, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare m public.platformer_pk_members; u public.platformer_users; amount bigint:=coalesce(p_amount,0); key text;
begin
  if not public.platformer_pk_session_valid(p_username,p_token) then raise exception '登录会话已失效，请重新登录'; end if;
  if amount<0 or amount>1000000 then raise exception '押注必须在 0 到 1000000 金币之间'; end if;
  select * into m from public.platformer_pk_members where room_id=p_room_id and username=p_username for update;
  if not found then raise exception '你不在该房间'; end if;
  if m.wager_locked then return jsonb_build_object('amount',m.wager,'locked',true); end if;
  select * into u from public.platformer_users where username=p_username for update;
  if amount>u.coins then raise exception '金币不足，当前可用金币：%',u.coins; end if;
  if amount>0 then
    update public.platformer_users set coins=coins-amount,updated_at=now() where username=p_username;
    key:=format('pk-lock-%s-%s',p_room_id,p_username);
    insert into public.platformer_pk_coin_ledger(username,room_id,amount,reason,idempotency_key) values(p_username,p_room_id,-amount,'PK押注锁定',key) on conflict(idempotency_key) do nothing;
  end if;
  update public.platformer_pk_members set wager=amount,wager_locked=true,ready=false where room_id=p_room_id and username=p_username;
  return jsonb_build_object('amount',amount,'locked',true);
end;
$$;

create or replace function public.platformer_pk_set_ready(p_username text, p_token text, p_room_id uuid, p_ready boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare ready_count bigint; locked_count bigint; r public.platformer_pk_rooms; mid uuid;
begin
  if not public.platformer_pk_session_valid(p_username,p_token) then raise exception '登录会话已失效，请重新登录'; end if;
  update public.platformer_pk_members set ready=coalesce(p_ready,false) where room_id=p_room_id and username=p_username and accepted and wager_locked;
  if not found then raise exception '请先接受邀请并锁定押注'; end if;
  select count(*) filter(where ready),count(*) filter(where wager_locked) into ready_count,locked_count from public.platformer_pk_members where room_id=p_room_id;
  if ready_count=2 and locked_count=2 then
    select * into r from public.platformer_pk_rooms where room_id=p_room_id for update;
    if r.status in ('paired','waiting') and r.match_id is null then
      insert into public.platformer_pk_matches(room_id,seed) values(p_room_id,r.seed) returning match_id into mid;
      update public.platformer_pk_rooms set match_id=mid,status='started',updated_at=now() where room_id=p_room_id;
    end if;
  end if;
  return jsonb_build_object('ready',coalesce(p_ready,false),'started',ready_count=2 and locked_count=2);
end;
$$;

create or replace function public.platformer_pk_submit_result(p_username text, p_token text, p_match_id uuid, p_won boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare m public.platformer_pk_matches; r public.platformer_pk_rooms; me public.platformer_pk_members; other public.platformer_pk_members; winner text; pot bigint; settled boolean:=false; payout bigint:=0; key text;
begin
  if not public.platformer_pk_session_valid(p_username,p_token) then raise exception '登录会话已失效，请重新登录'; end if;
  select * into m from public.platformer_pk_matches where match_id=p_match_id for update;
  if not found or m.status<>'started' then raise exception '对战不存在或已经结算'; end if;
  select * into r from public.platformer_pk_rooms where room_id=m.room_id;
  select * into me from public.platformer_pk_members where room_id=r.room_id and username=p_username for update;
  if not found then raise exception '你不属于该对战'; end if;
  update public.platformer_pk_members set result_submitted=true,result_won=coalesce(p_won,false) where room_id=r.room_id and username=p_username;
  select * into other from public.platformer_pk_members where room_id=r.room_id and username<>p_username;
  if other.result_submitted then
    select coalesce(sum(wager),0) into pot from public.platformer_pk_members where room_id=r.room_id;
    if coalesce(p_won,false) <> coalesce(other.result_won,false) then
      winner:=case when coalesce(p_won,false) then p_username else other.username end; payout:=pot;
      if payout>0 then update public.platformer_users set coins=coins+payout,updated_at=now() where username=winner; key:=format('pk-payout-%s',p_match_id); insert into public.platformer_pk_coin_ledger(username,room_id,match_id,amount,reason,idempotency_key) values(winner,r.room_id,p_match_id,payout,'PK胜者结算',key) on conflict(idempotency_key) do nothing; end if;
      update public.platformer_pk_matches set status='finished',winner_username=winner,ended_at=now() where match_id=p_match_id;
      update public.platformer_pk_rooms set status='finished',updated_at=now() where room_id=r.room_id; settled:=true;
    else
      -- 双方都报告失败视为平局，退回双方已锁定押注；双方都报告胜利则进入争议并退款。
      for me in select * from public.platformer_pk_members where room_id=r.room_id loop
        if me.wager>0 then update public.platformer_users set coins=coins+me.wager,updated_at=now() where username=me.username; key:=format('pk-refund-%s-%s',p_match_id,me.username); insert into public.platformer_pk_coin_ledger(username,room_id,match_id,amount,reason,idempotency_key) values(me.username,r.room_id,p_match_id,me.wager,'PK平局/争议退款',key) on conflict(idempotency_key) do nothing; end if;
      end loop;
      update public.platformer_pk_matches set status=case when coalesce(p_won,false) then 'disputed' else 'finished' end,ended_at=now() where match_id=p_match_id;
      update public.platformer_pk_rooms set status=case when coalesce(p_won,false) then 'disputed' else 'finished' end,updated_at=now() where room_id=r.room_id; settled:=true;
    end if;
  end if;
  return jsonb_build_object('settled',settled,'payout',payout,'winner',winner);
end;
$$;

create or replace function public.platformer_pk_leave_room(p_username text, p_token text, p_room_id uuid)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare r public.platformer_pk_rooms; m public.platformer_pk_members; key text;
begin
  if not public.platformer_pk_session_valid(p_username,p_token) then raise exception '登录会话已失效，请重新登录'; end if;
  select * into r from public.platformer_pk_rooms where room_id=p_room_id and (host_username=p_username or guest_username=p_username) for update;
  if not found then return false; end if;
  if r.status='started' then raise exception '对战开始后不能直接退出，请等待结果结算'; end if;
  for m in select * from public.platformer_pk_members where room_id=p_room_id and wager_locked and wager>0 loop
    update public.platformer_users set coins=coins+m.wager,updated_at=now() where username=m.username; key:=format('pk-leave-refund-%s-%s',p_room_id,m.username); insert into public.platformer_pk_coin_ledger(username,room_id,amount,reason,idempotency_key) values(m.username,p_room_id,m.wager,'PK退出退款',key) on conflict(idempotency_key) do nothing;
  end loop;
  update public.platformer_pk_rooms set status='cancelled',updated_at=now() where room_id=p_room_id;
  return true;
end;
$$;

revoke execute on function public.platformer_pk_room_snapshot(text,text,uuid) from public;
revoke execute on function public.platformer_pk_create_room(text,text) from public;
revoke execute on function public.platformer_pk_join_room(text,text,text) from public;
revoke execute on function public.platformer_pk_accept_invite(text,text,uuid) from public;
revoke execute on function public.platformer_pk_lock_wager(text,text,uuid,bigint) from public;
revoke execute on function public.platformer_pk_set_ready(text,text,uuid,boolean) from public;
revoke execute on function public.platformer_pk_submit_result(text,text,uuid,boolean) from public;
revoke execute on function public.platformer_pk_leave_room(text,text,uuid) from public;
grant execute on function public.platformer_pk_room_snapshot(text,text,uuid) to anon, authenticated;
grant execute on function public.platformer_pk_create_room(text,text) to anon, authenticated;
grant execute on function public.platformer_pk_join_room(text,text,text) to anon, authenticated;
grant execute on function public.platformer_pk_accept_invite(text,text,uuid) to anon, authenticated;
grant execute on function public.platformer_pk_lock_wager(text,text,uuid,bigint) to anon, authenticated;
grant execute on function public.platformer_pk_set_ready(text,text,uuid,boolean) to anon, authenticated;
grant execute on function public.platformer_pk_submit_result(text,text,uuid,boolean) to anon, authenticated;
grant execute on function public.platformer_pk_leave_room(text,text,uuid) to anon, authenticated;

-- Realtime 频道在第一版使用不可猜测的 room UUID；权威数据仍只能通过上述 RPC 读写。
do $$
begin
  if not exists (select 1 from pg_publication_rel pr join pg_class c on c.oid=pr.prrelid join pg_publication p on p.oid=pr.prpubid where p.pubname='supabase_realtime' and c.oid='public.platformer_pk_rooms'::regclass) then alter publication supabase_realtime add table public.platformer_pk_rooms; end if;
  if not exists (select 1 from pg_publication_rel pr join pg_class c on c.oid=pr.prrelid join pg_publication p on p.oid=pr.prpubid where p.pubname='supabase_realtime' and c.oid='public.platformer_pk_members'::regclass) then alter publication supabase_realtime add table public.platformer_pk_members; end if;
  if not exists (select 1 from pg_publication_rel pr join pg_class c on c.oid=pr.prrelid join pg_publication p on p.oid=pr.prpubid where p.pubname='supabase_realtime' and c.oid='public.platformer_pk_matches'::regclass) then alter publication supabase_realtime add table public.platformer_pk_matches; end if;
exception when undefined_table then
  raise notice 'supabase_realtime publication not available; Broadcast/Presence still work.';
end $$;
