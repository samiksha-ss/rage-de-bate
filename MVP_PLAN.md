# Rage Debate — MVP Plan

Chess.com energy, absurd motions. Two players get a ridiculous prompt, a random side, and a 3:00 blitz clock each. Chat is the board. Send is the move. An AI judge reviews the game unless somebody flags or resigns.

This document is the build contract. No application code until it is approved.

## Product rules (locked for MVP)

| Rule | Decision |
| --- | --- |
| Clock | 3:00 per player. No increment, no delay. |
| Whose clock runs | The side to move. It runs the whole turn, including while they type. |
| Clock stops | When the server commits their message, then the opponent's clock starts. |
| First move | White. |
| Max length | 6 messages per player (12 plies), then the judge. |
| Flag | Side to move hits 0:00. Opponent wins. No judge. |
| Resign | Opponent wins. No judge. |
| Judge criteria | Wit, commitment to the bit, and rattling the opponent. Truth is irrelevant. |
| Rating | Start at 800. Standard Elo, K = 32, updated on every finished game. |
| Rooms | Create Match → unguessable link. Quick match is a single waiting-row queue. |
| Auth | Supabase anonymous sign-in so a shared link is playable immediately. |

Out of scope: spectators, rematch button, increment, pause-on-disconnect, chat outside the clock, moderation vendor, Glicko, leagues, mobile clients.

Disconnects do not pause the clock. A backgrounded tab still loses on time once the server agrees the bank is gone. That matches blitz and keeps the server rules small.

---

## 1. Database schema (Supabase Postgres)

All game mutations go through `security definer` RPCs. Clients may `select` rows Realtime delivers. Clients do not `insert`/`update`/`delete` matches or messages directly, so a tampered browser cannot write its own clock.

### 1.1 `profiles`

One row per auth user. Created by a trigger on `auth.users`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | `references auth.users(id) on delete cascade` |
| `username` | `text` not null unique | Generated `adjective-noun-####` until we add rename |
| `rating` | `integer` not null default `800` | `check (rating >= 0)` |
| `wins` | `integer` not null default `0` | |
| `losses` | `integer` not null default `0` | |
| `draws` | `integer` not null default `0` | Judge may return a draw |
| `created_at` | `timestamptz` not null default `now()` | |

### 1.2 `prompts`

Library of motions. The match stores a snapshot so later edits do not rewrite history.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `body` | `text` not null unique | e.g. `Cereal is a soup` |
| `is_active` | `boolean` not null default `true` | Inactive rows stay out of the random draw |

Seed at least these (more is fine):

- Cereal is a soup
- Sleep is a scam
- Water is a government conspiracy to sell bottles
- Forks are just spoons that gave up
- The moon is a lazy sun
- Reply-all is a war crime
- Pineapple belongs on pizza, and also on regret
- Mondays are a pyramid scheme
- Socks should be worn on hands
- Elevator small talk should be illegal
- Cats invented capitalism
- The snooze button is performance art
- Birthday candles are a fire hazard and a personality test
- Leftover pizza is a breakfast food
- Autocorrect is gaslighting
- Standing desks are just chairs in denial
- Group projects are a haunting
- Ice is just spicy water
- Brunch is lunch with a PR team
- The five-second rule is peer-reviewed

### 1.3 `matches`

