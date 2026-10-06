// Webhook receiver (guide, Step 4 "The webhook"). The SDK verifies the signature over the RAW body
// and parses the envelope; we dedupe by event id, store it, and treat investment.changed as a
// nudge to sync the company it names. The event is not the data: `first`, `fields` and `reason`
// are hints, and the money feed decides from our own before/after copies (lib/notify.ts).
import { NextResponse, type NextRequest } from "next/server";
import { constructEventFromRequest, WebhookSignatureError } from "@wefunder/sdk";
import { env } from "@/lib/env.ts";
import { syncCompany } from "@/lib/installs.ts";
import { drain } from "@/lib/notify.ts";
import { load, save, log } from "@/lib/store.ts";

export async function POST(req: NextRequest) {
  let event;
  try {
    event = await constructEventFromRequest(req, env.webhookSecret); // reads the body once, as text
  } catch (e) {
    if (e instanceof WebhookSignatureError) return NextResponse.json({ error: e.reason }, { status: 400 }); // not authentic: don't process
    throw e;
  }

  let s;
  try {
    s = await load();
  } catch (e) {
    // Say WHY in the body: Wefunder records the response body on the delivery attempt.
    return NextResponse.json({ error: `storage: ${(e as Error).message}` }, { status: 500 });
  }
  if (s.events.some((e) => e.id === event.id)) return NextResponse.json({ ok: true, duplicate: true }); // at-least-once delivery
  const data = (event.data ?? {}) as Record<string, unknown>;
  s.events.unshift({ id: event.id, event: event.event, created_at: event.created_at, mode: String(event.mode ?? ""), data, received_at: new Date().toISOString() });
  s.events = s.events.slice(0, 200);

  // A production receiver answers 200 here and syncs from a queue. The example syncs inline
  // because it has no worker; keep the work small or Wefunder's delivery timeout will mark it failed.
  if (event.event === "investment.changed") {
    const companyId = String(data.company ?? "");
    const company = s.companies[companyId];
    const hints = `reason=${String(data.reason ?? "?")} first=${String(data.first ?? "?")} fields=${Array.isArray(data.fields) ? (data.fields as string[]).join(",") : "?"}`;
    if (company?.token && !company.disconnected) {
      log(s, `webhook ${event.event} ${event.id} (${hints}) → sync ${company.name}`);
      try { await syncCompany(s, company); } catch (e) { log(s, `${company.name}: sync after webhook failed: ${(e as Error).message}`); }
      await drain(s, env.slackWebhookUrl);
    } else {
      log(s, `webhook ${event.event} ${event.id} for ${companyId || "unknown company"}: ${company?.disconnected ? "disconnected" : "not installed here"}, nothing to sync`);
    }
  } else {
    log(s, `webhook ${event.event} ${event.id}`);
  }
  try { await save(s); } catch (e) { return NextResponse.json({ error: `storage: ${(e as Error).message}` }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
