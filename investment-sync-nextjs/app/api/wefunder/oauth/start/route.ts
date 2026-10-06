// Connect the Wefunder STAFF user who will install this app on the companies they can edit
// (Authorization Code + PKCE, via the SDK's helpers). Their token lists eligible companies,
// installs, mints and revokes; it never reads investments. Each installed company gets its own
// company-owned token.
import { NextResponse } from "next/server";
import { beginAuthorization } from "@/lib/wefunder.ts";
import { update } from "@/lib/store.ts";

export async function GET() {
  const { url, state, codeVerifier } = beginAuthorization();
  await update((s) => { s.pending_oauth[state] = { code_verifier: codeVerifier, created_at: new Date().toISOString() }; });
  return NextResponse.redirect(url);
}