A match is a room, a clock, and a result. Seats are `white` and `black` (chess metaphor). Stance is separate, so "white" is not "FOR".

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK default `gen_random_uuid()` | Also the share id: `/match/[id]` |
| `created_by` | `uuid` not null | `references profiles(id)` |
| `white_id` | `uuid` not null | `references profiles(id)` |
| `black_id` | `uuid` null | Set when the second player joins |
| `prompt_id` | `uuid` null | `references prompts(id)` |
| `prompt_body` | `text` null | Snapshot copied at start |
| `white_stance` | `text` null | `check in ('for', 'against')` |
| `black_stance` | `text` null | Opposite of white |
| `status` | `text` not null default `'lobby'` | See state machine below |
| `turn` | `text` null | `'white'` or `'black'` while `live` |
| `turn_started_at` | `timestamptz` null | Server time when the current turn began |
| `white_time_ms` | `integer` not null default `180000` | Bank **at the start of white's current turn**, or frozen bank when it is black to move |
| `black_time_ms` | `integer` not null default `180000` | Same for black |
| `white_message_count` | `integer` not null default `0` | |
| `black_message_count` | `integer` not null default `0` | |
| `max_messages_each` | `integer` not null default `6` | |
| `result` | `text` null | `'white'`, `'black'`, `'draw'` |
| `result_reason` | `text` null | `'flag'`, `'resign'`, `'judge'` |
| `winner_id` | `uuid` null | `references profiles(id)`; null on draw |
| `judge_summary` | `text` null | Exactly the two-sentence blurb when judged |
| `judge_json` | `jsonb` null | Full structured judge payload |
| `white_rating_before` | `integer` null | Captured when the game starts |
| `black_rating_before` | `integer` null | |
| `white_rating_after` | `integer` null | Written when the game finishes |
| `black_rating_after` | `integer` null | |
| `created_at` | `timestamptz` not null default `now()` | |
| `started_at` | `timestamptz` null | Lobby → live |
| `ended_at` | `timestamptz` null | |

Checks:

- `status in ('lobby', 'live', 'judging', 'finished')`
- `result is null or result in ('white', 'black', 'draw')`
- `result_reason is null or result_reason in ('flag', 'resign', 'judge')`
- `white_id <> black_id` (when `black_id` is not null)
- `white_time_ms >= 0` and `black_time_ms >= 0`
- `char_length(prompt_body) > 0` when not null

Indexes:

- unique `id` (PK) is the lookup for the share link
- `(status)` for any future lobby listing; MVP never lists open rooms publicly
- `(white_id)`, `(black_id)` for "my games" later; cheap to add now

**How the two time columns work**

They are banks, not live countdown values.

- On your turn, your column is the milliseconds you had **when the turn started**. Live remaining is `bank - (now() - turn_started_at)`.
- On your opponent's turn, your column is frozen remaining. It does not change until you move.
- `turn_started_at` is always `clock_timestamp()` / `now()` inside the RPC, never a client-supplied time.

Example. White starts with `180000`, `turn = white`, `turn_started_at = T0`. After 12.4s white sends. Server sets `white_time_ms = 167600`, `turn = black`, `turn_started_at = T1`. Black's column is still `180000`.

### 1.4 `messages`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `match_id` | `uuid` not null | `references matches(id) on delete cascade` |
| `author_id` | `uuid` not null | `references profiles(id)` |
| `seat` | `text` not null | `'white'` or `'black'` |
| `ply` | `integer` not null | 1-based. White plays odd plies. |
| `body` | `text` not null | `check (char_length(body) between 1 and 600)` |
| `time_used_ms` | `integer` not null | Elapsed on that turn |
| `time_remaining_ms` | `integer` not null | Bank after the move |
| `mark` | `text` null | `'!!'`, `'!'`, `'?'`, `'??'`. Null until the judge, and null if the judge skips a ply. |
| `mark_note` | `text` null | One short clause from the judge |
| `created_at` | `timestamptz` not null default `now()` | |

Constraints:

- `unique (match_id, ply)` so a double-submit cannot create two moves on the same ply
- `seat in ('white', 'black')`
- `mark is null or mark in ('!!', '!', '?', '??')`
- index `(match_id, ply)`

### 1.5 `queue_entries`

One waiting player, one row. Quick match deletes the row when paired or cancelled.

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `uuid` PK | `references profiles(id) on delete cascade` |
| `rating` | `integer` not null | Copied from the profile at enqueue time (display only; no rating band in MVP) |
| `enqueued_at` | `timestamptz` not null default `now()` | Oldest row is paired first |

### 1.6 Relationships

```text
auth.users 1 ── 1 profiles
profiles  1 ── * matches        (as white_id, black_id, created_by, winner_id)
prompts   1 ── * matches
matches   1 ── * messages
profiles  1 ── * messages       (author)
profiles  1 ── 0..1 queue_entries
```

### 1.7 State machine

