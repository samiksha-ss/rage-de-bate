import { HomeScreen } from "@/components/home-screen";
import { Stage } from "@/components/stage";
import { BangSticker, HeartPolaroid, NoteSticker } from "@/components/stickers";

export default function HomePage() {
  return (
    <Stage letters="RAGE">
      <HeartPolaroid className="bottom-8 left-6 hidden lg:block" />
      <BangSticker className="right-8 bottom-12 hidden lg:block" />
      <NoteSticker className="top-8 left-10 hidden xl:block" />
      <HomeScreen />
    </Stage>
  );
}
