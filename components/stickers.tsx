import type { Profile } from "@/lib/types";

export function HeartPolaroid({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute w-[4.5rem] -rotate-6 bg-cream p-1.5 pb-5 shadow-[4px_5px_0_#000] ${className}`}
    >
      <div className="grid aspect-square place-items-center bg-pink">
        <svg viewBox="0 0 24 24" className="w-8" aria-hidden="true">
          <path
            fill="#141414"
            d="M12 20.5s-6.4-4.2-9.1-7.8C.7 9.8.6 6.9 2.5 5.2 4.4 3.5 7 3.8 8.8 5.6L12 8.6l3.2-3c1.8-1.8 4.4-2.1 6.3-.4 1.9 1.7 1.8 4.6-.4 7.5-2.7 3.6-9.1 7.8-9.1 7.8z"
          />
        </svg>
      </div>
    </div>
  );
}

export function BangSticker({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute grid size-16 rotate-6 place-items-center rounded-full bg-gold font-sticker text-4xl text-ink shadow-[4px_4px_0_#000] ${className}`}
    >
      !
    </div>
  );
}

export function NoteSticker({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute grid size-14 -rotate-12 place-items-center rounded-full bg-sky font-sticker text-3xl text-ink shadow-[4px_4px_0_#000] ${className}`}
    >
      ♪
    </div>
  );
}

export function RatingNote({
  profile,
  className = "",
}: {
  profile: Profile | null;
  className?: string;
}) {
  return (
    <div
      className={`w-36 rotate-[3deg] bg-gold px-4 py-3 text-left text-ink shadow-[5px_6px_0_#000] ${className}`}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.16em]">
        Rating
      </div>
      <div className="mt-1 font-sticker text-5xl leading-none">
        {profile ? profile.rating : "800"}
      </div>
      <div className="mt-2 truncate font-mono text-[10px]">
        {profile ? profile.username : "guest"}
      </div>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em]">
        {profile
          ? `${profile.wins}–${profile.losses}–${profile.draws}`
          : "0–0–0"}
      </div>
    </div>
  );
}