```text
lobby ──join (2nd player)──► live ──12th ply──► judging ──OpenAI ok──► finished
                                 │                  │
                                 ├──resign──────────┤
                                 └──flag────────────┴──────────────────► finished
```

- `lobby`: clocks are not running. `turn` and `turn_started_at` are null. `black_id` is null.
- `live`: clocks running. `turn` is set.
- `judging`: clocks frozen (both banks already reduced, `turn` null, `turn_started_at` null). Transcript is final. Waiting on the model.
- `finished`: `result`, `result_reason`, rating columns, and `ended_at` are set. Judge fields are set only when `result_reason = 'judge'`.

A failed judge call leaves `judging` in place so either client can retry. It does not return the match to `live`.

### 1.8 Triggers

**`handle_new_user`** — `after insert on auth.users`

Inserts a `profiles` row. Username: a small adjective/noun list in SQL plus the first 4 hex chars of the user id, retried on unique violation.

**No trigger writes clocks or calls the judge.** Those stay in RPCs and the Next.js judge route so the transaction boundaries stay obvious.

**Realtime does not need a trigger.** It needs the publication below. Postgres changes are emitted from WAL once the table is in `supabase_realtime`.

### 1.9 Realtime publication

```sql
alter table public.matches replica identity full;
alter table public.messages replica identity full;

alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.messages;
```

`queue_entries` stays off the publication. The waiting client polls `try_quick_match` about every 2 seconds. One row is not worth a channel.

Clients subscribe only after they know the match id:

- `postgres_changes` on `matches` with filter `id=eq.<match_id>`
- `postgres_changes` on `messages` with filter `match_id=eq.<match_id>`

Realtime obeys RLS, so the subscriber must be authenticated and allowed to `select` the row.

### 1.10 RLS policies

Enable RLS on `profiles`, `prompts`, `matches`, `messages`, `queue_entries`.

| Table | Select | Insert / update / delete |
| --- | --- | --- |
| `profiles` | Any authenticated user (ratings are public on the table) | No client writes. Username changes can be an RPC later. |
| `prompts` | Any authenticated user, `is_active = true` | No client writes. |
| `matches` | Authenticated, and (`white_id = auth.uid()` or `black_id = auth.uid()` or (`status = 'lobby'` and `black_id is null`)) | No client writes. Lobby select lets a guest open a link before `join_match`. Unguessable uuid is the access token. |
| `messages` | Authenticated participant of that match (`exists` participant subquery) | No client writes. |
| `queue_entries` | Own row only | No client writes. |

Grants: `authenticated` can `select` those tables and `execute` the RPCs in §3. `anon` has no table access. The judge route uses the **service role** only after it has verified the user with the anon/SSR client, and only to write `judging → finished` plus message marks.

`security definer` functions are owned by `postgres` and `set search_path = public`. Each one starts with `if auth.uid() is null then raise exception`.

### 1.11 RPCs (the only writers)

All of these lock the match row with `select ... for update` so two sends, a send and a flag, or two flag claims serialize.

**`create_match()` → `uuid`**

Insert `status = lobby`, `white_id = auth.uid()`, `created_by = auth.uid()`. Do not pick a prompt yet (avoids burning a prompt if nobody joins). Do not start the clock.

**`join_match(p_match_id uuid)` → `matches`**

- Caller is already white or black: return the row (refresh-safe).
- `status = lobby`, `black_id is null`, caller is not white:
  - set `black_id`
  - pick `prompts` where `is_active` order by `random()` limit 1; copy `prompt_id` and `prompt_body`
  - coin-flip `white_stance`; black gets the other
  - copy both ratings into `*_rating_before`
  - `status = live`, `turn = white`, `turn_started_at = now()`, `started_at = now()`
  - banks stay `180000`
- Otherwise raise `room_full` or `not_lobby`.

**`submit_message(p_match_id uuid, p_body text)` → row**

