// The timer target (`GET /api/sync` every 30 minutes): first work off the webhook inbox, then sync
// every connected company the inbox pass did not just sync. It is both the worker for stored
// deliveries that the post-response pass missed and the safety net for deliveries that never
// arrived. Disconnected companies are skipped and reported.
import { NextResponse, type NextRequest } from "next/server";
import { syncCompany } from "@/lib/installs.ts";
import { processInbox } from "@/lib/inbox.ts";
import { drain } from "@/lib/notify.ts";
import { env } from "@/lib/env.ts";
import { load, save, log } from "@/lib/store.ts";

export async function POST(req: NextRequest) {
  const inbox = await processInbox();
  const s = await load();
  const results: Record<string, unknown> = {};
  for (const company of Object.values(s.companies)) {
    if (company.disconnected) { results[company.id] = { skipped: "disconnected" }; continue; }
    if (inbox.synced.includes(company.id)) { results[company.id] = { synced_from: "inbox" }; continue; }
    try { results[company.id] = await syncCompany(s, company); }
    catch (e) { results[company.id] = { error: (e as Error).message }; log(s, `${company.name}: sync failed: ${(e as Error).message}`); }
  }
  if (Object.keys(s.companies).length === 0) log(s, "sync requested, but no company is installed yet");
  const delivery = await drain(s, env.slackWebhookUrl);
  await save(s);
  const wantsHtml = (req.headers.get("accept") ?? "").includes("text/html");
  if (wantsHtml) return NextResponse.redirect(new URL("/?sync=ok", req.url), 303);
  return NextResponse.json({ inbox, results, notifications: delivery });
}

export const GET = POST;
