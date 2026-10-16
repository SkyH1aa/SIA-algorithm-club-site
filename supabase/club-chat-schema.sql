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
