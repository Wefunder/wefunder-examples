// The app's SETUP URL. Wefunder redirects a founder here right after they install the app on
// their company through your install link: ?installation_id=inst_…&state=<whatever you put on
// the link>; on cancel, ?error=access_denied. We record the install and, if a staff user is
// connected, mint its company token right away; otherwise it waits until someone connects.
import { NextResponse, type NextRequest } from "next/server";
import { load, save, log } from "@/lib/store.ts";
import { adoptPendingInstalls } from "@/lib/installs.ts";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const s = await load();
  if (q.get("error")) {
    log(s, `install cancelled by the founder (${q.get("error")})`);
    await save(s);
    return NextResponse.redirect(new URL("/?installed=cancelled", req.url));
  }
  const installationId = q.get("installation_id");
  if (!installationId) return NextResponse.json({ error: "installation_id missing" }, { status: 400 });

  s.pending_installs.unshift({ installation_id: installationId, state: q.get("state"), received_at: new Date().toISOString() });
  log(s, `install callback: ${installationId} (state=${q.get("state") ?? "none"})`);
  try { await adoptPendingInstalls(s); } catch (e) { log(s, `adopting installs failed: ${(e as Error).message}`); }
  await save(s);
  return NextResponse.redirect(new URL("/?installed=ok", req.url));
}
