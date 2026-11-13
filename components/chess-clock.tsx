export function formatClock(ms: number) {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const secondsText = seconds.toString().padStart(2, "0");

  if (clamped < 10000) {
    const tenths = Math.floor((clamped % 1000) / 100);
    return `${minutes}:${secondsText}.${tenths}`;
  }

  return `${minutes}:${secondsText}`;
}

export function ChessClock({
  remainingMs,
  active,
}: {
  remainingMs: number;
  active: boolean;
}) {
  const danger = active && remainingMs < 10000;

  return (
    <div
      className={`min-w-[6.5rem] px-3 py-1 text-right font-mono text-4xl leading-none tabular-nums tracking-tight sm:text-5xl ${
        danger
          ? "text-coral shadow-[4px_4px_0_#ff7a62]"
          : active
            ? "text-gold shadow-[4px_4px_0_#ffe14a]"
            : "text-cream/35"
      }`}
    >
      {formatClock(remainingMs)}
    </div>
  );
}