1. Lock match. Require `status = live`.
2. Map `auth.uid()` to seat. Require `turn` to be that seat.
3. `elapsed_ms = greatest(0, floor(extract(epoch from (now() - turn_started_at)) * 1000))`.
4. If `elapsed_ms >=` the mover's bank: apply a flag loss (same writes as `claim_flag`) and return `{ flagged: true }`. The late message is **not** stored.
5. Reject empty/over-long bodies (`char_length` 1–600 after `btrim`).
6. `remaining = bank - elapsed_ms`.
7. Insert message with next ply (`white_message_count + black_message_count + 1`), `time_used_ms`, `time_remaining_ms`.
8. Increment that seat's message count and set their bank to `remaining`.
9. If both counts equal `max_messages_each`: set `status = judging`, `turn = null`, `turn_started_at = null`. Do not set a winner here.
10. Else set `turn` to the other seat and `turn_started_at = now()`.

**`resign(p_match_id uuid)`**

Lock. Require `status = live`. Winner is the other seat. `result_reason = resign`, `status = finished`, `ended_at = now()`. Apply Elo (§1.12).

**`claim_flag(p_match_id uuid)` → `{ flagged, server_now, white_time_ms, black_time_ms, turn, turn_started_at }`**

Lock. If not `live`, return the row as-is with `flagged: false`.

`elapsed` as in submit. If `elapsed >=` side-to-move bank: set that bank to `0`, winner = the other seat, `result_reason = flag`, `status = finished`, Elo, `flagged: true`.

If the bank remains, return `flagged: false` plus `now()` so the client can correct skew. Calling this early must not change the match. Both clients may call it; the row lock makes one of them the writer.

**`cancel_lobby(p_match_id uuid)`**

White only, `status = lobby`. Delete the row.

**`enqueue()` / `cancel_queue()` / `try_quick_match()`**

`try_quick_match`:

1. If the caller is already white/black on a `lobby` or `live` match created in the last hour, return that id (double-click safe).
2. `select user_id from queue_entries where user_id <> auth.uid() order by enqueued_at for update skip locked limit 1`.
3. If a partner exists: delete both queue rows, create a match already past lobby (caller is white, partner is black, prompt and clock started the same way as `join_match`), return `{ match_id, waiting: false }`.
4. If none: `insert into queue_entries ... on conflict (user_id) do update set enqueued_at = queue_entries.enqueued_at` (keep their original place), return `{ waiting: true }`.

Pairing uses `for update skip locked` so two simultaneous searches cannot take the same partner.

### 1.12 Elo

On every transition to `finished`, inside the same transaction:

```text
E(a) = 1 / (1 + 10 ^ ((Rb - Ra) / 400))
score = 1 if a won, 0.5 draw, 0 loss
Ra' = round(Ra + 32 * (score - E(a)))
Rb' = round(Rb + 32 * ((1 - score) - (1 - E(a))))
```

Clamp at 0. Write `*_rating_after` on the match and update `profiles.rating` plus wins/losses/draws. Flag, resign, and judge all use this. `result_reason` is the only difference.

### 1.13 Judge JSON stored in `judge_json`

```json
{
  "winner": "white",
  "summary": "Two sentences. Snarky. Specific to what they actually said.",
  "annotations": [
    { "ply": 1, "mark": "!!", "note": "Opened by accusing oatmeal of identity theft." },
    { "ply": 2, "mark": "?", "note": "Answered a bit with a Wikipedia tone." }
  ]
}
```

`winner` is `white` | `black` | `draw`. `mark` is `!!` | `!` | `?` | `??` | `null`. `summary` is two sentences. Every ply should appear once; `null` mark means "unremarkable move".

Mark legend, fixed in the UI:

| Mark | Label |
| --- | --- |
| `!!` | Brilliant Bait |
| `!` | Great Comeback |
| `?` | Weak Point |
| `??` | Blunder / Got Tilted |

---

## 2. Timer and state architecture

### 2.1 Authority

The browser renders a countdown. Postgres decides whether time remains.

| Fact | Where it lives |
| --- | --- |
| Bank at turn start | `matches.*_time_ms` |
| When the turn began | `matches.turn_started_at` |
| Whose turn | `matches.turn` |
| Whether the game ended | `matches.status`, `result`, `result_reason` |
| Smooth 10fps digits | Client `requestAnimationFrame` or a 100ms tick **recomputing** the formula |

