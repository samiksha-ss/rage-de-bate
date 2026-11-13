import { ChessClock } from "@/components/chess-clock";
import type { Seat, Stance } from "@/lib/types";

export function PlayerBar({
  seat,
  username,
  rating,
  stance,
  remainingMs,
  active,
  isMe,
}: {
  seat: Seat;
  username: string;
  rating: number | null;
  stance: Stance | null;
  remainingMs: number;
  active: boolean;
  isMe: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 border px-4 py-3 ${
        active ? "border-gold/70 bg-black" : "border-cream/10 bg-black/30"
      }`}
    >
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/45">
          {seat}
          {isMe ? <span className="ml-2 text-gold">You</span> : null}
        </div>
        <div className="truncate font-serif text-2xl italic leading-tight text-cream sm:text-3xl">
          {username}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {stance ? (
            <span
              className={`inline-block -rotate-2 px-2 py-0.5 font-sticker text-sm tracking-wide text-ink ${
                stance === "for" ? "bg-mint" : "bg-pink"
              }`}
            >
              {stance === "for" ? "FOR" : "AGAINST"}
            </span>
          ) : null}
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cream/45">
            {rating ?? "—"}
          </span>
        </div>
      </div>
      <ChessClock remainingMs={remainingMs} active={active} />
    </div>
  );
}
