"use client";

import { useEffect, useState } from "react";

export function MatchLobby({
  seatLabel,
  onClose,
  closing,
}: {
  seatLabel: string;
  onClose: () => void;
  closing: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState("");

  useEffect(() => {
    setUrl(window.location.href);
  }, []);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-5 py-12 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-cream/50">
        Room open
      </p>
      <h2 className="mt-4 font-serif text-5xl italic leading-none text-cream sm:text-6xl">
        Waiting on a second.
      </h2>
      <p className="mt-4 max-w-sm font-mono text-xs leading-relaxed tracking-wide text-cream/60">
        You are {seatLabel}. Send the link. Clocks start when they sit down.
      </p>
      <div className="mt-8 w-full -rotate-1 bg-cream px-4 py-3 text-left text-ink shadow-[6px_6px_0_#ff8eb8]">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em]">
          Admit one
        </div>
        <div className="mt-1 font-mono text-xs break-all">{url}</div>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex h-12 items-center bg-cream px-6 font-mono text-[11px] uppercase tracking-[0.18em] text-ink shadow-[4px_4px_0_#ff8eb8] transition-transform hover:-translate-y-0.5"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={closing}
          className="inline-flex h-12 items-center border border-cream/30 px-5 font-mono text-[11px] uppercase tracking-[0.18em] text-cream/80 hover:border-cream disabled:opacity-50"
        >
          {closing ? "Closing…" : "Close room"}
        </button>
      </div>
    </div>
  );
}