The tick is paint. If the tab sleeps, the next frame subtracts the real gap. Nothing is "decremented by 100" on an interval, because a throttled timer would gift the player free seconds.

Displayed remaining for the side to move:

```text
estimatedServerNow = Date.now() + clockOffsetMs
remainingMs = bankMs - (estimatedServerNow - turnStartedAtMs)
```

The other side displays their frozen bank.

`clockOffsetMs` comes from the server, not from guessing:

1. On mount, call `claim_flag` is wrong for this (it is a mutation attempt). Add a tiny RPC `server_now()` returning `now()`, or read `turn_started_at` only as a timestamptz and also request `server_now()`.
2. `clockOffsetMs = serverNowMs - Date.now()`.
3. Refresh the offset every 30s and whenever `claim_flag` or `submit_message` returns.
4. Clamp the painted value at 0. Hitting 0 locally calls `claim_flag`. The UI shows a loss only after the response (or a Realtime update) says `status = finished`.

### 2.2 Why this resists cheating

- Clock columns are not client-writable (RLS + no grants).
- Elapsed time uses `now()` inside the locked RPC. A fake `Date` on the client changes the animation and does not change the stored bank.
- Time is charged until the server receives the move. The sender pays their own network latency. That is the usual blitz rule and it removes "I clicked send at 0.1 locally".
- `claim_flag` before the bank is gone is a no-op read of the lock.
- Two clients calling `claim_flag` at 0:00: one transaction sets `finished`, the other sees `status <> live` and returns.
- A forged "I have 3 minutes left" Realtime event cannot be produced by another user; they cannot `update` the row. Service role is only on the server.

### 2.3 Send path

```text
Player hits Send
  → composer disables, optimistic bubble optional but clock keeps using server anchors
  → supabase.rpc('submit_message')
  → Postgres locks, charges elapsed, inserts message, flips turn OR sets judging
  → Realtime UPDATE on matches + INSERT on messages
  → both clients replace local state with the payload
  → if status is judging, the client that got the RPC result POSTs /api/matches/[id]/judge
    (the other client also POSTs if it sees judging with empty judge_summary; the route is idempotent)
```

Optimistic clock-stop is allowed as polish: freeze the sender's digits when the request starts, then snap to `time_remaining_ms` from the inserted message. If the RPC returns flagged, drop the optimistic bubble and show the loss.

### 2.4 Flag path

Each client, while `status = live` and it is painting the active clock:

- When computed remaining `<= 0`, call `claim_flag` once, then again on the next Realtime echo only if still `live` (retry with backoff, max 3).
- Also call `claim_flag` on `visibilitychange` to visible, because a background tab may have skipped frames while the opponent's clock expired. The RPC still checks real elapsed.

There is no cron in the MVP. A game only ends on time if a client asks, or if the expired player manages to submit (the submit RPC flags them and discards the body). If both players hard-close the tab at 0:00, the row stays `live` until someone reopens the link and the client claims. Acceptable for MVP. A later `pg_cron` sweeper can call the same function.

### 2.5 Judging race

`submit_message` is the only transition to `judging`. The judge route does:

```text
update matches
  set status = 'judging'  -- already judging; use a claim column instead
```

Use a dedicated claim so two POSTs cannot both call OpenAI:

```text
update matches
set judge_claimed_at = now(), judge_claimed_by = auth.uid()
where id = $1 and status = 'judging' and judge_summary is null
  and (judge_claimed_at is null or judge_claimed_at < now() - interval '45 seconds')
returning *;
```

Add columns:

| Column | Type | Notes |
| --- | --- | --- |
| `judge_claimed_at` | `timestamptz` null | Lease |
| `judge_claimed_by` | `uuid` null | |

The winner of the `returning` row calls OpenAI. The loser polls the match via Realtime until `finished`. If OpenAI throws, clear `judge_claimed_at` so the 45s lease is immediate and the UI can offer Retry.

Add these two columns to the `matches` table in the initial migration (they are part of the schema, not a follow-up).

### 2.6 Client state shape

One hook, `useMatch(id)`, owns:

