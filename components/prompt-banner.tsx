export function PromptBanner({ body }: { body: string | null }) {
  return (
    <div className="px-2 py-6 text-center sm:py-8">
      <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-cream/45">
        The motion
      </div>
      <h2 className="mx-auto mt-3 max-w-2xl text-balance font-serif text-4xl leading-[1.05] text-cream italic sm:text-6xl">
        {body ?? "Drawing a motion…"}
      </h2>
    </div>
  );
}
