import { test } from "node:test";
import assert from "node:assert/strict";
import { slackLine, enqueue, drain } from "../lib/notify.ts";
import { EMPTY, type InvestmentRecord, type State } from "../lib/store.ts";

const rec = (id: string, extra: Record<string, unknown> = {}): InvestmentRecord =>
  ({ id, visible: true, status: "active", group: "PENDING", amounts: { committed_cents: 250000, currency: "usd" }, investor: { id: "usr_1", name: "Ada" }, ...extra });

test("a record we did not hold is a new investment; a reservation says so", () => {
  assert.equal(slackLine(null, rec("inv_a")), "New investment: $2,500 (PENDING) inv_a");
  assert.equal(slackLine(null, rec("inv_r", { status: "reserved" })), "New reservation: $2,500 (PENDING) inv_r");
});

test("group or status moving posts; shares, raised_cents, blockers, profile edits do not", () => {
  const held = rec("inv_a");
  assert.equal(slackLine(held, rec("inv_a", { group: "IS READY" })), "IS READY: $2,500 inv_a");
  assert.equal(slackLine(held, rec("inv_a", { status: "executed", group: "CONFIRMED" })), "CONFIRMED: $2,500 inv_a");
  assert.equal(slackLine(held, rec("inv_a", { shares: "739.64" })), null);
  assert.equal(slackLine(held, rec("inv_a", { amounts: { committed_cents: 250000, raised_cents: 250000, in_escrow_cents: 250000, currency: "usd" } })), null);
  assert.equal(slackLine(held, rec("inv_a", { blockers: [{ key: "needs_id" }] })), null);
  assert.equal(slackLine(held, rec("inv_a", { investor: { id: "usr_1", name: "Ada L." } })), null);
});

test("amount changes post without names; recomputed never posts", () => {
  const held = rec("inv_a");
  const line = slackLine(held, rec("inv_a", { amounts: { committed_cents: 300000, currency: "usd" } }));
  assert.equal(line, "Amount changed: $2,500 → $3,000 inv_a");
  assert.ok(!line!.includes("Ada"));
  assert.equal(slackLine(held, rec("inv_a", { group: "IS READY", reason: "recomputed" })), null);
});

test("a tombstone posts Removed only if we held the record; a conversion posts one line", () => {
  assert.equal(slackLine(rec("inv_a"), { id: "inv_a", visible: false }), "Removed: inv_a ($2,500)");
  assert.equal(slackLine(null, { id: "inv_a", visible: false }), null);
  assert.equal(slackLine(null, rec("inv_b", { converted_from: "inv_a" })), "Converted: inv_a → inv_b ($2,500)");
});

test("enqueue debounces per investment and drain retries failures", async () => {
  const s: State = structuredClone(EMPTY);
  enqueue(s, "co_1", null, rec("inv_a"));
  enqueue(s, "co_1", rec("inv_a"), rec("inv_a", { group: "IS READY" }));   // within a minute: replaces the line, no second row
  assert.equal(s.notifications.length, 1);
  assert.equal(s.notifications[0].line, "IS READY: $2,500 inv_a");

  let calls = 0;
  const failing = (async () => { calls++; return new Response("no", { status: 500 }); }) as unknown as typeof fetch;
  let r = await drain(s, "https://hooks.slack.test/x", failing);
  assert.deepEqual(r, { delivered: 0, failed: 1 });
  assert.equal(s.notifications[0].delivered_at, null);                       // still pending, not lost
  const ok = (async () => { calls++; return new Response("ok"); }) as unknown as typeof fetch;
  r = await drain(s, "https://hooks.slack.test/x", ok);
  assert.deepEqual(r, { delivered: 1, failed: 0 });
  assert.ok(s.notifications[0].delivered_at);
  assert.equal(calls, 2);
});
