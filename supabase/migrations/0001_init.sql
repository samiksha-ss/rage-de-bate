-- Rage Debate initial schema.
-- Apply with the Supabase SQL editor or `supabase db push`, then run supabase/seed.sql.
-- Dashboard: Authentication → Providers → enable anonymous sign-ins.
-- Realtime: matches and messages are added to supabase_realtime below.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  rating integer not null default 800 check (rating >= 0),
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  body text not null unique,
  is_active boolean not null default true
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id),
  white_id uuid not null references public.profiles (id),
  black_id uuid references public.profiles (id),
  prompt_id uuid references public.prompts (id),
  prompt_body text,
  white_stance text,
  black_stance text,
  status text not null default 'lobby',
  turn text,
  turn_started_at timestamptz,
  white_time_ms integer not null default 180000,
  black_time_ms integer not null default 180000,
  white_message_count integer not null default 0,
  black_message_count integer not null default 0,
  max_messages_each integer not null default 6,
  result text,
  result_reason text,
  winner_id uuid references public.profiles (id),
  judge_summary text,
  judge_json jsonb,
  judge_claimed_at timestamptz,
  judge_claimed_by uuid,
  white_rating_before integer,
  black_rating_before integer,
  white_rating_after integer,
  black_rating_after integer,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  constraint matches_distinct_players check (black_id is null or white_id <> black_id),
  constraint matches_status check (status in ('lobby', 'live', 'judging', 'finished')),
  constraint matches_turn check (turn is null or turn in ('white', 'black')),
  constraint matches_stance_white check (white_stance is null or white_stance in ('for', 'against')),
  constraint matches_stance_black check (black_stance is null or black_stance in ('for', 'against')),
  constraint matches_result check (result is null or result in ('white', 'black', 'draw')),
  constraint matches_result_reason check (result_reason is null or result_reason in ('flag', 'resign', 'judge')),
  constraint matches_clocks_nonnegative check (white_time_ms >= 0 and black_time_ms >= 0),
  constraint matches_prompt_body_len check (prompt_body is null or char_length(prompt_body) > 0)
);

create index matches_status_idx on public.matches (status);
create index matches_white_id_idx on public.matches (white_id);
create index matches_black_id_idx on public.matches (black_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  seat text not null,
  ply integer not null,
  body text not null,
  time_used_ms integer not null,
  time_remaining_ms integer not null,
  mark text,
  mark_note text,
  created_at timestamptz not null default now(),
  constraint messages_match_ply_unique unique (match_id, ply),
  constraint messages_seat check (seat in ('white', 'black')),
  constraint messages_body_len check (char_length(body) between 1 and 600),
  constraint messages_mark check (mark is null or mark in ('!!', '!', '?', '??'))
);

