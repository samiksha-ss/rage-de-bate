"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MatchLobby } from "@/components/match-lobby";
import { PlayerBar } from "@/components/player-bar";
import { PromptBanner } from "@/components/prompt-banner";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { ensureUser } from "@/lib/supabase/session";
import {
  MATCH_UUID,
  type DebateMessage,
  type Match,
  type Profile,
  type Seat,
} from "@/lib/types";

const STATUS_RANK = { lobby: 0, live: 1, judging: 2, finished: 3 };

function mergeMatch(previous: Match | null, next: Match | null) {
  if (!next) return previous;
  if (!previous || previous.id !== next.id) return next;
  if (STATUS_RANK[next.status] > STATUS_RANK[previous.status]) return next;
  if (STATUS_RANK[next.status] < STATUS_RANK[previous.status]) return previous;
  const previousPlies =
    previous.white_message_count + previous.black_message_count;
  const nextPlies = next.white_message_count + next.black_message_count;
  if (nextPlies !== previousPlies) {
    return nextPlies > previousPlies ? next : previous;
  }
  return next;
}

function asMatch(data: unknown): Match | null {
  if (!data) return null;
  if (Array.isArray(data)) return (data[0] as Match | undefined) ?? null;
  return data as Match;
}

const sampleProfiles: Record<string, Profile> = {
  "preview-white": {
    id: "preview-white",
    username: "salty-fox-1a2b",
    rating: 800,
    wins: 3,
    losses: 1,
    draws: 0,
    created_at: "",
  },
  "preview-black": {
    id: "preview-black",
    username: "smug-pawn-9c0d",
    rating: 842,
    wins: 4,
    losses: 2,
    draws: 1,
    created_at: "",
  },
};

function sampleMatch(): Match {
  return {
    id: "preview",
    created_by: "preview-white",
    white_id: "preview-white",
    black_id: "preview-black",
    prompt_id: null,
    prompt_body: "Cereal is a soup",
    white_stance: "for",
    black_stance: "against",
    status: "live",
    turn: "white",
    turn_started_at: new Date().toISOString(),
    white_time_ms: 180000,
    black_time_ms: 180000,
    white_message_count: 0,
    black_message_count: 0,
    max_messages_each: 6,
    result: null,
    result_reason: null,
    winner_id: null,
    judge_summary: null,
    judge_json: null,
    judge_claimed_at: null,
    judge_claimed_by: null,
    white_rating_before: 800,
    black_rating_before: 842,
    white_rating_after: null,
    black_rating_after: null,
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    ended_at: null,
  };
}

