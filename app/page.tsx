import { redirect } from "next/navigation";

// P0: canonical entry redirects to the board. Submit-first routing (empty
// store check) lands in P1 with lib/store.ts.
export default function Home() {
  redirect("/board");
}
