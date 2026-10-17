-- Chat configuration, metadata audit, and one-generation-per-user lease state.
-- Secrets are never stored here. Store provider API keys in Edge Function secrets
-- named CHAT_KEY_* and reference them with secret_name.

create table if not exists public.chat_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  label text not null default '' check (char_length(label) <= 120),
  base_url text not null check (char_length(base_url) between 10 and 2048),
  secret_name text not null check (secret_name ~ '^CHAT_KEY_[A-Z0-9_]{1,80}$'),
  auth_header text not null default 'authorization' check (auth_header in ('authorization', 'x-api-key')),
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists chat_providers_name_uidx
  on public.chat_providers (lower(name));

alter table public.chat_providers
  add column if not exists label text not null default '';

create table if not exists public.chat_models (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.chat_providers(id) on delete cascade,
  model_key text not null check (char_length(trim(model_key)) between 1 and 160),
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  introduction text constraint chat_models_introduction_length_check check (introduction is null or char_length(introduction) <= 1000),
  context_window integer not null check (context_window between 256 and 1000000),
  max_output_tokens integer not null check (max_output_tokens between 1 and 131072),
  default_max_output_tokens integer not null check (default_max_output_tokens between 1 and 131072),
  reasoning_efforts jsonb not null default '[]'::jsonb check (jsonb_typeof(reasoning_efforts) = 'array'),
  default_reasoning_effort text,
  supports_images boolean not null default false,
  supports_pdf boolean not null default false,
  preserve_reasoning boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (provider_id, model_key),
  check (default_max_output_tokens <= max_output_tokens),
  check (default_reasoning_effort is null or char_length(default_reasoning_effort) between 1 and 40)
);

alter table public.chat_models
  add column if not exists introduction text;

alter table public.chat_models
  drop constraint if exists chat_models_introduction_length_check;
alter table public.chat_models
  add constraint chat_models_introduction_length_check
  check (introduction is null or char_length(introduction) <= 1000);

create index if not exists chat_models_enabled_idx
  on public.chat_models (enabled, display_name);

create table if not exists public.chat_usage (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_name text,
  username text,
  provider_name text,
  model_name text,
  action text not null check (action in ('respond', 'admin_test')),
  provider_id uuid not null references public.chat_providers(id) on delete restrict,
  model_id uuid not null references public.chat_models(id) on delete restrict,
  model_key text not null,
  input_bytes integer not null check (input_bytes between 0 and 12582912),
  max_output_tokens integer not null check (max_output_tokens between 1 and 131072),
  reasoning_effort text,
  status text not null default 'audited' check (status in ('audited', 'upstream_started', 'completed', 'incomplete', 'interrupted', 'failed', 'cancelled')),
  upstream_status integer,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  error_code text,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz
);

-- Existing installations also need the immutable display-name snapshots.
alter table public.chat_usage
  add column if not exists username text,
  add column if not exists provider_name text,
  add column if not exists model_name text;

-- Keep existing installations in sync with the interrupted-stream audit status.
alter table public.chat_usage drop constraint if exists chat_usage_status_check;
alter table public.chat_usage add constraint chat_usage_status_check
  check (status in ('audited', 'upstream_started', 'completed', 'incomplete', 'interrupted', 'failed', 'cancelled'));

create index if not exists chat_usage_started_idx
  on public.chat_usage (started_at desc);
create index if not exists chat_usage_user_started_idx
  on public.chat_usage (user_id, started_at desc);
create index if not exists chat_usage_model_started_idx
  on public.chat_usage (model_id, started_at desc);

create table if not exists public.chat_generation_leases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_id uuid not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.chat_providers enable row level security;
alter table public.chat_models enable row level security;
alter table public.chat_usage enable row level security;
alter table public.chat_generation_leases enable row level security;

revoke all on table public.chat_providers, public.chat_models, public.chat_usage, public.chat_generation_leases from public, anon, authenticated;
grant select, insert, update, delete on table public.chat_providers, public.chat_models, public.chat_usage, public.chat_generation_leases to service_role;

