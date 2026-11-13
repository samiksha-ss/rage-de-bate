"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RatingNote } from "@/components/stickers";
import { StickerWord } from "@/components/sticker-word";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  authErrorCopy,
  ensureUser,
  loadProfile,
} from "@/lib/supabase/session";
import type { Profile } from "@/lib/types";

type Phase = "booting" | "ready" | "searching" | "unconfigured";

export function HomeScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("booting");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setPhase("unconfigured");
      return;
    }

    let cancelled = false;
    const supabase = createClient();

    ensureUser(supabase)
      .then((user) => loadProfile(supabase, user.id))
      .then((nextProfile) => {
        if (cancelled) return;
        if (!nextProfile) {
          setNotice("Your badge didn't land. Refresh.");
        }
        setProfile(nextProfile);
        setPhase("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "";
        setNotice(authErrorCopy(message));
        setPhase("ready");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== "searching") return;

    const supabase = createClient();
    let stopped = false;
    let found = false;
    let timer = 0;

    const tick = async () => {
      const { data, error } = await supabase.rpc("try_quick_match");
      if (stopped) return;
      if (error) {
        setNotice("The queue missed. Try again.");
        setPhase("ready");
        return;
      }

      const result = data as { match_id: string | null; waiting: boolean };
      if (!result.waiting && result.match_id) {
        found = true;
        router.push(`/match/${result.match_id}`);
        return;
      }

      timer = window.setTimeout(() => {
        void tick();
      }, 2000);
    };

    void tick();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      if (!found) {
        void supabase.rpc("cancel_queue");
      }
    };
  }, [phase, router]);

  async function createMatch() {
    if (phase === "unconfigured") {
      setNotice("Add the Supabase URL and anon key to .env.local.");
      return;
    }
    if (phase !== "ready" || creating) return;

    setCreating(true);
    setNotice(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_match");
    if (error || typeof data !== "string") {
      setNotice("Could not open a room.");
      setCreating(false);
      return;
    }
    router.push(`/match/${data}`);
  }

  function quickMatch() {
    if (phase === "unconfigured") {
      setNotice("Add the Supabase URL and anon key to .env.local.");
      return;
    }
    if (phase !== "ready") return;
    setNotice(null);
    setPhase("searching");
  }

  const busy = phase === "booting" || creating || phase === "searching";

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-5 py-12">
      <RatingNote
        profile={profile}
        className="absolute top-6 right-6 hidden sm:block"
      />

      <h1 className="flex flex-col items-center">
        <StickerWord text="RAGE" className="text-7xl sm:text-8xl md:text-9xl" />
        <span className="-mt-1 font-serif text-6xl leading-none text-cream italic sm:-mt-3 sm:text-8xl">
          debate
        </span>
      </h1>

      <p className="mt-6 max-w-md text-center font-mono text-[11px] uppercase tracking-[0.22em] text-cream/65">
        Absurd motions. Three minutes. Chat is the board.
      </p>

      <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.16em] text-cream/70 sm:hidden">
        {profile
          ? `${profile.rating} · ${profile.username}`
          : "800 · guest"}
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => void createMatch()}
          disabled={busy && phase !== "unconfigured"}
          className="inline-flex h-12 items-center bg-cream px-6 font-mono text-[11px] uppercase tracking-[0.18em] text-ink shadow-[4px_4px_0_#ff8eb8] transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
        >
          {creating ? "Opening…" : "Create match"}
        </button>
        <button
          type="button"
          onClick={quickMatch}
          disabled={busy && phase !== "unconfigured"}
          className="inline-flex h-12 items-center border border-cream/30 px-6 font-mono text-[11px] uppercase tracking-[0.18em] text-cream hover:border-cream disabled:opacity-60"
        >
          {phase === "searching" ? "Searching…" : "Quick match"}
        </button>
        {phase === "searching" ? (
          <button
            type="button"
            onClick={() => setPhase("ready")}
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-cream/60 underline-offset-4 hover:text-cream hover:underline"
          >
            Cancel
          </button>
        ) : null}
      </div>

      {notice ? (
        <p className="mt-5 max-w-sm text-center font-mono text-[11px] leading-relaxed text-coral">
          {notice}
        </p>
      ) : phase === "booting" ? (
        <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.18em] text-cream/45">
          Signing you in
        </p>
      ) : null}

      <ul className="mt-14 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">
        <li>0:00 is a loss</li>
        <li className="text-cream/25">·</li>
        <li>Resign and eat it</li>
        <li className="text-cream/25">·</li>
        <li>Six moves, then the judge</li>
      </ul>
    </div>
  );
}
