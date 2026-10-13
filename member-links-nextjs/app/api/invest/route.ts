// "Invest" on a deal card. Server-side so the install token never reaches the browser:
//   1. POST /offerings/{id}/member_links with reference = the member's id (and their
//      wefunder_user_id when we know it, to pre-bind the link),
//   2. 303 the browser to attributes.url, the deal page carrying the link's token.
// No store: a repeated reference returns the member's live link (200), so clicking twice, or on
// two devices, sends the member to the same link instead of minting another.
import { NextResponse, type NextRequest } from "next/server";
import { memberLinks } from "@/lib/client.ts";
import { env } from "@/lib/env.ts";
import { currentMember, MEMBER_COOKIE } from "@/lib/members.ts";
import { errorKey } from "@/lib/member_links.ts";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const offering = String(form.get("offering") ?? "");
  const back = (key: string) => NextResponse.redirect(new URL(`/?error=${encodeURIComponent(key)}&offering=${encodeURIComponent(offering)}`, req.url), 303);

  // Only the deals this portal lists; never mint on an id a visitor typed into the form.
  if (!env.offerings.some((o) => o.id === offering)) return back("unknown_offering");

  const member = currentMember(req.cookies.get(MEMBER_COOKIE)?.value);
  try {
    const { link, created } = await memberLinks().create(offering, {
      reference: member.id,
      wefunder_user_id: member.wefunder_user_id ?? undefined,
    });
    console.log(`member link ${link.id} for ${member.id} on ${offering}: ${created ? "created (201)" : "existing (200)"}, state ${link.attributes.state}`);
    return NextResponse.redirect(link.attributes.url, 303);
  } catch (e) {
    console.error(`member link for ${member.id} on ${offering} failed:`, e);
    return back(errorKey(e));
  }
}
