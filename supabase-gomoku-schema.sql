create table if not exists public.gomoku_scores (
  id uuid primary key default gen_random_uuid(),
  nickname text not null check (char_length(trim(nickname)) between 1 and 20),
  result text not null check (result in ('win', 'loss', 'draw')),
  moves integer not null check (moves between 1 and 500),
  duration_ms integer not null check (duration_ms between 0 and 86400000),
  score integer not null check (score in (0, 1, 3)),
  created_at timestamptz not null default now()
);

create index if not exists gomoku_scores_leaderboard_idx
  on public.gomoku_scores (score desc, created_at asc);

alter table public.gomoku_scores enable row level security;

drop policy if exists "Public can read gomoku scores" on public.gomoku_scores;
create policy "Public can read gomoku scores"
  on public.gomoku_scores
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Public can submit gomoku scores" on public.gomoku_scores;
create policy "Public can submit gomoku scores"
  on public.gomoku_scores
  for insert
  to anon, authenticated
  with check (
    char_length(trim(nickname)) between 1 and 20
    and result in ('win', 'loss', 'draw')
    and moves between 1 and 500
    and duration_ms between 0 and 86400000
    and score in (0, 1, 3)
  );

revoke update, delete on public.gomoku_scores from anon, authenticated;
