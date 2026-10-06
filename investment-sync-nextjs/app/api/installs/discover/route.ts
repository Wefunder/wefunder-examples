// Adopt installs this app did not create itself: anything Wefunder lists as an active installation
// of the app that we hold no company token for gets a token minted and a first sync. Covers
// founder-link installs whose setup callback was missed and installs made in the portal.
// Companies a founder disconnected are skipped (lib/installs.ts explains why).
import { NextResponse, type NextRequest } from "next/server";
import { load, save, log } from "@/lib/store.ts";
import { discoverInstalls, syncCompany } from "@/lib/installs.ts";
import { drain } from "@/lib/notify.ts";
import { env } from "@/lib/env.ts";

export async function POST(req: NextRequest) {
  const s = await load();
  if (!s.user) return NextResponse.json({ error: "connect first" }, { status: 401 });
  const { adopted, listed } = await discoverInstalls(s);
  for (const company of Object.values(s.companies)) {
    if (!adopted.includes(company.name) || !company.token) continue;
    try { await syncCompany(s, company); } catch (e) { log(s, `${company.name}: first sync failed: ${(e as Error).message}`); }
  }
  if (adopted.length > 0) await drain(s, env.slackWebhookUrl);
  else log(s, `discover: ${listed} installation(s) listed, nothing new to adopt`);
  await save(s);
  const wantsHtml = (req.headers.get("accept") ?? "").includes("text/html");
  if (wantsHtml) return NextResponse.redirect(new URL("/?discovered=" + adopted.length, req.url), 303);
  return NextResponse.json({ adopted, listed });
}
