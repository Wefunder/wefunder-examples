import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, summarize } from "../lib/raise.ts";

test("summarize shows the round's raised figure and leaves canceled investments out of the counts", () => {
  const raise = summarize({
    offering: "ofr_x",
    company: "co_x",
    currency: "usd",
    by_status: {
      canceled: { count: 1, committed_cents: 40_00, raised_cents: 0 },
      active: { count: 2, committed_cents: 350_00, raised_cents: 0 }, // committed, not paid yet
      executed: { count: 1, committed_cents: 1000_00, raised_cents: 1000_00 },
    },
    total: { count: 4, committed_cents: 1390_00, raised_cents: 1000_00 },
  });
  assert.equal(raise.raisedCents, 1000_00);
  assert.equal(raise.committedCents, 1350_00);
  assert.equal(raise.investments, 3);
  assert.deepEqual(raise.byStatus.map((r) => r.status), ["executed", "active", "canceled"]);
});

test("summarize answers zeros for a round with no investments, or no stats at all", () => {
  for (const stats of [{ by_status: {}, total: { count: 0, committed_cents: 0, raised_cents: 0 }, currency: null }, null, undefined]) {
    const raise = summarize(stats);
    assert.deepEqual({ raised: raise.raisedCents, committed: raise.committedCents, investments: raise.investments, rows: raise.byStatus.length }, { raised: 0, committed: 0, investments: 0, rows: 0 });
    assert.equal(raise.currency, "usd");
  }
});

test("formatMoney renders integer cents as whole currency units", () => {
  assert.equal(formatMoney(64_230_000), "$642,300");
  assert.equal(formatMoney(0), "$0");
  assert.equal(formatMoney(1_250_00, "eur"), "€1,250");
});
