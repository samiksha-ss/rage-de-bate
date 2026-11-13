export function FilmStrip({ letters = "" }: { letters?: string }) {
  const slots = [1, 3, 5, 7];
  const chars = letters.split("");

  return (
    <div
      aria-hidden="true"
      className="flex items-center justify-between bg-black px-3 py-3 sm:px-4"
    >
      {Array.from({ length: 9 }, (_, index) => {
        const letterIndex = slots.indexOf(index);
        const letter = letterIndex >= 0 ? chars[letterIndex] : "";
        return (
          <span
            key={index}
            className="grid size-7 shrink-0 place-items-center rounded-[2px] bg-cream font-sticker text-sm leading-none text-ink sm:size-9 sm:text-base"
          >
            {letter}
          </span>
        );
      })}
    </div>
  );
}

export function Stage({
  children,
  letters = "",
}: {
  children: React.ReactNode;
  letters?: string;
}) {
  return (
    <div className="m-2.5 flex min-h-[calc(100dvh-1.25rem)] flex-col bg-stage sm:m-3.5 sm:min-h-[calc(100dvh-1.75rem)]">
      <FilmStrip letters={letters} />
      <div className="relative flex flex-1 flex-col overflow-x-hidden">
        {children}
      </div>
      <FilmStrip />
    </div>
  );
}