- `match` row from initial fetch + Realtime updates
- `messages` ordered by `ply`
- `clockOffsetMs`
- derived `whiteRemainingMs` / `blackRemainingMs` / `activeSeat`
- `mySeat`: `'white' | 'black' | null`

Components read that hook. They do not start their own clocks.

---

## 3. API routes and server actions

Game mutations are Postgres RPCs called with the user-scoped Supabase client (`auth.uid()` works, one round trip, row locks). The OpenAI key never goes in an RPC.

### 3.1 Server-only

| Entry | Type | Role |
| --- | --- | --- |
| `POST /api/matches/[id]/judge` | Route handler | Load session with `@supabase/ssr`. Caller must be white or black. Claim lease. If `result_reason` would have been flag/resign, refuse (those never enter `judging`). Load messages by `ply`. Call `gpt-4o-mini`. Validate with Zod. Service-role client writes marks, `judge_summary`, `judge_json`, winner, Elo via a `finalize_judgement(...)` RPC that is **not** granted to `authenticated` (service role bypasses grants, or grant execute only to `service_role`). |
| `GET /auth/callback` | Route handler | Exchange Supabase magic-link code if we add email later. Anonymous sign-in does not need it on day one; include the route anyway so the SSR template is complete. |

`finalize_judgement` is the one RPC that takes winner, summary, and annotations and performs the `judging → finished` transition plus Elo. It re-checks `status = 'judging'`. Called with the service role only.

### 3.2 RPCs the browser calls

| RPC | When |
| --- | --- |
| `create_match` | Create Match button |
| `join_match` | Open `/match/[id]` while lobby and not seated, or auto on mount if `black_id` is null and viewer is not white |
| `submit_message` | Send |
| `resign` | Resign confirm |
| `claim_flag` | Local remaining hits 0, and on tab focus |
| `server_now` | Offset sync |
| `cancel_lobby` | Leave an empty room |
| `enqueue` / `cancel_queue` / `try_quick_match` | Quick match button |

No separate "create room" REST route. The button calls the RPC and `router.push('/match/' + id)`.

### 3.3 Judge request contract

Model: `gpt-4o-mini`.

`response_format`: JSON schema, `strict: true`.

System prompt (substance, not the final prose):

- You are the floor judge of a comedy blitz debate.
- Score wit, commitment to the bit, and whether they rattled the opponent.
- Factual correctness is a weakness if it kills the joke. Breaking character is a blunder.
- Do not reward slurs, threats, or sexual content involving minors. If a player does that, mark those plies `??` and prefer the other player.
- `summary` is exactly two sentences, specific, a little mean, no hashtags.
- Annotate every ply. Use `null` when a move is fine and unremarkable. Spend `!!` rarely.

User message: prompt, both stances, both usernames, transcript as `ply | seat | stance | text`.

Zod rejects unknown marks, missing plies, and summaries that are empty. On rejection, one retry with the validation error appended, then surface "Judge choked. Retry." and clear the lease.

Temperature: `0.7` so the writeup has a voice. The schema still constrains the shape.

### 3.4 Env

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY   # server only, judge finalizer
OPENAI_API_KEY              # server only
```

Anonymous sign-in enabled in the Supabase dashboard. Realtime enabled for the project.

---

## 4. Folder structure and UI

### 4.1 Tree

```text
app/
  layout.tsx                 # dark shell, fonts
  page.tsx                   # home: rating, create, quick match
  match/[id]/page.tsx        # lobby OR table; client component child
  auth/callback/route.ts
  api/matches/[id]/judge/route.ts
components/
  home-actions.tsx           # create / queue buttons
  match-room.tsx             # switches lobby vs live vs review
  match-lobby.tsx            # copy link, "waiting for opponent"
  player-bar.tsx             # username, stance, rating, active glow
  chess-clock.tsx            # one clock face; parent passes ms + active + danger
  prompt-banner.tsx          # the motion, big type
  debate-chat.tsx            # move list + composer
  post-match-review.tsx      # result, summary, annotated plies, rating delta
  resign-dialog.tsx
lib/
  supabase/client.ts
  supabase/server.ts
  supabase/middleware.ts
  game/clock.ts              # pure remainingMs() used by the hook and unit-tested
  game/marks.ts              # !! ! ? ?? labels
  judge/schema.ts            # zod schema shared with the route
  judge/prompt.ts
  types.ts