create table public.queue_entries (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  rating integer not null,
  enqueued_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profile trigger
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  adjectives text[] := array[
    'salty', 'loud', 'smug', 'feral', 'glib', 'wry',
    'sharp', 'sly', 'raw', 'brash', 'curt', 'odd'
  ];
  nouns text[] := array[
    'fox', 'pawn', 'gavel', 'spark', 'rook', 'wit',
    'crow', 'jab', 'moth', 'lime', 'judge', 'bit'
  ];
  base text;
  candidate text;
  n integer := 0;
begin
  base :=
    adjectives[1 + floor(random() * array_length(adjectives, 1))::integer]
    || '-'
    || nouns[1 + floor(random() * array_length(nouns, 1))::integer]
    || '-'
    || substr(replace(new.id::text, '-', ''), 1, 4);
  candidate := base;

  while exists (select 1 from public.profiles where username = candidate) loop
    n := n + 1;
    if n > 20 then
      raise exception 'username_exhausted';
    end if;
    candidate := base || '-' || n::text;
  end loop;

  insert into public.profiles (id, username) values (new.id, candidate);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Internal helpers (not granted to clients)
-- ---------------------------------------------------------------------------

create or replace function public.pick_opening(
  out prompt_id uuid,
  out prompt_body text,
  out white_stance text,
  out black_stance text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  select p.id, p.body
  into prompt_id, prompt_body
  from public.prompts p
  where p.is_active
  order by random()
  limit 1;

  if prompt_id is null then
    raise exception 'no_prompts';
  end if;

  if random() < 0.5 then
    white_stance := 'for';
    black_stance := 'against';
  else
    white_stance := 'against';
    black_stance := 'for';
  end if;
end;
$$;

-- Writes the finished row and Elo. Caller must already hold the match lock.
create or replace function public.finish_match(
  p_match public.matches,
  p_result text,
  p_reason text,
  p_white_time_ms integer,
  p_black_time_ms integer
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ra integer;
  v_rb integer;
  v_ea numeric;
  v_score_a numeric;
  v_score_b numeric;
  v_ra_new integer;
  v_rb_new integer;
  v_winner uuid;
  v_row public.matches;
begin
  if p_match.black_id is null then
    raise exception 'no_opponent';
  end if;

  if p_result not in ('white', 'black', 'draw') then
    raise exception 'bad_result';
  end if;

  v_ra := coalesce(p_match.white_rating_before, 800);
  v_rb := coalesce(p_match.black_rating_before, 800);
  v_ea := 1 / (1 + power(10::numeric, (v_rb - v_ra)::numeric / 400));

  if p_result = 'white' then
    v_score_a := 1;
    v_winner := p_match.white_id;
  elsif p_result = 'black' then
    v_score_a := 0;
    v_winner := p_match.black_id;
  else
    v_score_a := 0.5;
    v_winner := null;
  end if;

  v_score_b := 1 - v_score_a;
  v_ra_new := greatest(0, round(v_ra + 32 * (v_score_a - v_ea))::integer);
  v_rb_new := greatest(0, round(v_rb + 32 * (v_score_b - (1 - v_ea)))::integer);

  update public.matches
  set
    status = 'finished',
    result = p_result,
    result_reason = p_reason,
    winner_id = v_winner,
    white_rating_after = v_ra_new,
    black_rating_after = v_rb_new,
    white_time_ms = p_white_time_ms,
    black_time_ms = p_black_time_ms,
    ended_at = now(),
    turn = null,
    turn_started_at = null
  where id = p_match.id
  returning * into v_row;

  update public.profiles
  set
    rating = v_ra_new,
    wins = wins + case when p_result = 'white' then 1 else 0 end,
    losses = losses + case when p_result = 'black' then 1 else 0 end,
    draws = draws + case when p_result = 'draw' then 1 else 0 end
  where id = p_match.white_id;

  update public.profiles
  set
    rating = v_rb_new,
    wins = wins + case when p_result = 'black' then 1 else 0 end,
    losses = losses + case when p_result = 'white' then 1 else 0 end,
    draws = draws + case when p_result = 'draw' then 1 else 0 end
  where id = p_match.black_id;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Client RPCs
-- ---------------------------------------------------------------------------

create or replace function public.server_now()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  return clock_timestamp();
end;
$$;

create or replace function public.create_match()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.matches (created_by, white_id, status)
  values (v_uid, v_uid, 'lobby')
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.join_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_open record;
  v_white_rating integer;
  v_black_rating integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'not_found';
  end if;

  if v_match.white_id = v_uid or v_match.black_id = v_uid then
    return v_match;
  end if;

  if v_match.status <> 'lobby' then
    raise exception 'not_lobby';
  end if;

  if v_match.black_id is not null then
    raise exception 'room_full';
  end if;

  select * into v_open from public.pick_opening();

  select rating into v_white_rating from public.profiles where id = v_match.white_id;
  select rating into v_black_rating from public.profiles where id = v_uid;

  update public.matches
  set
    black_id = v_uid,
    prompt_id = v_open.prompt_id,
    prompt_body = v_open.prompt_body,
    white_stance = v_open.white_stance,
    black_stance = v_open.black_stance,
    white_rating_before = v_white_rating,
    black_rating_before = v_black_rating,
    status = 'live',
    turn = 'white',
    turn_started_at = now(),
    started_at = now()
  where id = p_match_id
  returning * into v_match;

  return v_match;
end;
$$;

-- Time is charged at server receipt (now()), never from a client timestamp.
create or replace function public.submit_message(p_match_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_now timestamptz := now();
  v_seat text;
  v_bank integer;
  v_elapsed integer;
  v_remaining integer;
  v_body text;
  v_ply integer;
  v_message public.messages;
  v_finished public.matches;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'not_found';
  end if;

  if v_match.status <> 'live' then
    raise exception 'not_live';
  end if;

  if v_uid = v_match.white_id then
    v_seat := 'white';
    v_bank := v_match.white_time_ms;
  elsif v_uid = v_match.black_id then
    v_seat := 'black';
    v_bank := v_match.black_time_ms;
  else
    raise exception 'not_seated';
  end if;

  if v_match.turn is distinct from v_seat then
    raise exception 'not_your_turn';
  end if;

  if v_match.turn_started_at is null then
    raise exception 'clock_missing';
  end if;

  v_elapsed := greatest(
    0,
    floor(extract(epoch from (v_now - v_match.turn_started_at)) * 1000)::integer
  );

  if v_elapsed >= v_bank then
    if v_seat = 'white' then
      v_finished := public.finish_match(v_match, 'black', 'flag', 0, v_match.black_time_ms);
    else
      v_finished := public.finish_match(v_match, 'white', 'flag', v_match.white_time_ms, 0);
    end if;
    return jsonb_build_object('flagged', true, 'match', to_jsonb(v_finished));
  end if;

  v_body := btrim(p_body);
  if v_body is null or char_length(v_body) < 1 or char_length(v_body) > 600 then
    raise exception 'bad_body';
  end if;

  v_remaining := v_bank - v_elapsed;
  v_ply := v_match.white_message_count + v_match.black_message_count + 1;

  insert into public.messages (
    match_id,
    author_id,
    seat,
    ply,
    body,
    time_used_ms,
    time_remaining_ms
  )
  values (
    p_match_id,
    v_uid,
    v_seat,
    v_ply,
    v_body,
    v_elapsed,
    v_remaining
  )
  returning * into v_message;

  if v_seat = 'white' then
    v_match.white_message_count := v_match.white_message_count + 1;
    v_match.white_time_ms := v_remaining;
  else
    v_match.black_message_count := v_match.black_message_count + 1;
    v_match.black_time_ms := v_remaining;
  end if;

  if v_match.white_message_count >= v_match.max_messages_each
     and v_match.black_message_count >= v_match.max_messages_each then
    update public.matches
    set
      white_message_count = v_match.white_message_count,
      black_message_count = v_match.black_message_count,
      white_time_ms = v_match.white_time_ms,
      black_time_ms = v_match.black_time_ms,
      status = 'judging',
      turn = null,
      turn_started_at = null
    where id = p_match_id
    returning * into v_match;
  else
    update public.matches
    set
      white_message_count = v_match.white_message_count,
      black_message_count = v_match.black_message_count,
      white_time_ms = v_match.white_time_ms,
      black_time_ms = v_match.black_time_ms,
      turn = case when v_seat = 'white' then 'black' else 'white' end,
      turn_started_at = v_now
    where id = p_match_id
    returning * into v_match;
  end if;

  return jsonb_build_object(
    'flagged', false,
    'message', to_jsonb(v_message),
    'match', to_jsonb(v_match)
  );
end;
$$;

create or replace function public.resign(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_result text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'not_found';
  end if;

  if v_match.status <> 'live' then
    raise exception 'not_live';
  end if;

  if v_uid = v_match.white_id then
    v_result := 'black';
  elsif v_uid = v_match.black_id then
    v_result := 'white';
  else
    raise exception 'not_seated';
  end if;

  return public.finish_match(
    v_match,
    v_result,
    'resign',
    v_match.white_time_ms,
    v_match.black_time_ms
  );
end;
$$;

create or replace function public.claim_flag(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_now timestamptz := now();
  v_bank integer;
  v_elapsed integer;
  v_finished public.matches;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'not_found';
  end if;

  if v_uid is distinct from v_match.white_id and v_uid is distinct from v_match.black_id then
    raise exception 'not_seated';
  end if;

  if v_match.status <> 'live' or v_match.turn is null or v_match.turn_started_at is null then
    return jsonb_build_object(
      'flagged', false,
      'server_now', v_now,
      'white_time_ms', v_match.white_time_ms,
      'black_time_ms', v_match.black_time_ms,
      'turn', v_match.turn,
      'turn_started_at', v_match.turn_started_at
    );
  end if;

  if v_match.turn = 'white' then
    v_bank := v_match.white_time_ms;
  else
    v_bank := v_match.black_time_ms;
  end if;

  v_elapsed := greatest(
    0,
    floor(extract(epoch from (v_now - v_match.turn_started_at)) * 1000)::integer
  );

  if v_elapsed < v_bank then
    return jsonb_build_object(
      'flagged', false,
      'server_now', v_now,
      'white_time_ms', v_match.white_time_ms,
      'black_time_ms', v_match.black_time_ms,
      'turn', v_match.turn,
      'turn_started_at', v_match.turn_started_at
    );
  end if;

  if v_match.turn = 'white' then
    v_finished := public.finish_match(v_match, 'black', 'flag', 0, v_match.black_time_ms);
  else
    v_finished := public.finish_match(v_match, 'white', 'flag', v_match.white_time_ms, 0);
  end if;

  return jsonb_build_object(
    'flagged', true,
    'server_now', v_now,
    'white_time_ms', v_finished.white_time_ms,
    'black_time_ms', v_finished.black_time_ms,
    'turn', v_finished.turn,
    'turn_started_at', v_finished.turn_started_at,
    'match', to_jsonb(v_finished)
  );
end;
$$;

create or replace function public.cancel_lobby(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  delete from public.matches
  where id = p_match_id
    and white_id = v_uid
    and status = 'lobby'
    and black_id is null
  returning id into v_deleted;

  if v_deleted is null then
    raise exception 'cannot_cancel';
  end if;
end;
$$;

create or replace function public.enqueue()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rating integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select rating into v_rating from public.profiles where id = v_uid;
  if v_rating is null then
    raise exception 'no_profile';
  end if;

  insert into public.queue_entries (user_id, rating)
  values (v_uid, v_rating)
  on conflict (user_id) do update
    set enqueued_at = queue_entries.enqueued_at;
end;
$$;

create or replace function public.cancel_queue()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  delete from public.queue_entries where user_id = v_uid;
end;
$$;

create or replace function public.try_quick_match()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing uuid;
  v_partner uuid;
  v_open record;
  v_white_rating integer;
  v_black_rating integer;
  v_match_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Hold our queue row, if we have one, so a partner's skip-locked scan waits us out.
  perform 1
  from public.queue_entries
  where user_id = v_uid
  for update;

  select m.id into v_existing
  from public.matches m
  where m.status in ('lobby', 'live')
    and m.created_at > now() - interval '1 hour'
    and (m.white_id = v_uid or m.black_id = v_uid)
  order by m.created_at desc
  limit 1;

  if v_existing is not null then
    delete from public.queue_entries where user_id = v_uid;
    return jsonb_build_object('match_id', v_existing, 'waiting', false);
  end if;

  select q.user_id into v_partner
  from public.queue_entries q
  where q.user_id <> v_uid
  order by q.enqueued_at
  for update skip locked
  limit 1;

  if v_partner is null then
    select rating into v_white_rating from public.profiles where id = v_uid;
    insert into public.queue_entries (user_id, rating)
    values (v_uid, coalesce(v_white_rating, 800))
    on conflict (user_id) do update
      set enqueued_at = queue_entries.enqueued_at;
    return jsonb_build_object('match_id', null, 'waiting', true);
  end if;

  select * into v_open from public.pick_opening();
  select rating into v_white_rating from public.profiles where id = v_uid;
  select rating into v_black_rating from public.profiles where id = v_partner;

  insert into public.matches (
    created_by,
    white_id,
    black_id,
    prompt_id,
    prompt_body,
    white_stance,
    black_stance,
    status,
    turn,
    turn_started_at,
    started_at,
    white_rating_before,
    black_rating_before
  )
  values (
    v_uid,
    v_uid,
    v_partner,
    v_open.prompt_id,
    v_open.prompt_body,
    v_open.white_stance,
    v_open.black_stance,
    'live',
    'white',
    now(),
    now(),
    v_white_rating,
    v_black_rating
  )
  returning id into v_match_id;

  delete from public.queue_entries where user_id in (v_uid, v_partner);

  return jsonb_build_object('match_id', v_match_id, 'waiting', false);
end;
$$;

-- Service role only. The judge route calls this after the lease is won.
create or replace function public.finalize_judgement(
  p_match_id uuid,
  p_winner text,
  p_summary text,
  p_annotations jsonb
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches;
begin
  if p_winner not in ('white', 'black', 'draw') then
    raise exception 'bad_result';
  end if;

  if p_summary is null or char_length(btrim(p_summary)) = 0 then
    raise exception 'bad_summary';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_annotations, '[]'::jsonb)) as a(ply integer, mark text, note text)
    where a.mark is not null and a.mark not in ('!!', '!', '?', '??')
  ) then
    raise exception 'bad_mark';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'not_found';
  end if;

  if v_match.status = 'finished' and v_match.judge_summary is not null then
    return v_match;
  end if;

  if v_match.status <> 'judging' then
    raise exception 'not_judging';
  end if;

  update public.messages as m
  set
    mark = a.mark,
    mark_note = a.note
  from jsonb_to_recordset(coalesce(p_annotations, '[]'::jsonb)) as a(ply integer, mark text, note text)
  where m.match_id = p_match_id
    and m.ply = a.ply;

  update public.matches
  set
    judge_summary = btrim(p_summary),
    judge_json = jsonb_build_object(
      'winner', p_winner,
      'summary', btrim(p_summary),
      'annotations', coalesce(p_annotations, '[]'::jsonb)
    ),
    judge_claimed_at = null,
    judge_claimed_by = null
  where id = p_match_id
  returning * into v_match;

  return public.finish_match(
    v_match,
    p_winner,
    'judge',
    v_match.white_time_ms,
    v_match.black_time_ms
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.prompts enable row level security;
alter table public.matches enable row level security;
alter table public.messages enable row level security;
alter table public.queue_entries enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (true);

create policy prompts_select on public.prompts
  for select to authenticated
  using (is_active = true);

create policy matches_select on public.matches
  for select to authenticated
  using (
    white_id = auth.uid()
    or black_id = auth.uid()
    or (status = 'lobby' and black_id is null)
  );

create policy messages_select on public.messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.matches m
      where m.id = messages.match_id
        and (m.white_id = auth.uid() or m.black_id = auth.uid())
    )
  );

create policy queue_select on public.queue_entries
  for select to authenticated
  using (user_id = auth.uid());

grant select on public.profiles, public.prompts, public.matches, public.messages, public.queue_entries to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

revoke all on function public.pick_opening() from public, anon, authenticated;
revoke all on function public.finish_match(public.matches, text, text, integer, integer) from public, anon, authenticated;

revoke all on function public.server_now() from public, anon;
revoke all on function public.create_match() from public, anon;
revoke all on function public.join_match(uuid) from public, anon;
revoke all on function public.submit_message(uuid, text) from public, anon;
revoke all on function public.resign(uuid) from public, anon;
revoke all on function public.claim_flag(uuid) from public, anon;
revoke all on function public.cancel_lobby(uuid) from public, anon;
revoke all on function public.enqueue() from public, anon;
revoke all on function public.cancel_queue() from public, anon;
revoke all on function public.try_quick_match() from public, anon;
revoke all on function public.finalize_judgement(uuid, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.server_now() to authenticated;
grant execute on function public.create_match() to authenticated;
grant execute on function public.join_match(uuid) to authenticated;
grant execute on function public.submit_message(uuid, text) to authenticated;
grant execute on function public.resign(uuid) to authenticated;
grant execute on function public.claim_flag(uuid) to authenticated;
grant execute on function public.cancel_lobby(uuid) to authenticated;
grant execute on function public.enqueue() to authenticated;
grant execute on function public.cancel_queue() to authenticated;
grant execute on function public.try_quick_match() to authenticated;
grant execute on function public.finalize_judgement(uuid, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter table public.matches replica identity full;
alter table public.messages replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.matches;
  exception
    when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.messages;
  exception
    when duplicate_object then null;
  end;
end $$;
