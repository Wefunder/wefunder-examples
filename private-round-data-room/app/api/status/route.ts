// What the page polls: the signed-in user's own link and session state, as JSON.
//
// The browser asks THIS app every few seconds; this app asks Wefunder at most once a minute per
// user (lib/status.ts), and only for a link or session that exists and has not settled. Ids,
// states and nothing else go to the browser: no token, no Wefunder URL, nobody else's state.
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env.ts";
import { describe } from "@/lib/errors.ts";
import { currentUser, wefunder } from "@/lib/server.ts";
import { userStatus } from "@/lib/status.ts";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "signed_out" }, { status: 401 });

  // `?fresh=1`: the investor just came back from checkout, so skip the minute (once, see
  // FORCE_FLOOR_MS).
  const force = req.nextUrl.searchParams.get("fresh") === "1";
  const { record, watching, error } = await userStatus(env.offeringId, user.id, { ...wefunder(), force });
  if (error) console.error(`status refresh for ${user.id} failed: ${describe(error)}`);

  return NextResponse.json(
    {
      link: record.linkState ?? null,
      session: record.sessionStatus ?? null,
      watching,
      stale: Boolean(error),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