supabase/
  migrations/0001_init.sql   # tables, RLS, triggers, RPCs
  seed.sql                   # prompts
middleware.ts                # refresh session
```

`lib/game/clock.ts` is pure: `(bankMs, turnStartedAtMs, estimatedServerNowMs) => remainingMs`. Test that without a browser.

### 4.2 Pages

**`/`**

- Wordmark, one-line pitch.
- Your rating and W-L-D once a profile exists. The page calls anonymous `signInAnonymously()` if there is no session, then reads `profiles`.
- Primary button: Create Match.
- Secondary: Quick Match (shows "Searching…" and a cancel that calls `cancel_queue`).
- A short "how a game ends" strip: flag, resign, or the judge after 6 moves each.

**`/match/[id]`**

Three screens inside `match-room`, chosen from `status` and seat:

1. **Lobby** (`status = lobby`). Copy link, your seat, spinner until Realtime shows `black_id` and `status = live`. If you are not white and the seat is empty, mount calls `join_match`.
2. **Table** (`live` or `judging`). Clocks, prompt, chat. Composer enabled only when `mySeat === turn` and `status === live`. During `judging`, composer hidden and a "Judge is writing the roast…" line shows.
3. **Review** (`finished`). `PostMatchReview` replaces the composer. Clocks show the final banks (0 for the flagged player).

Room full, or lobby cancelled: a single message and a link home. No spectator view.

### 4.3 Components

**`ChessClock`**

- Props: `label`, `remainingMs`, `active`, `seat`.
- Format `m:ss`. Under 10s, tenths (`0:09.4`) and a red face.
- Active clock gets a bright rim (chess.com-style green/gold on near-black). Inactive clock is dim.
- Two instances, opponent on top, you on the bottom, same as a board.

**`DebateChat`**

- Move-list layout, not a bubble messenger. Rows like `1.` then white's text, then black's, with the mark glyph on the left once judged.
- Composer: textarea, Enter sends, Shift+Enter newline, 600-char counter, Send button.
- Disabled copy when it is not your turn: the opponent's clock is the explanation, so the placeholder can read "Their clock."
- Resign sits in the chrome, with a confirm step.

**`PostMatchReview`**

- Result line: `You won on time`, `You resigned`, `You got flagged`, or `Judge: you won / lost / drew`.
- Rating `800 → 816`.
- The two-sentence summary in a pull quote.
- The same transcript with marks and the one-line note under each marked ply.
- Legend for `!! ! ? ??`.

**Visual direction**

Black stage inside a periwinkle barber-pole frame, film-sprocket bars on the top and bottom. Home spells RAGE in a few of those holes. The wordmark is chunky sticker letters; "debate" and the motion are a high-contrast serif. A polaroid, a sticky-note rating, and one bang sticker sit in the margins. The match table stays sparse: opponent on top, you on the bottom, the motion as the only large type. Active clock is gold (`#ffe14a`), flag-danger is coral (`#ff7a62`), inactive clocks are dim, digits are tabular. No purple gradient fill, no card-grid marketing layout on the match page.

### 4.4 Hook behavior checklist

- Initial load: `select` match + messages, subscribe, then `join_match` if needed, then `server_now`.
- Realtime update replaces the match object by `id`. Message insert upserts on `ply`.
- Unmount removes the channel.
- `judging` without `judge_summary`: POST judge once per mount.

---

## 5. Phased build order

Each milestone is shippable and testable before the next starts. Stay inside the milestone; do not stub the judge inside milestone 2 beyond setting `status = judging` and showing a waiting line.

### Milestone 1 — Setup and database

Goal: two browsers can create a room, open the link, and both appear in a lobby. No clocks yet.

