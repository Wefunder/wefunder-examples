// OAuth redirect URI for the staff user. Rejects the callback unless `state` is one we issued,
// exchanges the code with the PKCE verifier stored under it, keeps the token set (2h access,
// rotating refresh), and resolves any install callbacks that arrived before we had a user to
// mint with.
import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, me } from "@/lib/wefunder.ts";
import { load, save, log } from "@/lib/store.ts";
import { adoptPendingInstalls, staffClient } from "@/lib/installs.ts";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const state = q.get("state");
  const code = q.get("code");
  const s = await load();
  const pending = state ? s.pending_oauth[state] : undefined;
  if (!pending) return NextResponse.json({ error: "unknown state — start again from /api/wefunder/oauth/start" }, { status: 400 });
  delete s.pending_oauth[state!];

  if (q.get("error") || !code) {
    log(s, `oauth denied: ${q.get("error") ?? "no code"}`);
    await save(s);
    return NextResponse.redirect(new URL("/?oauth=denied", req.url));
  }
  try {
    const tokens = await exchangeCode(code, pending.code_verifier);
    s.user = { name: null, tokens };
    try {
      const who = await me(staffClient(s));
      s.user.name = (who as { attributes?: { name?: string } } | undefined)?.attributes?.name ?? null;
    } catch { /* read:profile may be absent; the name is cosmetic */ }
    log(s, `connected ${s.user.name ?? "a user"} (scope="${tokens.scope ?? ""}")`);
    await adoptPendingInstalls(s);
    await save(s);
    return NextResponse.redirect(new URL("/?oauth=ok", req.url));
  } catch (e) {
    log(s, `oauth exchange failed: ${(e as Error).message}`);
    await save(s);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
