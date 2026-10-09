// Webhook receiver (guide, Step 4 "The webhook"): verify, store, acknowledge, then process. The
// SDK verifies the signature over the RAW body and parses the envelope; we store the delivery in
// the inbox keyed on (event id, installation id) and answer 2xx only once that save succeeded.
// The sync happens afterwards (lib/inbox.ts). The event is not the data: `first`, `fields` and
// `reason` are hints, and the money feed decides from our own before/after copies (lib/notify.ts).
//
// "Afterwards" is Next.js `after()`: it runs once the response has been sent (on Vercel, inside
// the same invocation via waitUntil), so the nudge is usually applied within seconds without a
// worker process. It is only the fast path. If it fails or the function is cut off, the row stays
// queued and the timer (`/api/sync`, every 30 minutes) works it off.
import { after, NextResponse, type NextRequest } from "next/server";
import { constructEventFromRequest, dispatchWebhook, WebhookSignatureError } from "@wefunder/sdk";
import { env } from "@/lib/env.ts";
import { processInbox, recordEvent } from "@/lib/inbox.ts";
import { load, save, log } from "@/lib/store.ts";

export async function POST(req: NextRequest) {
  const raw = await req.clone().text();               // the exact bytes; kept for the installation id below
  let event;
  try {
    event = await constructEventFromRequest(req, env.webhookSecret); // reads the body once, as text
  } catch (e) {
    if (e instanceof WebhookSignatureError) return NextResponse.json({ error: e.reason }, { status: 400 }); // not authentic: don't process
    throw e;
  }
  // The SDK event object has no `installation`; read it from the verified raw body.
  const installationId = String((JSON.parse(raw) as { installation?: { id?: unknown } }).installation?.id ?? "");

  // `dispatchWebhook` routes by event name and hands each handler a typed `data` (an event name
  // newer than this SDK falls to `default`). Here it only builds the log line; the hints are
  // logged, never acted on.
  let note = `webhook ${event.event} ${event.id} (${installationId || "no installation"})`;
  await dispatchWebhook(event, {
    "investment.changed": async ({ data }) => {
      // `first` and `fields` are optional AND nullable (SDK ≥ 0.1.0-beta.13): older snapshots deliver
      // null and deliveries from before the hints existed omit the keys, so guard with `?? []`.
      note += ` company=${data.company} reason=${data.reason} first=${String(data.first ?? "?")} fields=${(data.fields ?? []).join(",") || "?"}`;
    },
    default: async () => {},
  });

  // Store first. If the save fails, answer 5xx and Wefunder retries the delivery with backoff.
  // Say WHY in the body: Wefunder records the response body on the delivery attempt.
  let stored: boolean;
  try {
    const s = await load();
    stored = recordEvent(s, event, installationId);
    log(s, `${note}: ${stored ? "stored" : "repeat, already stored"}`);
    await save(s);
  } catch (e) {
    return NextResponse.json({ error: `storage: ${(e as Error).message}` }, { status: 500 });
  }

  after(async () => {
    try { await processInbox(); } catch (e) { console.error("inbox pass after webhook failed; the timer retries", e); }
  });
  return NextResponse.json({ ok: true, ...(stored ? {} : { duplicate: true }) }); // at-least-once delivery: a repeat is acknowledged again
}