1. `create-next-app` with App Router, TypeScript, Tailwind, ESLint. Add `@supabase/supabase-js`, `@supabase/ssr`.
2. Supabase project. Enable anonymous auth and Realtime.
3. Write `supabase/migrations/0001_init.sql` with every table, check, index, trigger, RLS policy, and RPC in this plan (including queue and judge-lease columns). Apply it.
4. Seed prompts.
5. Wire browser + server Supabase clients and session middleware.
6. Home page: anonymous sign-in, show username and 800 rating, Create Match → push to `/match/[id]`.
7. Match page lobby: copy link, second browser joins, both see `live` flip via Realtime. Prompt and stances visible. Clocks render as static `3:00`.
8. Confirm a logged-out (no JWT) client cannot select the match, and a third user who is not in a `live` match cannot select it.

**Done when:** a second account joins from the copied URL, both screens show the same prompt and opposite stances, and the match row has `turn = white`, `turn_started_at` set, banks `180000`.

### Milestone 2 — Realtime chat and clocks

Goal: a full game can end by flag, resign, or move limit. Judge is a waiting state.

1. `lib/game/clock.ts` plus a small unit test for remaining time, clamp at 0, and frozen opponent bank.
2. `useMatch`: subscribe, offset sync, paint loop.
3. `ChessClock`, `DebateChat`, `PlayerBar`, `PromptBanner` on the live table.
4. `submit_message` wired to Send. Verify in SQL that banks and `turn_started_at` move together, and that `unique (match_id, ply)` holds under a double click.
5. Resign with confirm.
6. `claim_flag` from local 0:00 and from tab refocus. Test by setting a match's bank to `3000` in SQL (dev only) so you do not wait 3 minutes.
7. 12th ply sets `judging` and both clients hide the composer.
8. Quick match: enqueue, second client gets pushed into the new match, cancel works, refresh does not create a second queue row.

**Done when:**

- A send from client A starts client B's clock within one Realtime frame, and a reload mid-turn shows the same remaining time (within ~1s of skew correction).
- Setting the system clock back on one browser does not grant extra server time (compare `time_used_ms` to wall clock on the server).
- Flag and resign set `finished`, winner, and rating columns, and do not call `/api/matches/.../judge`.
- The 12th message sets `judging` with both counts at 6.

### Milestone 3 — AI judge and review UI

Goal: a max-length game produces a roast and chess-style marks.

1. Add `openai` and `zod`. Implement schema, prompt, and `POST /api/matches/[id]/judge`.
2. `finalize_judgement` writes marks, summary, result, Elo, `finished`.
3. Lease test: two parallel POSTs produce one OpenAI call (log it) and one final row.
4. `PostMatchReview` on `finished`, including flag/resign copy with no fake marks.
5. Failure path: bad API key shows Retry; retry after the lease clears completes the game.
6. Pass over the table UI: danger clock under 10s, disabled composer off-turn, room-full state, empty send ignored.

**Done when:** a 12-move game shows a two-sentence summary, every ply in order, marks only from the allowed set, and both profiles' ratings moved by the Elo formula. A resigned game shows no judge copy.

### Suggested verification (all milestones)

- Two real browser profiles (normal + private), not two tabs of one anonymous user. Anonymous users are distinct per browser profile; two tabs share a session and must be rejected by `white_id <> black_id`.
- Desktop width first. Then a narrow window: clocks stay readable, composer usable.
- After milestone 2 and 3, play one full game and one flag, not only a screenshot.

---

## 6. Implementation notes to avoid rework

- Generate TypeScript types from the Supabase schema after migration (`supabase gen types`) and import them in `lib/types.ts`. Hand-written duplicates will drift.
- Keep `remainingMs` math in one pure function. The hook and any debug overlay both call it.
- Snapshot `prompt_body` even though we also store `prompt_id`.
- Charge time at server receipt. Document that in a one-line comment above `submit_message` so nobody "fixes" it by trusting the client timestamp.
- Do not put `OPENAI_API_KEY` or the service role key in `NEXT_PUBLIC_*`.
- Judge never runs for `flag` or `resign`. The route should reject those if a client asks anyway.
- Message bodies are untrusted. Render as text, not HTML.

## 7. Approval gate

After this plan is approved, build milestone 1 only and stop for a playtest of the lobby before clocks. If you want a change first, the usual ones are: message cap, clock length, anonymous auth vs email magic link, and whether quick match ships in milestone 2 or waits.