export function MatchRoom({ id }: { id: string }) {
  const router = useRouter();
  const [match, setMatch] = useState<Match | null>(null);
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "closed">("loading");
  const [closedCopy, setClosedCopy] = useState("This room is closed.");
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (id === "preview" && process.env.NODE_ENV === "development") {
      setMatch(sampleMatch());
      setProfiles(sampleProfiles);
      setUserId("preview-white");
      setPhase("ready");
      return;
    }

    if (!MATCH_UUID.test(id) || !isSupabaseConfigured()) {
      setPhase("closed");
      return;
    }

    const supabase = createClient();
    let cancelled = false;

    const channel = supabase
      .channel(`match:${id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "matches",
          filter: `id=eq.${id}`,
        },
        (payload) => {
          setMatch((current) => mergeMatch(current, payload.new as Match));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `match_id=eq.${id}`,
        },
        (payload) => {
          const row = payload.new as DebateMessage;
          setMessages((current) => {
            if (current.some((message) => message.ply === row.ply)) {
              return current;
            }
            return [...current, row].sort((a, b) => a.ply - b.ply);
          });
        },
      )
      .subscribe();

    async function load() {
      try {
        const user = await ensureUser(supabase);
        if (cancelled) return;
        setUserId(user.id);

        const { data: row, error } = await supabase
          .from("matches")
          .select("*")
          .eq("id", id)
          .maybeSingle();

        if (cancelled) return;
        if (error) {
          setClosedCopy("This room is closed.");
          setPhase("closed");
          return;
        }

        let next = asMatch(row);
        const seated =
          next &&
          (next.white_id === user.id || next.black_id === user.id);

        if (!seated) {
          const { data: joined, error: joinError } = await supabase.rpc(
            "join_match",
            { p_match_id: id },
          );
          if (cancelled) return;
          if (joinError) {
            setClosedCopy(
              joinError.message.includes("room_full")
                ? "This room is full."
                : joinError.message.includes("no_prompts")
                  ? "The deck is empty. Seed the motions, then try the link again."
                  : "This room is closed.",
            );
            setPhase("closed");
            return;
          }
          next = asMatch(joined);
        }

        if (!next) {
          setPhase("closed");
          return;
        }

        setMatch((current) => mergeMatch(current, next));

        const { data: messageRows } = await supabase
          .from("messages")
          .select("*")
          .eq("match_id", id)
          .order("ply", { ascending: true });

        if (!cancelled && messageRows) {
          setMessages(messageRows as DebateMessage[]);
        }
        if (!cancelled) setPhase("ready");
      } catch {
        if (!cancelled) {
          setClosedCopy("Could not sign in.");
          setPhase("closed");
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [id]);

  useEffect(() => {
    if (!match || match.id === "preview" || !isSupabaseConfigured()) return;
    const ids = [match.white_id, match.black_id].filter(
      (value): value is string => Boolean(value),
    );
    if (ids.length === 0) return;

    const supabase = createClient();
    let cancelled = false;

    supabase
      .from("profiles")
      .select("id, username, rating, wins, losses, draws, created_at")
      .in("id", ids)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setProfiles((current) => {
          const next = { ...current };
          for (const profile of data as Profile[]) {
            next[profile.id] = profile;
          }
          return next;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [match]);

  async function closeRoom() {
    if (!match || closing) return;
    setClosing(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("cancel_lobby", {
      p_match_id: match.id,
    });
    if (error) {
      setClosedCopy("This room is already gone.");
      setPhase("closed");
      return;
    }
    router.push("/");
  }

  if (phase === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center px-5">
        <p className="font-serif text-4xl text-cream italic">Dealing…</p>
      </div>
    );
  }

  if (phase === "closed" || !match) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-5 text-center">
        <h2 className="font-serif text-5xl text-cream italic">{closedCopy}</h2>
        <Link
          href="/"
          className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-gold"
        >
          Home
        </Link>
      </div>
    );
  }

  if (match.status === "lobby") {
    const seatLabel = userId === match.white_id ? "White" : "Black";
    return (
      <MatchLobby
        seatLabel={seatLabel}
        onClose={() => void closeRoom()}
        closing={closing}
      />
    );
  }

  const mySeat: Seat | null =
    userId === match.white_id
      ? "white"
      : userId === match.black_id
        ? "black"
        : null;
  const topSeat: Seat = mySeat === "black" ? "white" : "black";
  const bottomSeat: Seat = topSeat === "white" ? "black" : "white";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 px-4 py-8 sm:px-6">
      {match.id === "preview" ? (
        <p className="text-center font-mono text-[10px] uppercase tracking-[0.28em] text-cream/40">
          Sample table
        </p>
      ) : null}
      <SeatRow
        match={match}
        profiles={profiles}
        seat={topSeat}
        isMe={mySeat === topSeat}
      />
      <PromptBanner body={match.prompt_body} />
      <SeatRow
        match={match}
        profiles={profiles}
        seat={bottomSeat}
        isMe={mySeat === bottomSeat}
      />
      <div className="border-t border-cream/10 pt-4">
        {messages.length === 0 ? (
          <p className="font-serif text-xl text-cream/70 italic">
            {match.status === "live" ? "White to move." : "No moves."}
          </p>
        ) : (
          <ol className="space-y-3">
            {messages.map((message) => (
              <li
                key={message.id}
                className="grid grid-cols-[2.25rem_1fr] gap-3 font-mono text-sm leading-relaxed"
              >
                <span className="text-cream/35">{message.ply}.</span>
                <span>
                  <span className="mr-2 text-[10px] uppercase tracking-[0.16em] text-cream/40">
                    {message.seat}
                  </span>
                  {message.body}
                </span>
              </li>
            ))}
          </ol>
        )}
        {match.status === "judging" ? (
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.22em] text-gold">
            Judge is writing the roast…
          </p>
        ) : null}
        {match.status === "finished" ? (
          <p className="mt-4 font-serif text-3xl text-cream italic">Game over.</p>
        ) : null}
      </div>
    </div>
  );
}

function SeatRow({
  match,
  profiles,
  seat,
  isMe,
}: {
  match: Match;
  profiles: Record<string, Profile>;
  seat: Seat;
  isMe: boolean;
}) {
  const playerId = seat === "white" ? match.white_id : match.black_id;
  const profile = playerId ? profiles[playerId] : undefined;
  const rating =
    seat === "white"
      ? (match.white_rating_before ?? profile?.rating ?? null)
      : (match.black_rating_before ?? profile?.rating ?? null);

  return (
    <PlayerBar
      seat={seat}
      username={profile?.username ?? "…"}
      rating={rating}
      stance={seat === "white" ? match.white_stance : match.black_stance}
      remainingMs={seat === "white" ? match.white_time_ms : match.black_time_ms}
      active={match.status === "live" && match.turn === seat}
      isMe={isMe}
    />
  );
}
