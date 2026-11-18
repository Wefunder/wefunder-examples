// Flavor 1, member link: the signed-in user pressed "Invest on Wefunder".
//
// Mint on the click, not ahead of time. `reference` is this data room's own user id, so pressing
// the button again returns the same live link instead of a second one. The browser is then sent
// to the link's URL: the round's page on Wefunder, with the private round visible to them.
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env.ts";
import { describe, errorKey } from "@/lib/errors.ts";
import { currentUser, wefunder } from "@/lib/server.ts";
import { recordLink } from "@/lib/status.ts";
import { mintMemberLink } from "@/lib/wefunder.ts";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url), 303);

  try {
    const link = await mintMemberLink(env.offeringId, user.id, wefunder());
    await recordLink(env.offeringId, user.id, link);
    return NextResponse.redirect(link.url, 303);
  } catch (e) {
    console.error(`member link for ${user.id} failed: ${describe(e)}`);
    return NextResponse.redirect(new URL(`/?error=${errorKey(e, "member_link")}`, req.url), 303);
  }
}