create or replace function public.chat_acquire_generation_lease(
  p_user_id uuid,
  p_request_id uuid,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if p_user_id is null or p_request_id is null or p_expires_at <= timezone('utc', now()) then
    return false;
  end if;

  delete from public.chat_generation_leases
  where user_id = p_user_id and expires_at <= timezone('utc', now());

  insert into public.chat_generation_leases (user_id, request_id, expires_at)
  values (p_user_id, p_request_id, p_expires_at)
  on conflict (user_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

create or replace function public.chat_release_generation_lease(
  p_user_id uuid,
  p_request_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.chat_generation_leases
  where user_id = p_user_id and request_id = p_request_id;
$$;

revoke all on function public.chat_acquire_generation_lease(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.chat_release_generation_lease(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chat_acquire_generation_lease(uuid, uuid, timestamptz) to service_role;
grant execute on function public.chat_release_generation_lease(uuid, uuid) to service_role;

-- Quotas count input + output tokens, including outstanding reservations. Lease
-- expiry ONLY permits another generation; it never refunds a reservation.
-- All quota operations lock the singleton global row, then the target user row,
-- then reservations/buckets/leases. Keep this order in future RPCs as well.
alter table public.chat_usage
  alter column input_tokens type bigint,
  alter column output_tokens type bigint,
  alter column total_tokens type bigint;
alter table public.chat_usage drop constraint if exists chat_usage_nonnegative_tokens;
alter table public.chat_usage add constraint chat_usage_nonnegative_tokens check (
  (input_tokens is null or input_tokens >= 0) and
  (output_tokens is null or output_tokens >= 0) and
  (total_tokens is null or total_tokens >= 0)
);

create table if not exists public.chat_quota_global (
  singleton boolean primary key default true check (singleton),
  daily_limit bigint check (daily_limit between 0 and 1000000000000),
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.chat_quota_global(singleton) values (true) on conflict do nothing;

create table if not exists public.chat_quota_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_limit bigint check (daily_limit between 0 and 1000000000000),
  weekly_limit bigint check (weekly_limit between 0 and 1000000000000),
  monthly_limit bigint check (monthly_limit between 0 and 1000000000000),
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
-- Existing installations gain metadata without inventing a historical actor.
alter table public.chat_quota_global
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id);
alter table public.chat_quota_users
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id);

create table if not exists public.chat_blacklist (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text constraint chat_blacklist_reason_length_check check (char_length(reason) <= 1000),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.chat_blacklist drop constraint if exists chat_blacklist_reason_length_check;
alter table public.chat_blacklist add constraint chat_blacklist_reason_length_check
  check (char_length(reason) <= 1000);
create table if not exists public.chat_quota_buckets (
  -- A text scope avoids NULL uniqueness and collision with any real user UUID.
  scope text not null,
  period text not null check (period in ('day', 'week', 'month')),
  starts_at timestamptz not null,
  resets_at timestamptz not null check (resets_at > starts_at),
  used bigint not null default 0 check (used >= 0),
  primary key (scope, period, starts_at),
  check (scope = 'global' or scope ~ '^user:[0-9a-f-]{36}$'),
  check (scope <> 'global' or period = 'day')
);
create table if not exists public.chat_quota_reservations (
  request_id uuid primary key references public.chat_usage(request_id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  input_tokens bigint not null check (input_tokens >= 0),
  reserved_tokens bigint not null check (reserved_tokens >= input_tokens),
  settled_tokens bigint check (settled_tokens >= 0),
  settled_at timestamptz,
  refunded boolean not null default false,
  check ((settled_at is null) = (settled_tokens is null)),
  check (not refunded or settled_tokens = 0)
);
create table if not exists public.chat_quota_allocations (
  request_id uuid not null references public.chat_quota_reservations(request_id) on delete restrict,
  scope text not null,
  period text not null,
  starts_at timestamptz not null,
  primary key (request_id, scope, period),
  foreign key (scope, period, starts_at)
    references public.chat_quota_buckets(scope, period, starts_at) on delete restrict
);

alter table public.chat_quota_global enable row level security;
alter table public.chat_quota_users enable row level security;
alter table public.chat_blacklist enable row level security;
alter table public.chat_quota_buckets enable row level security;
alter table public.chat_quota_reservations enable row level security;
alter table public.chat_quota_allocations enable row level security;
revoke all on table public.chat_quota_global, public.chat_quota_users,
  public.chat_blacklist, public.chat_quota_buckets, public.chat_quota_reservations,
  public.chat_quota_allocations from public, anon, authenticated;
grant select, insert, update, delete on table public.chat_quota_global,
  public.chat_quota_users, public.chat_blacklist, public.chat_quota_buckets,
  public.chat_quota_reservations, public.chat_quota_allocations to service_role;

-- No email/name bootstrap or fallback: a missing admin table fails closed.
create or replace function public.chat_quota_assert_admin(p_actor_user_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_admin boolean;
begin
  if p_actor_user_id is null or not exists (
    select 1 from auth.users where id = p_actor_user_id
  ) then raise exception 'Invalid actor' using errcode = '42501'; end if;
  execute 'select exists (select 1 from public.club_super_admins where user_id = $1)'
    into v_admin using p_actor_user_id;
  if not v_admin then raise exception 'Administrator required' using errcode = '42501'; end if;
end;
$$;

create or replace function public.chat_quota_lock(p_user_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform 1 from public.chat_quota_global where singleton for update;
  if p_user_id is not null then
    if not exists (select 1 from auth.users where id = p_user_id) then
      raise exception 'Unknown user' using errcode = '22023';
    end if;
    insert into public.chat_quota_users(user_id) values (p_user_id) on conflict do nothing;
    perform 1 from public.chat_quota_users where user_id = p_user_id for update;
  end if;
end;
$$;

create or replace function public.chat_quota_get(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
set timezone = 'UTC' as $$
declare
  v_global public.chat_quota_global%rowtype;
  v_user public.chat_quota_users%rowtype;
  v_now timestamp;
  v_start timestamptz;
  v_reset timestamptz;
  v_period text;
  v_limit bigint;
  v_used bigint;
  v_global_used bigint;
  v_global_reset timestamptz;
  v_reason text;
  v_blocked boolean;
  v_periods jsonb := '[]'::jsonb;
begin
  perform public.chat_quota_lock(p_user_id);
  v_now := clock_timestamp() at time zone 'UTC';
  select * into v_global from public.chat_quota_global where singleton;
  select * into v_user from public.chat_quota_users where user_id = p_user_id;
  v_global_reset := (date_trunc('day', v_now) + interval '1 day') at time zone 'UTC';
  select coalesce((select used from public.chat_quota_buckets
    where scope = 'global' and period = 'day'
      and starts_at = date_trunc('day', v_now) at time zone 'UTC'), 0) into v_global_used;
  foreach v_period in array array['day','week','month'] loop
    v_start := date_trunc(v_period, v_now) at time zone 'UTC';
    v_reset := (date_trunc(v_period, v_now) + case v_period
      when 'day' then interval '1 day' when 'week' then interval '1 week'
      else interval '1 month' end) at time zone 'UTC';
    v_limit := case v_period when 'day' then v_user.daily_limit
      when 'week' then v_user.weekly_limit else v_user.monthly_limit end;
    select coalesce((select used from public.chat_quota_buckets
      where scope = 'user:' || p_user_id::text and period = v_period and starts_at = v_start), 0)
      into v_used;
    v_periods := v_periods || jsonb_build_array(jsonb_build_object(
      'period', v_period, 'limit', v_limit, 'used', v_used,
      'remaining', case when v_limit is null then null else greatest(0, v_limit - v_used) end,
      'resets_at', v_reset));
  end loop;
  select reason into v_reason from public.chat_blacklist where user_id = p_user_id;
  v_blocked := found;
  return jsonb_build_object(
    'global', jsonb_build_object('daily_limit', v_global.daily_limit, 'version', v_global.version,
      'used', v_global_used, 'remaining', case when v_global.daily_limit is null then null
      else greatest(0, v_global.daily_limit - v_global_used) end, 'resets_at', v_global_reset),
    'user', jsonb_build_object('daily_limit', v_user.daily_limit, 'weekly_limit', v_user.weekly_limit,
      'monthly_limit', v_user.monthly_limit, 'version', coalesce(v_user.version, 0)),
    'periods', v_periods, 'blacklisted', v_blocked, 'reason', v_reason);
end;
$$;

create or replace function public.chat_quota_save(
  p_actor_user_id uuid, p_user_id uuid, p_daily_limit bigint,
  p_weekly_limit bigint, p_monthly_limit bigint, p_expected_version bigint
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_version bigint;
begin
  perform public.chat_quota_assert_admin(p_actor_user_id);
  if p_expected_version is null or p_expected_version < 0
    or p_daily_limit not between 0 and 1000000000000
    or p_weekly_limit not between 0 and 1000000000000
    or p_monthly_limit not between 0 and 1000000000000 then
    raise exception 'Invalid limit/version' using errcode = '22023';
  end if;
  if p_user_id is null and (p_weekly_limit is not null or p_monthly_limit is not null) then
    raise exception 'Global quota supports daily limit only' using errcode = '22023';
  end if;
  perform public.chat_quota_lock(p_user_id);
  if p_user_id is null then
    select version into v_version from public.chat_quota_global where singleton;
  else
    select version into v_version from public.chat_quota_users where user_id = p_user_id;
  end if;
  if v_version <> p_expected_version then return jsonb_build_object('code','conflict'); end if;
  if p_user_id is null then
    update public.chat_quota_global set daily_limit = p_daily_limit, version = version + 1,
      updated_by = p_actor_user_id, updated_at = clock_timestamp() where singleton;
  else
    update public.chat_quota_users set daily_limit = p_daily_limit,
      weekly_limit = p_weekly_limit, monthly_limit = p_monthly_limit, version = version + 1,
      updated_by = p_actor_user_id, updated_at = clock_timestamp()
      where user_id = p_user_id;
  end if;
  return public.chat_quota_get(p_user_id);
end;
$$;

create or replace function public.chat_blacklist_set(
  p_actor_user_id uuid, p_user_id uuid, p_blocked boolean, p_reason text
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform public.chat_quota_assert_admin(p_actor_user_id);
  if p_user_id is null or p_blocked is null then
    raise exception 'User and blocked are required' using errcode = '22023';
  end if;
  -- Reject the supplied value before trimming, including on unblock requests.
  if char_length(p_reason) > 1000 then
    raise exception 'Blacklist reason exceeds 1000 characters' using errcode = '22023';
  end if;
  perform public.chat_quota_lock(p_user_id);
  if p_blocked then
    insert into public.chat_blacklist(user_id, reason, updated_by)
      values (p_user_id, nullif(btrim(p_reason), ''), p_actor_user_id)
      on conflict (user_id) do update set reason = excluded.reason,
        updated_by = excluded.updated_by, updated_at = clock_timestamp();
  else
    delete from public.chat_blacklist where user_id = p_user_id;
  end if;
  return public.chat_quota_get(p_user_id);
end;
$$;

create or replace function public.chat_user_directory(p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform public.chat_quota_assert_admin(p_actor_user_id);
  -- One aggregate row is not truncated by PostgREST's row cap. Includes unbound
  -- auth accounts; no silent LIMIT or incomplete client-side join.
  return jsonb_build_object('users', (
    select coalesce(jsonb_agg(jsonb_build_object('user_id', u.id,
      'username', coalesce(p.username, u.raw_user_meta_data->>'username', u.email, u.id::text),
      'member_name', p.member_name, 'bound', p.user_id is not null) order by u.id), '[]'::jsonb)
    from auth.users u left join public.club_member_profiles p on p.user_id = u.id
  ), 'blacklist', (
    select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'reason', reason)
      order by user_id), '[]'::jsonb) from public.chat_blacklist
  ));
end;
$$;

create or replace function public.chat_begin_generation(
  p_user_id uuid, p_request_id uuid, p_input_tokens bigint,
  p_output_tokens integer, p_audit jsonb
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_snapshot jsonb;
  v_period jsonb;
  v_remaining bigint;
  v_output bigint;
  v_reserved bigint;
  v_now timestamp;
  v_name text;
  v_start timestamptz;
  v_reset timestamptz;
begin
  if p_user_id is null or p_request_id is null or p_input_tokens is null
    or p_input_tokens < 0 or p_output_tokens is null or p_output_tokens not between 1 and 131072
    or p_audit is null or jsonb_typeof(p_audit) <> 'object' then
    raise exception 'Invalid generation arguments' using errcode = '22023';
  end if;
  perform public.chat_quota_lock(p_user_id);
  -- Capture snapshot/time AFTER waiting for locks, not transaction-start now().
  v_snapshot := public.chat_quota_get(p_user_id);
  -- Derive the reservation calendar from the very same snapshot even if UTC
  -- midnight passes between statements; no stale quota/new bucket mismatch.
  v_now := ((v_snapshot->'global'->>'resets_at')::timestamptz at time zone 'UTC') - interval '1 day';
  if (v_snapshot->>'blacklisted')::boolean then
    return jsonb_build_object('allowed', false, 'code','blacklisted', 'max_output_tokens',0,
      'quota_limited', false, 'quota',v_snapshot);
  end if;
  -- Duplicate request IDs are never allowed to start another upstream call.
  if exists (select 1 from public.chat_usage where request_id = p_request_id) then
    return jsonb_build_object('allowed',false,'code','duplicate_request','max_output_tokens',0,
      'quota_limited',false,'quota',v_snapshot);
  end if;
  if exists (select 1 from public.chat_generation_leases
    where user_id = p_user_id and expires_at > clock_timestamp()) then
    return jsonb_build_object('allowed',false,'code','busy','max_output_tokens',0,
      'quota_limited',false,'quota',v_snapshot);
  end if;
  v_output := p_output_tokens;
  v_remaining := (v_snapshot->'global'->>'remaining')::bigint;
  if v_remaining is not null then v_output := least(v_output, v_remaining - p_input_tokens); end if;
  for v_period in select value from jsonb_array_elements(v_snapshot->'periods') loop
    v_remaining := (v_period->>'remaining')::bigint;
    if v_remaining is not null then v_output := least(v_output, v_remaining - p_input_tokens); end if;
  end loop;
  if v_output < 1 then
    return jsonb_build_object('allowed',false,'code','quota_exceeded','max_output_tokens',0,
      'quota_limited',true,'quota',v_snapshot);
  end if;
  -- Numeric intermediate prevents overflowing bigint before validation.
  if p_input_tokens::numeric + v_output > 9223372036854775807 then
    raise exception 'Token reservation overflow' using errcode = '22003';
  end if;
  v_reserved := p_input_tokens + v_output;
  insert into public.chat_usage(request_id,user_id,member_name,username,provider_name,model_name,
    action,provider_id,model_id,model_key,input_bytes,max_output_tokens,reasoning_effort,status,started_at)
  values (p_request_id,p_user_id,p_audit->>'member_name',p_audit->>'username',
    p_audit->>'provider_name',p_audit->>'model_name',p_audit->>'action',
    (p_audit->>'provider_id')::uuid,(p_audit->>'model_id')::uuid,p_audit->>'model_key',
    (p_audit->>'input_bytes')::integer,v_output::integer,p_audit->>'reasoning_effort',
    'audited',clock_timestamp());
  insert into public.chat_quota_reservations(request_id,user_id,input_tokens,reserved_tokens)
    values (p_request_id,p_user_id,p_input_tokens,v_reserved);
  foreach v_name in array array['global','day','week','month'] loop
    v_start := date_trunc(case when v_name = 'global' then 'day' else v_name end, v_now) at time zone 'UTC';
    v_reset := (date_trunc(case when v_name = 'global' then 'day' else v_name end, v_now)
      + case v_name when 'month' then interval '1 month' when 'week' then interval '1 week'
      else interval '1 day' end) at time zone 'UTC';
    insert into public.chat_quota_buckets(scope,period,starts_at,resets_at,used)
      values (case when v_name = 'global' then 'global' else 'user:' || p_user_id::text end,
        case when v_name = 'global' then 'day' else v_name end,v_start,v_reset,v_reserved)
      on conflict (scope,period,starts_at) do update
        set used = public.chat_quota_buckets.used + excluded.used;
    insert into public.chat_quota_allocations(request_id,scope,period,starts_at)
      values (p_request_id,case when v_name = 'global' then 'global' else 'user:' || p_user_id::text end,
        case when v_name = 'global' then 'day' else v_name end,v_start);
  end loop;
  delete from public.chat_generation_leases where user_id = p_user_id and expires_at <= clock_timestamp();
  insert into public.chat_generation_leases(user_id,request_id,expires_at)
    values (p_user_id,p_request_id,clock_timestamp() + interval '15 minutes');
  return jsonb_build_object('allowed',true,'max_output_tokens',v_output,
    'quota_limited',v_output < p_output_tokens,'quota',public.chat_quota_get(p_user_id));
end;
$$;

create or replace function public.chat_finish_generation(
  p_request_id uuid, p_patch jsonb, p_refund boolean default false
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_user_id uuid;
  v_res public.chat_quota_reservations%rowtype;
  v_audit public.chat_usage%rowtype;
  v_input bigint;
  v_output bigint;
  v_total bigint;
  v_actual bigint;
  v_status text;
begin
  if p_request_id is null or p_patch is null or jsonb_typeof(p_patch) <> 'object'
    or p_refund is null then
    raise exception 'Invalid settlement arguments' using errcode = '22023';
  end if;
  select user_id into v_user_id from public.chat_quota_reservations where request_id = p_request_id;
  if not found then raise exception 'Unknown reservation' using errcode = '22023'; end if;
  perform public.chat_quota_lock(v_user_id);
  select * into v_res from public.chat_quota_reservations where request_id = p_request_id for update;
  -- First settlement wins, including its audit and refund decision.
  if v_res.settled_at is not null then return public.chat_quota_get(v_user_id); end if;
  select * into v_audit from public.chat_usage where request_id = p_request_id for update;
  v_input := coalesce((p_patch->>'input_tokens')::bigint, v_audit.input_tokens);
  v_output := coalesce((p_patch->>'output_tokens')::bigint, v_audit.output_tokens);
  v_total := coalesce((p_patch->>'total_tokens')::bigint, v_audit.total_tokens);
  if v_input < 0 or v_output < 0 or v_total < 0 then
    raise exception 'Negative usage' using errcode = '22023';
  end if;
  v_status := coalesce(p_patch->>'status', 'failed');
  if v_status not in ('completed','incomplete','interrupted','failed','cancelled') then
    raise exception 'Final status required' using errcode = '22023';
  end if;
  if p_refund then
    -- The caller additionally guarantees no upstream request started. Refuse
    -- any persisted/patch evidence to the contrary; expiry is never evidence.
    if v_audit.status <> 'audited' or v_audit.upstream_status is not null
      or p_patch->>'upstream_status' is not null or v_input is not null
      or v_output is not null or v_total is not null or v_status not in ('failed','cancelled') then
      raise exception 'Refund requires guaranteed not-started request' using errcode = '22023';
    end if;
    v_actual := 0;
  elsif v_total is not null or (v_input is not null and v_output is not null) then
    -- A reported total may omit reasoning tokens in some providers; never
    -- accept less than input+output. Missing input uses the reserved estimate.
    if coalesce(v_input,v_res.input_tokens)::numeric + coalesce(v_output,0) > 9223372036854775807 then
      raise exception 'Actual token usage overflow' using errcode = '22003';
    end if;
    v_actual := greatest(coalesce(v_total,0), coalesce(v_input,v_res.input_tokens) + coalesce(v_output,0));
  else
    -- Incomplete/missing usage is not a refund. Preserve the reservation, and
    -- never undercount even partial usage evidence that exceeds that reserve.
    if coalesce(v_input,v_res.input_tokens)::numeric + coalesce(v_output,0) > 9223372036854775807 then
      raise exception 'Actual token usage overflow' using errcode = '22003';
    end if;
    v_actual := greatest(v_res.reserved_tokens,
      coalesce(v_input,v_res.input_tokens) + coalesce(v_output,0));
  end if;
  update public.chat_quota_buckets b set used = b.used - v_res.reserved_tokens + v_actual
    from public.chat_quota_allocations a where a.request_id = p_request_id
      and b.scope = a.scope and b.period = a.period and b.starts_at = a.starts_at;
  update public.chat_usage set status = v_status,
    upstream_status = coalesce((p_patch->>'upstream_status')::integer, upstream_status),
    input_tokens = v_input, output_tokens = v_output,
    total_tokens = case when v_total is not null or (v_input is not null and v_output is not null)
      then v_actual else null end,
    error_code = p_patch->>'error_code', finished_at = clock_timestamp()
    where request_id = p_request_id;
  update public.chat_quota_reservations set settled_tokens = v_actual,
    settled_at = clock_timestamp(), refunded = p_refund where request_id = p_request_id;
  -- Do not release a newer lease acquired after this request's lease expired.
  delete from public.chat_generation_leases where user_id = v_user_id and request_id = p_request_id;
  return public.chat_quota_get(v_user_id);
end;
$$;

revoke all on function public.chat_quota_assert_admin(uuid), public.chat_quota_lock(uuid),
  public.chat_quota_get(uuid), public.chat_quota_save(uuid,uuid,bigint,bigint,bigint,bigint),
  public.chat_blacklist_set(uuid,uuid,boolean,text), public.chat_user_directory(uuid),
  public.chat_begin_generation(uuid,uuid,bigint,integer,jsonb),
  public.chat_finish_generation(uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.chat_quota_get(uuid),
  public.chat_quota_save(uuid,uuid,bigint,bigint,bigint,bigint),
  public.chat_blacklist_set(uuid,uuid,boolean,text), public.chat_user_directory(uuid),
  public.chat_begin_generation(uuid,uuid,bigint,integer,jsonb),
  public.chat_finish_generation(uuid,jsonb,boolean) to service_role;

-- Independent Responses gateway. All admission and mutations lock route first,
-- then key. Expiry recovers capacity after worker termination; no payload stored.
create table if not exists public.chat_proxy_routes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  base_url text not null check (char_length(base_url) between 10 and 2048),
  secret_name text not null check (secret_name ~ '^CHAT_KEY_[A-Z0-9_]{1,80}$'),
  enabled boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.chat_proxy_keys (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.chat_proxy_routes(id),
  label text not null check (char_length(trim(label)) between 1 and 120),
  key_hash text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),
  key_prefix text not null, key_last4 text not null,
  enabled boolean not null default true, revoked_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.chat_proxy_leases (
  request_id uuid primary key,
  route_id uuid not null references public.chat_proxy_routes(id),
  key_id uuid not null references public.chat_proxy_keys(id),
  created_at timestamptz not null default now(), expires_at timestamptz not null
);
create index if not exists chat_proxy_leases_route_idx on public.chat_proxy_leases(route_id, expires_at);
create index if not exists chat_proxy_leases_key_idx on public.chat_proxy_leases(key_id, expires_at);
alter table public.chat_proxy_routes enable row level security;
alter table public.chat_proxy_keys enable row level security;
alter table public.chat_proxy_leases enable row level security;
revoke all on public.chat_proxy_routes, public.chat_proxy_keys, public.chat_proxy_leases from public, anon, authenticated;
grant select, insert, update, delete on public.chat_proxy_routes, public.chat_proxy_keys, public.chat_proxy_leases to service_role;

create or replace function public.chat_proxy_key_metadata(k public.chat_proxy_keys)
returns jsonb language sql immutable set search_path=public as $$
  select jsonb_build_object('id',k.id,'route_id',k.route_id,'label',k.label,
    'key_prefix',k.key_prefix,'key_last4',k.key_last4,'enabled',k.enabled,
    'revoked_at',k.revoked_at,'version',k.version,'created_at',k.created_at);
$$;
revoke all on function public.chat_proxy_key_metadata(public.chat_proxy_keys) from public,anon,authenticated;
grant execute on function public.chat_proxy_key_metadata(public.chat_proxy_keys) to service_role;

create or replace function public.chat_proxy_admin(p_actor uuid, p_action text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.chat_proxy_routes; k public.chat_proxy_keys; rid uuid; result jsonb;
begin
  perform public.chat_quota_assert_admin(p_actor);
  if p_action = 'admin_proxy_list' then
    return jsonb_build_object('routes', coalesce((select jsonb_agg(to_jsonb(t) - 'created_by' - 'updated_by' order by created_at) from public.chat_proxy_routes t), '[]'::jsonb),
      'keys', coalesce((select jsonb_agg(public.chat_proxy_key_metadata(t) order by created_at) from public.chat_proxy_keys t), '[]'::jsonb));
  end if;
  if p_action = 'admin_proxy_save' and p_data->>'id' is null then
    if (p_data->>'expected_version')::bigint <> 0 then return '{"code":"conflict"}'; end if;
    insert into public.chat_proxy_routes(name,base_url,secret_name,enabled,created_by,updated_by)
      values(p_data->>'name',p_data->>'base_url',p_data->>'secret_name',(p_data->>'enabled')::boolean,p_actor,p_actor) returning * into r;
    return jsonb_build_object('route',to_jsonb(r)-'created_by'-'updated_by');
  end if;
  if p_action in ('admin_proxy_save','admin_proxy_route_state') then rid := (p_data->>'id')::uuid;
  elsif p_action = 'admin_proxy_key_create' then rid := (p_data->>'route_id')::uuid;
  elsif p_action = 'admin_proxy_key_state' then select route_id into rid from public.chat_proxy_keys where id = (p_data->>'id')::uuid;
  else raise exception 'invalid action'; end if;
  select * into r from public.chat_proxy_routes where id = rid for update;
  if not found then return '{"code":"not_found"}'; end if;
  if p_action in ('admin_proxy_save','admin_proxy_route_state') then
    if r.version <> (p_data->>'expected_version')::bigint then return '{"code":"conflict"}'; end if;
    update public.chat_proxy_routes set enabled=(p_data->>'enabled')::boolean,
      name=case when p_action='admin_proxy_save' then p_data->>'name' else name end,
      base_url=case when p_action='admin_proxy_save' then p_data->>'base_url' else base_url end,
      secret_name=case when p_action='admin_proxy_save' then p_data->>'secret_name' else secret_name end,
      version=version+1,updated_at=now(),updated_by=p_actor where id=rid returning * into r;
    return jsonb_build_object('route',to_jsonb(r)-'created_by'-'updated_by');
  end if;
  if p_action='admin_proxy_key_create' then
    insert into public.chat_proxy_keys(route_id,label,key_hash,key_prefix,key_last4,created_by,updated_by)
      values(rid,p_data->>'label',p_data->>'key_hash',p_data->>'key_prefix',p_data->>'key_last4',p_actor,p_actor) returning * into k;
  else
    select * into k from public.chat_proxy_keys where id=(p_data->>'id')::uuid for update;
    if k.version <> (p_data->>'expected_version')::bigint then return '{"code":"conflict"}'; end if;
    if k.revoked_at is not null and not (p_data->>'revoked')::boolean then return '{"code":"revoked"}'; end if;
    update public.chat_proxy_keys set enabled=case when (p_data->>'revoked')::boolean then false else (p_data->>'enabled')::boolean end,
      revoked_at=case when (p_data->>'revoked')::boolean then coalesce(revoked_at,now()) else revoked_at end,
      version=version+1,updated_at=now(),updated_by=p_actor where id=k.id returning * into k;
  end if;
  return jsonb_build_object('key',public.chat_proxy_key_metadata(k));
end; $$;

create or replace function public.chat_proxy_admit(p_route_id uuid,p_key_hash text,p_request_id uuid,p_key_limit integer,p_route_limit integer,p_ttl_ms integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.chat_proxy_routes; k public.chat_proxy_keys;
begin
  if p_key_limit not between 1 and 1000 or p_route_limit not between 1 and 10000 or p_ttl_ms not between 1000 and 150000 then raise exception 'invalid limits'; end if;
  select * into r from public.chat_proxy_routes where id=p_route_id for update;
  if not found or not r.enabled then return '{"code":"invalid_key"}'; end if;
  select * into k from public.chat_proxy_keys where route_id=r.id and key_hash=p_key_hash for update;
  if not found or not k.enabled or k.revoked_at is not null then return '{"code":"invalid_key"}'; end if;
  delete from public.chat_proxy_leases where route_id=r.id and expires_at<=clock_timestamp();
  if (select count(*) from public.chat_proxy_leases where route_id=r.id) >= p_route_limit or
     (select count(*) from public.chat_proxy_leases where key_id=k.id) >= p_key_limit then return '{"code":"busy"}'; end if;
  insert into public.chat_proxy_leases(request_id,route_id,key_id,expires_at)
    values(p_request_id,r.id,k.id,clock_timestamp()+p_ttl_ms*interval '1 millisecond');
  return jsonb_build_object('route',to_jsonb(r)-'created_by'-'updated_by');
end; $$;
create or replace function public.chat_proxy_release(p_request_id uuid)
returns void language sql security definer set search_path=public as $$
  delete from public.chat_proxy_leases where request_id=p_request_id;
$$;
revoke all on function public.chat_proxy_admin(uuid,text,jsonb), public.chat_proxy_admit(uuid,text,uuid,integer,integer,integer), public.chat_proxy_release(uuid) from public,anon,authenticated;
grant execute on function public.chat_proxy_admin(uuid,text,jsonb), public.chat_proxy_admit(uuid,text,uuid,integer,integer,integer), public.chat_proxy_release(uuid) to service_role;
