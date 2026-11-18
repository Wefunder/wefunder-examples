// Flavor 2, investment session (beta): the signed-in user pressed "Go straight to checkout".
//
// A session is addressed to an email, so this uses the email on the data room's own user record,
// never one typed into the page. Wefunder returns a hosted checkout URL for that person on this
// round, and sends them back to this data room when they finish or cancel.
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env.ts";
import { describe, errorKey } from "@/lib/errors.ts";
import { currentUser, wefunder } from "@/lib/server.ts";
import { recordSession } from "@/lib/status.ts";
import { createCheckoutSession } from "@/lib/wefunder.ts";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url), 303);
  if (!env.checkoutSessions) return NextResponse.redirect(new URL("/", req.url), 303);

  try {
    const session = await createCheckoutSession(
      env.offeringId,
      {
        email: user.email,
        // Both must be on the origin of one of the app's registered redirect URIs. The query
        // string is a hint for this page, not proof: the page asks Wefunder what happened.
        successUrl: `${env.dataRoomUrl}/?checkout=success`,
        cancelUrl: `${env.dataRoomUrl}/?checkout=cancel`,
        // A fresh key per click. If this person already has an active session on the round,
        // Wefunder returns that one, so a double click does not make two.
        idempotencyKey: randomUUID(),
      },
      wefunder(),
    );
    await recordSession(env.offeringId, user.id, session);
    return NextResponse.redirect(session.url, 303);
  } catch (e) {
    console.error(`investment session for ${user.id} failed: ${describe(e)}`);
    return NextResponse.redirect(new URL(`/?error=${errorKey(e, "investment_session")}`, req.url), 303);
  }
}
