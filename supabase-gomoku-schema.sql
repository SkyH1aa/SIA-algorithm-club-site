-- 五子棋累计排行榜：同一个昵称只保留一条记录
-- 可直接在 Supabase SQL Editor 执行。首次执行会从旧 gomoku_scores 汇总历史成绩。

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

-- 将旧的一局一行数据汇总到新表。重复执行不会重复累计。
insert into public.gomoku_players (
  nickname, wins, losses, draws, total_score, total_moves, total_duration_ms
)
select
  trim(nickname),
  count(*) filter (where result = 'win'),
  count(*) filter (where result = 'loss'),
  count(*) filter (where result = 'draw'),
  coalesce(sum(score), 0),
  coalesce(sum(moves), 0),
  coalesce(sum(duration_ms), 0)
from public.gomoku_scores
where char_length(trim(nickname)) between 1 and 20
group by trim(nickname)
on conflict (nickname) do nothing;

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

drop function if exists public.record_gomoku_result(text, text, integer, integer);
create or replace function public.record_gomoku_result(
  p_nickname text,
  p_result text,
  p_moves integer,
  p_duration_ms integer
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
  add_score integer := case when p_result = 'win' then 3 when p_result = 'draw' then 1 else 0 end;
begin
  if char_length(clean_nickname) not between 1 and 20 then
    raise exception '昵称长度必须为 1 到 20 个字符';
  end if;
  if p_result not in ('win', 'loss', 'draw') then
    raise exception '无效的对局结果';
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

revoke all on function public.record_gomoku_result(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_gomoku_result(text, text, integer, integer)
  to anon, authenticated;
