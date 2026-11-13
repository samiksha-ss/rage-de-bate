export type Seat = "white" | "black";
export type Stance = "for" | "against";
export type MatchStatus = "lobby" | "live" | "judging" | "finished";
export type MatchResult = "white" | "black" | "draw";
export type ResultReason = "flag" | "resign" | "judge";

export type Profile = {
  id: string;
  username: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  created_at: string;
};

export type Match = {
  id: string;
  created_by: string;
  white_id: string;
  black_id: string | null;
  prompt_id: string | null;
  prompt_body: string | null;
  white_stance: Stance | null;
  black_stance: Stance | null;
  status: MatchStatus;
  turn: Seat | null;
  turn_started_at: string | null;
  white_time_ms: number;
  black_time_ms: number;
  white_message_count: number;
  black_message_count: number;
  max_messages_each: number;
  result: MatchResult | null;
  result_reason: ResultReason | null;
  winner_id: string | null;
  judge_summary: string | null;
  judge_json: unknown;
  judge_claimed_at: string | null;
  judge_claimed_by: string | null;
  white_rating_before: number | null;
  black_rating_before: number | null;
  white_rating_after: number | null;
  black_rating_after: number | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};

export type DebateMessage = {
  id: string;
  match_id: string;
  author_id: string;
  seat: Seat;
  ply: number;
  body: string;
  time_used_ms: number;
  time_remaining_ms: number;
  mark: "!!" | "!" | "?" | "??" | null;
  mark_note: string | null;
  created_at: string;
};

export const MATCH_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
