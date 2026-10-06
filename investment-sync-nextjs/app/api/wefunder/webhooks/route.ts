// Webhook receiver (guide, Step 4 "The webhook"). The SDK verifies the signature over the RAW body
// and parses the envelope; we dedupe by event id, store it, and treat investment.changed as a
// nudge to sync the company it names. The event is not the data: `first`, `fields` and `reason`
// are hints, and the money feed decides from our own before/after copies (lib/notify.ts).
import { NextResponse, type NextRequest } from "next/server";
import { constructEventFromRequest, dispatchWebhook, WebhookSignatureError } from "@wefunder/sdk";
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
  s.events.unshift({ id: event.id, event: event.event, created_at: event.created_at, mode: String(event.mode ?? ""), data: (event.data ?? {}) as Record<string, unknown>, received_at: new Date().toISOString() });
  s.events = s.events.slice(0, 200);

  // `dispatchWebhook` routes by event name and hands each handler a typed `data` (an event name
  // newer than this SDK falls to `default`). A production receiver answers 200 here and syncs from
  // a queue; the example syncs inline because it has no worker, so keep the work small or
  // Wefunder's delivery timeout will mark the attempt failed.
  await dispatchWebhook(event, {
    "investment.changed": async ({ data }) => {
      const companyId = data.company ?? "";
      const company = s.companies[companyId];
      // `first` and `fields` are optional AND nullable (SDK ≥ 0.1.0-beta.13): older snapshots deliver
      // null and deliveries from before the hints existed omit the keys, so guard with `?? []`.
      const hints = `reason=${data.reason} first=${String(data.first ?? "?")} fields=${(data.fields ?? []).join(",") || "?"}`;
      if (company?.token && !company.disconnected) {
        log(s, `webhook ${event.event} ${event.id} (${hints}) → sync ${company.name}`);
        try { await syncCompany(s, company); } catch (e) { log(s, `${company.name}: sync after webhook failed: ${(e as Error).message}`); }
        await drain(s, env.slackWebhookUrl);
      } else {
        log(s, `webhook ${event.event} ${event.id} for ${companyId || "unknown company"}: ${company?.disconnected ? "disconnected" : "not installed here"}, nothing to sync`);
      }
    },
    default: async (e) => { log(s, `webhook ${e.event} ${e.id}`); },
  });
  try { await save(s); } catch (e) { return NextResponse.json({ error: `storage: ${(e as Error).message}` }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
