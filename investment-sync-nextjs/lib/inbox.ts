// The webhook inbox (guide, Step 4 "The webhook"). The receiver stores each verified delivery here
// and answers 2xx; `processInbox` works the stored rows off afterwards. A 2xx tells Wefunder the
// delivery is done and it is never sent again, so the row must be saved before the response: a
// crash after the save loses nothing, because the next pass finds the row still queued.
//
// Rows are keyed on (event id, installation id). A retry of a pair we hold is acknowledged and
// stored once; the same event delivered for a second installed company is its own row and its own
// sync. `save()` (lib/store.ts) enforces the key even when two deliveries race.
import { env } from "./env.ts";
import { syncCompany } from "./installs.ts";
import { drain } from "./notify.ts";
import { eventKey, load, log, save, type State, type WebhookEventRecord } from "./store.ts";
import { WefunderError, type Fetch } from "./wefunder.ts";

// A row whose sync keeps failing is given up after this many passes; the 30-minute timer still
// syncs every company, so giving up loses no data, only the early nudge.
export const MAX_ATTEMPTS = 5;

export type Envelope = { id: string; event: string; created_at: string; mode?: unknown; data?: unknown };

// Pure: add the delivery to `s.events` unless the (event id, installation id) pair is already
// there. Returns false for a repeat. The caller saves.
export function recordEvent(s: State, event: Envelope, installationId: string): boolean {
  const key = eventKey({ id: event.id, installation_id: installationId });
  if (s.events.some((e) => eventKey(e) === key)) return false;
  const data = (event.data ?? {}) as Record<string, unknown>;
  s.events.unshift({
    id: event.id,
    installation_id: installationId,
    company: typeof data.company === "string" ? data.company : null,
    event: event.event,
    created_at: event.created_at,
    mode: String(event.mode ?? ""),
    data,
    received_at: new Date().toISOString(),
    processed_at: null,
    outcome: null,
    attempts: 0,
  });
  return true;
}

export type InboxResult = { processed: number; failed: number; synced: string[] };

// One pass over the queued rows, oldest first. Rows naming the same company share one sync: the
// cursor catches up on all of them at once. `syncCompany` takes the company lock, so a pass that
// overlaps the timer, a manual sync or another pass waits rather than racing it.
export async function processInbox(opts: { fetch?: Fetch; limit?: number } = {}): Promise<InboxResult> {
  const s = await load();
  const queued = s.events.filter((e) => e.processed_at === null).reverse().slice(0, opts.limit ?? 50);
  const done = (e: WebhookEventRecord, outcome: string) => { e.processed_at = new Date().toISOString(); e.outcome = outcome; };

  const byCompany = new Map<string, WebhookEventRecord[]>();
  for (const e of queued) {
    const company = s.companies[e.company ?? ""];
    if (e.event !== "investment.changed") done(e, "ignored");
    else if (!company?.token) done(e, "not installed here");
    else if (company.disconnected) done(e, "disconnected");
    else byCompany.set(company.id, [...(byCompany.get(company.id) ?? []), e]);
  }

  const result: InboxResult = { processed: 0, failed: 0, synced: [] };
  for (const [id, rows] of byCompany) {
    const company = s.companies[id];
    log(s, `inbox: ${rows.length} queued event(s) for ${company.name} → sync`);
    try {
      await syncCompany(s, company, opts.fetch);
      rows.forEach((e) => done(e, "synced"));
      result.synced.push(id);
    } catch (err) {
      if (err instanceof WefunderError && err.status === 401) { rows.forEach((e) => done(e, "disconnected")); continue; }
      const message = (err as Error).message;
      log(s, `inbox: sync of ${company.name} failed: ${message}`);
      for (const e of rows) {
        e.attempts += 1;
        if (e.attempts >= MAX_ATTEMPTS) done(e, `failed: ${message}`);   // else left queued for the next pass
      }
    }
  }
  result.processed = queued.filter((e) => e.processed_at !== null).length;
  result.failed = queued.length - result.processed;
  if (result.synced.length > 0) await drain(s, env.slackWebhookUrl);
  await save(s);
  return result;
}
