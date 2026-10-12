// The money feed (guide, Step 6): a Slack line only when something a person cares about changed,
// decided from OUR before and after copies, never from the webhook alone. A webhook says a record
// changed, not that an investment is new; reading it as "new" is how an already-disbursed
// investment gets re-announced as a fresh $20,000.
//
// Lines are queued in the same save as the record change (the outbox) and delivered separately,
// so a failed Slack post is retried instead of lost: once the record is saved, a later sync sees no
// before/after difference and can never reconstruct the line.
import { randomBytes } from "node:crypto";
import type { Fetch } from "./wefunder.ts";
import { claimNotification, save, settleNotification, withLock, type InvestmentRecord, type Notification, type State } from "./store.ts";
import { isTombstone } from "./wefunder.ts";
import { fmtMoney } from "./summary.ts";

type Amounts = { committed_cents?: number; currency?: string };

const money = (r: InvestmentRecord | null) => {
  const a = (r?.amounts ?? {}) as Amounts;
  return a.committed_cents === undefined ? "—" : fmtMoney(a.committed_cents, a.currency ?? "usd");
};

// Pure. Returns the line to post, or null. Investment ids and amounts only: a chat history cannot
// be un-redacted if the investor's account is deactivated later.
export function slackLine(held: InvestmentRecord | null, record: InvestmentRecord): string | null {
  if (record.reason === "recomputed") return null;                       // Wefunder re-derived a field; nothing happened to the investment
  if (isTombstone(record)) {
    return held ? `Removed: ${held.id} (${money(held)})` : null;         // canceled, converted, hidden or deleted
  }
  const isReservation = record.status === "reserved";                    // testing-the-waters: a reservation, not an investment
  if (!held && record.converted_from) return `Converted: ${record.converted_from} → ${record.id} (${money(record)})`;
  if (!held) return `${isReservation ? "New reservation" : "New investment"}: ${money(record)} (${record.group ?? "—"}) ${record.id}`;
  if (held.group !== record.group || held.status !== record.status) return `${record.group ?? record.status}: ${money(record)} ${record.id}`;   // payment landed, funds ready, executed
  const before = (held.amounts as Amounts | undefined)?.committed_cents;
  const after = (record.amounts as Amounts | undefined)?.committed_cents;
  if (before !== after) return `Amount changed: ${money(held)} → ${money(record)} ${record.id}`;
  return null;                                                           // shares, raised_cents, escrow, blockers, message, profile edits: skip
}

// Debounce: one line per investment per minute survives. Retries and re-derivations deliver
// several events for one id in quick succession.
export function enqueue(s: State, company: string, held: InvestmentRecord | null, record: InvestmentRecord): Notification | null {
  const line = slackLine(held, record);
  if (!line) return null;
  const recent = s.notifications.find((n) => n.investment === record.id && Date.now() - new Date(n.created_at).getTime() < 60_000);
  if (recent) { recent.line = line; return recent; }
  const n: Notification = { id: `ntf_${randomBytes(6).toString("hex")}`, company, investment: record.id, line, created_at: new Date().toISOString(), delivered_at: null, attempts: 0 };
  s.notifications.unshift(n);
  s.notifications = s.notifications.slice(0, 200);
  return n;
}

// A line is claimed for this long before its post; the post itself is cut off well inside that,
// so a claim can never expire while its post is still in flight. The claim outlives any lock
// lease that drain could lose, which is what makes delivery exactly-once across drains.
export const CLAIM_MS = 60_000;
export const POST_TIMEOUT_MS = 15_000;

// How a drain takes and releases a line. `outboxStore` claims on the STORED row under the store
// lock, so two drains that both loaded the line as pending cannot both win it; `localClaims` is
// the in-memory equivalent for a state that is not backed by the store (the unit test).
export type Claims = {
  claim(n: Notification): Promise<boolean>;             // true = this drain owns the line now
  settle(n: Notification, delivered: boolean): Promise<void>;
};

export const localClaims: Claims = {
  claim: async (n) => { if (n.delivered_at || (n.claimed_until && new Date(n.claimed_until).getTime() > Date.now())) return false; n.attempts += 1; n.claimed_until = new Date(Date.now() + CLAIM_MS).toISOString(); return true; },
  settle: async (n, delivered) => { if (delivered) n.delivered_at = new Date().toISOString(); n.claimed_until = null; },
};

export function outboxStore(s: State, owner = `drain_${randomBytes(6).toString("hex")}`): Claims {
  return {
    claim: (n) => claimNotification(s, n.id, owner, CLAIM_MS),
    settle: (n, delivered) => settleNotification(s, n.id, owner, delivered),
  };
}

// Deliver the pending lines in `s`. With SLACK_WEBHOOK_URL set, each becomes a Slack post; without
// it the dashboard's "Money feed" is the only output and lines are marked delivered.
//
// Per line: `claims.claim` (a compare-and-set on the stored row), post with a timeout, then
// `claims.settle`. A line this drain did not win is skipped — another drain, possibly one whose
// lock lease this drain took over, is posting it. The timeout keeps the post inside the claim.
// Requests go through `drainOutbox`, which supplies the store-backed claims and serializes drains.
export async function drain(s: State, slackWebhookUrl: string | undefined, f: Fetch = fetch, claims: Claims = localClaims): Promise<{ delivered: number; failed: number }> {
  let delivered = 0, failed = 0;
  // By id, re-read before each line: a claim or settle mirrors the stored row into `s`, and a
  // line delivered elsewhere while this loop ran must be seen as delivered, not posted again.
  const ids = s.notifications.filter((n) => !n.delivered_at).map((n) => n.id);
  for (const id of ids) {
    const before = s.notifications.find((x) => x.id === id);
    if (!before || before.delivered_at) continue;
    if (!slackWebhookUrl) { before.attempts += 1; before.delivered_at = new Date().toISOString(); delivered++; continue; }
    if (!(await claims.claim(before))) continue;                         // another drain is posting it right now
    const n = s.notifications.find((x) => x.id === id) ?? before;
    let ok = false;
    try {
      const company = s.companies[n.company]?.name ?? n.company;
      const res = await f(slackWebhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `${company} · ${n.line}` }), signal: AbortSignal.timeout(POST_TIMEOUT_MS) });
      ok = res.ok;
    } catch {
      ok = false;
    }
    await claims.settle(n, ok);                                          // delivered, or pending again for the next drain
    if (ok) delivered++; else failed++;
  }
  return { delivered, failed };
}

// The outbox is shared by every request: `save()` unions queued lines into whatever copy saves
// next, so two requests syncing different companies both hold the same pending line. Delivery
// runs under one `outbox` lock (save first, so this copy holds every pending line and every
// delivered mark), and each line is won by a compare-and-set on the stored row before its post.
// The lock keeps drains from contending; the atomic claims keep a drain that outlived the lock's
// lease from being joined by the next one, even when both loaded the line as pending. Without
// both, the money feed announces one investment twice.
export async function drainOutbox(s: State, slackWebhookUrl: string | undefined, f: Fetch = fetch): Promise<{ delivered: number; failed: number }> {
  return withLock("outbox", async () => {
    await save(s);
    return drain(s, slackWebhookUrl, f, outboxStore(s));
  });
}
