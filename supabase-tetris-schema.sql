-- 俄罗斯方块双排行榜：普通模式 + 人机对战
-- 可直接在 Supabase SQL Editor 执行。
-- 普通榜记录最高分；人机对战榜记录最高的（玩家分 - AI 分），允许负数。

-- ========== 普通模式累计表 ==========
create table if not exists public.tetris_players (
  nickname text primary key
    check (char_length(trim(nickname)) between 1 and 20),
  games_played integer not null default 0 check (games_played >= 0),
  high_score integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.tetris_players is '俄罗斯方块普通模式排行榜：同一昵称一条记录，累计局数与最高分';
comment on column public.tetris_players.nickname is '玩家昵称（主键）';
comment on column public.tetris_players.games_played is '游玩局数';
comment on column public.tetris_players.high_score is '历史最高分';
comment on column public.tetris_players.updated_at is '最近更新时间';

create index if not exists tetris_players_leaderboard_idx
  on public.tetris_players (high_score desc, updated_at asc);

alter table public.tetris_players enable row level security;

drop policy if exists "Public can read tetris players" on public.tetris_players;
create policy "Public can read tetris players"
  on public.tetris_players
  for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.tetris_players from anon, authenticated;
grant select on public.tetris_players to anon, authenticated;

-- ========== 人机对战累计表 ==========
-- high_score 允许负数（玩家分 - AI 分），因此不加 high_score >= 0 约束
create table if not exists public.tetris_versus_players (
  nickname text primary key
    check (char_length(trim(nickname)) between 1 and 20),
  games_played integer not null default 0 check (games_played >= 0),
  high_score integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.tetris_versus_players is '俄罗斯方块人机对战排行榜：最高分为玩家分减 AI 分，可为负';
comment on column public.tetris_versus_players.nickname is '玩家昵称（主键）';
comment on column public.tetris_versus_players.games_played is '人机对战局数';
comment on column public.tetris_versus_players.high_score is '历史最高分差（玩家分 - AI 分，可为负）';
comment on column public.tetris_versus_players.updated_at is '最近更新时间';

create index if not exists tetris_versus_players_leaderboard_idx
  on public.tetris_versus_players (high_score desc, updated_at asc);

alter table public.tetris_versus_players enable row level security;

drop policy if exists "Public can read tetris versus players" on public.tetris_versus_players;
create policy "Public can read tetris versus players"
  on public.tetris_versus_players
  for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.tetris_versus_players from anon, authenticated;
grant select on public.tetris_versus_players to anon, authenticated;

-- ========== 普通模式记分 RPC ==========
drop function if exists public.record_tetris_score(text, integer);
create or replace function public.record_tetris_score(
  p_nickname text,
  p_score integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_nickname text := trim(p_nickname);
begin
  if char_length(clean_nickname) not between 1 and 20 then
    raise exception '昵称长度必须为 1 到 20 个字符';
  end if;
  if p_score is null or p_score < 0 or p_score > 100000000 then
    raise exception '无效的分数';
  end if;

  insert into public.tetris_players (nickname, games_played, high_score)
  values (clean_nickname, 1, p_score)
  on conflict (nickname) do update set
    games_played = tetris_players.games_played + 1,
    high_score = greatest(tetris_players.high_score, excluded.high_score),
    updated_at = now();
end;
$$;

comment on function public.record_tetris_score(text, integer) is '记录普通模式一局分数：局数 +1，最高分取 GREATEST';

revoke all on function public.record_tetris_score(text, integer)
  from public, anon, authenticated;
grant execute on function public.record_tetris_score(text, integer)
  to anon, authenticated;

-- ========== 人机对战记分 RPC ==========
-- p_score 可为负（玩家分 - AI 分）
drop function if exists public.record_tetris_versus_score(text, integer);
create or replace function public.record_tetris_versus_score(
  p_nickname text,
  p_score integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_nickname text := trim(p_nickname);
begin
  if char_length(clean_nickname) not between 1 and 20 then
    raise exception '昵称长度必须为 1 到 20 个字符';
  end if;
  if p_score is null or p_score < -100000000 or p_score > 100000000 then
    raise exception '无效的对战分差';
  end if;

  insert into public.tetris_versus_players (nickname, games_played, high_score)
  values (clean_nickname, 1, p_score)
  on conflict (nickname) do update set
    games_played = tetris_versus_players.games_played + 1,
    high_score = greatest(tetris_versus_players.high_score, excluded.high_score),
    updated_at = now();
end;
$$;

comment on function public.record_tetris_versus_score(text, integer) is '记录人机对战一局分差：局数 +1，最高分差取 GREATEST（可为负）';

revoke all on function public.record_tetris_versus_score(text, integer)
  from public, anon, authenticated;
grant execute on function public.record_tetris_versus_score(text, integer)
  to anon, authenticated;
