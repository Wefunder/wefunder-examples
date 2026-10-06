import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, fmtMoney } from "../lib/summary.ts";

const rec = (id: string, group: string, cents: number, investor: string, extra: Record<string, unknown> = {}) =>
  ({ id, visible: true, status: "active", group, amounts: { committed_cents: cents, investment_size_cents: cents, raised_cents: group === "NO PAYMENT YET" ? 0 : cents, currency: "usd" }, investor: { id: investor }, ...extra });

test("summarize splits commitments by dashboard group like the directory header", () => {
  const s = summarize([
    rec("a", "IS READY", 500000, "u1"),
    rec("b", "IS READY", 300000, "u2"),
    rec("c", "PENDING", 500100, "u3"),
    rec("d", "NO PAYMENT YET", 1000000, "u1"),
    rec("e", "IS READY", 250000, "u4", { status: "reserved" }),
    rec("f", "CONFIRMED", 100000, "u5"),
    { id: "g", visible: false },
  ]);
  assert.equal(s.investments, 6);
  assert.equal(s.investors, 5);
  assert.equal(s.committed_cents, 2650100);
  assert.equal(s.raised_cents, 1650100); // the $10,000 NO PAYMENT YET row is not on the progress bar
  assert.equal(s.ready_cents, 800000);
  assert.equal(s.wefunder_cash_cents, 250000);
  assert.equal(s.pending_cents, 500100);
  assert.equal(s.no_payment_cents, 1000000);
  assert.equal(s.confirmed_cents, 100000);
  assert.equal(s.other_cents, 0);
});

test("summarize prefers investment_size_cents and falls back to committed_cents", () => {
  const s = summarize([{ id: "a", visible: true, group: "PENDING", amounts: { committed_cents: 100, investment_size_cents: 99 } }, { id: "b", visible: true, group: "PENDING", amounts: { committed_cents: 100 } }]);
  assert.equal(s.committed_cents, 199);
});

test("fmtMoney renders whole dollars without cents and keeps real cents", () => {
  assert.equal(fmtMoney(66171200), "$661,712");
  assert.equal(fmtMoney(500050), "$5,000.50");
  assert.equal(fmtMoney(0), "$0");
  assert.equal(fmtMoney(1000, "eur"), "€10");
});
