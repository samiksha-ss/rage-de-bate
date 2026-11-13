import { MatchRoom } from "@/components/match-room";
import { Stage } from "@/components/stage";

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <Stage letters="RAGE">
      <MatchRoom id={id} />
    </Stage>
  );
}
