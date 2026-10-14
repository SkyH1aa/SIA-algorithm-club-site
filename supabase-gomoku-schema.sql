-- 五子棋累计排行榜：同一个昵称只保留一条记录
-- V9Mesa 胜局9分，V10Mesa胜局14分；V10Flash、V10Exp与V10Ultra均为15分，V10Thinker为16分。
-- 可重复执行；只创建/更新当前排行榜结构，不依赖旧表或回填历史数据。

create table if not exists public.gomoku_players (
  nickname text primary key
    check (char_length(trim(nickname)) between 1 and 20),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  total_score integer not null default 0 check (total_score >= 0),
  total_moves integer not null default 0 check (total_moves >= 0),
  total_duration_ms bigint not null default 0 check (total_duration_ms >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists gomoku_players_leaderboard_idx
  on public.gomoku_players (total_score desc, updated_at asc);

alter table public.gomoku_players enable row level security;

drop policy if exists "Public can read gomoku players" on public.gomoku_players;
create policy "Public can read gomoku players"
  on public.gomoku_players
  for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.gomoku_players from anon, authenticated;
grant select on public.gomoku_players to anon, authenticated;

create or replace function public.record_gomoku_result(
  p_nickname text,
  p_result text,
  p_moves integer,
  p_duration_ms integer,
  p_win_points integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_nickname text := trim(p_nickname);
  add_win integer := case when p_result = 'win' then 1 else 0 end;
  add_loss integer := case when p_result = 'loss' then 1 else 0 end;
  add_draw integer := case when p_result = 'draw' then 1 else 0 end;
  add_score integer := case when p_result = 'win' then p_win_points when p_result = 'draw' then 1 else 0 end;
begin
  if char_length(clean_nickname) not between 1 and 20 then
    raise exception '昵称长度必须为 1 到 20 个字符';
  end if;
  if p_result not in ('win', 'loss', 'draw') then
    raise exception '无效的对局结果';
  end if;
  if p_win_points not between 1 and 16 then
    raise exception '无效的获胜积分';
  end if;
  if p_moves not between 1 and 500 then
    raise exception '无效的步数';
  end if;
  if p_duration_ms not between 0 and 86400000 then
    raise exception '无效的对局时长';
  end if;

  insert into public.gomoku_players (
    nickname, wins, losses, draws, total_score, total_moves, total_duration_ms
  ) values (
    clean_nickname, add_win, add_loss, add_draw, add_score, p_moves, p_duration_ms
  )
  on conflict (nickname) do update set
    wins = gomoku_players.wins + excluded.wins,
    losses = gomoku_players.losses + excluded.losses,
    draws = gomoku_players.draws + excluded.draws,
    total_score = gomoku_players.total_score + excluded.total_score,
    total_moves = gomoku_players.total_moves + excluded.total_moves,
    total_duration_ms = gomoku_players.total_duration_ms + excluded.total_duration_ms,
    updated_at = now();
end;
$$;

revoke all on function public.record_gomoku_result(text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_gomoku_result(text, text, integer, integer, integer)
  to anon, authenticated;

-- 对战记录日志：每局开始时以指纹开一条 pending 记录，结束时按指纹回写结果。
-- 10 分钟（600000 ms）内没有结果的记录保留但判定为“无效对局”。
-- 可重复执行；不依赖旧表，不回填历史数据。

create table if not exists public.gomoku_match_log (
  fingerprint text primary key
    check (char_length(fingerprint) between 8 and 64),
  nickname text
    check (nickname is null or char_length(trim(nickname)) between 1 and 20),
  mode text not null default 'human' check (mode in ('human', 'model-battle')),
  model_version numeric,
  opponent_model_version numeric,
  player_color integer check (player_color is null or player_color in (1, 2)),
  ai_color integer check (ai_color is null or ai_color in (1, 2)),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 86400000),
  moves integer check (moves is null or moves between 1 and 500),
  outcome text check (outcome is null or outcome in ('win', 'loss', 'draw', 'surrender', 'invalid')),
  score integer check (score is null or score between 0 and 16),
  winner_label text,
  winner_color integer check (winner_color is null or winner_color in (1, 2))
);

-- 幂等补充：早期版本没有 winner_color 列。
alter table public.gomoku_match_log add column if not exists winner_color integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'gomoku_match_log_winner_color_check') then
    alter table public.gomoku_match_log
      add constraint gomoku_match_log_winner_color_check
      check (winner_color is null or winner_color in (1, 2));
  end if;
end $$;

create index if not exists gomoku_match_log_recent_idx
  on public.gomoku_match_log (started_at desc);

alter table public.gomoku_match_log enable row level security;

drop policy if exists "Public can read gomoku match log" on public.gomoku_match_log;
create policy "Public can read gomoku match log"
  on public.gomoku_match_log
  for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.gomoku_match_log from anon, authenticated;
grant select on public.gomoku_match_log to anon, authenticated;

-- 开局登记：指纹唯一，重复开局不会覆盖已有记录。
create or replace function public.start_gomoku_match(
  p_fingerprint text,
  p_nickname text,
  p_mode text,
  p_model_version numeric,
  p_opponent_model_version numeric,
  p_player_color integer,
  p_ai_color integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_fingerprint text := trim(p_fingerprint);
  clean_nickname text := nullif(trim(coalesce(p_nickname, '')), '');
begin
  if char_length(clean_fingerprint) not between 8 and 64 then
    raise exception '无效的对局指纹';
  end if;
  if clean_nickname is not null and char_length(clean_nickname) not between 1 and 20 then
    raise exception '昵称长度必须为 1 到 20 个字符';
  end if;
  if p_mode not in ('human', 'model-battle') then
    raise exception '无效的对局模式';
  end if;
  if p_player_color is not null and p_player_color not in (1, 2) then
    raise exception '无效的执子信息';
  end if;
  if p_ai_color is not null and p_ai_color not in (1, 2) then
    raise exception '无效的执子信息';
  end if;
  if p_player_color is not null and p_ai_color is not null and p_player_color = p_ai_color then
    raise exception '执子信息冲突';
  end if;

  insert into public.gomoku_match_log (
    fingerprint, nickname, mode, model_version, opponent_model_version,
    player_color, ai_color, started_at
  ) values (
    clean_fingerprint, clean_nickname, p_mode, p_model_version, p_opponent_model_version,
    p_player_color, p_ai_color, now()
  )
  on conflict (fingerprint) do nothing;
end;
$$;

revoke all on function public.start_gomoku_match(text, text, text, numeric, numeric, integer, integer)
  from public, anon, authenticated;
grant execute on function public.start_gomoku_match(text, text, text, numeric, numeric, integer, integer)
  to anon, authenticated;

-- 结束登记：只按指纹补全结果，不改写已结束的记录。
create or replace function public.finish_gomoku_match(
  p_fingerprint text,
  p_outcome text,
  p_moves integer,
  p_duration_ms integer,
  p_score integer,
  p_winner_label text,
  p_winner_color integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_fingerprint text := trim(p_fingerprint);
begin
  if char_length(clean_fingerprint) not between 8 and 64 then
    raise exception '无效的对局指纹';
  end if;
  if p_outcome not in ('win', 'loss', 'draw', 'surrender', 'invalid') then
    raise exception '无效的对局结果';
  end if;
  if p_moves is not null and p_moves not between 1 and 500 then
    raise exception '无效的步数';
  end if;
  if p_duration_ms is not null and p_duration_ms not between 0 and 86400000 then
    raise exception '无效的对局时长';
  end if;
  if p_score is not null and p_score not between 0 and 16 then
    raise exception '无效的积分';
  end if;
  if p_winner_label is not null and char_length(p_winner_label) > 40 then
    raise exception '无效的胜者标签';
  end if;
  if p_winner_color is not null and p_winner_color not in (1, 2) then
    raise exception '无效的获胜方颜色';
  end if;

  update public.gomoku_match_log set
    outcome = p_outcome,
    moves = coalesce(p_moves, moves),
    duration_ms = coalesce(p_duration_ms, duration_ms),
    score = coalesce(p_score, score),
    winner_label = coalesce(p_winner_label, winner_label),
    winner_color = coalesce(p_winner_color, winner_color),
    finished_at = coalesce(finished_at, now())
  where fingerprint = clean_fingerprint
    and finished_at is null;
end;
$$;

revoke all on function public.finish_gomoku_match(text, text, integer, integer, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.finish_gomoku_match(text, text, integer, integer, integer, text, integer)
  to anon, authenticated;
