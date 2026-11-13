const COLORS = ["#ff8eb8", "#f4efe4", "#7ec8ff", "#ffe14a"];
const TILTS = [-3, 2.5, -1.5, 3];

export function StickerWord({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-end gap-[0.03em] ${className}`}>
      {text.split("").map((character, index) => (
        <span
          key={`${character}-${index}`}
          className="sticker-letter inline-block font-sticker leading-[0.82]"
          style={{
            color: COLORS[index % COLORS.length],
            transform: `rotate(${TILTS[index % TILTS.length]}deg)`,
          }}
        >
          {character}
        </span>
      ))}
    </span>
  );
}
