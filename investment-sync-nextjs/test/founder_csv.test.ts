import { test } from "node:test";
import assert from "node:assert/strict";
import { founderCsv, money, dateUtc, shareCount, COLUMNS } from "../lib/founder_csv.ts";

test("shareCount truncates to two decimals and strips trailing zeros like format_share_count", () => {
  assert.equal(shareCount("1479.29"), "1479.29");
  assert.equal(shareCount("333.333333"), "333.33");
  assert.equal(shareCount("295"), "295");
  assert.equal(shareCount("100.10"), "100.1");
  assert.equal(shareCount("100.001"), "100");
  assert.equal(shareCount(null), "");
  assert.equal(shareCount(undefined), "");
});

test("money renders like Ruby BigDecimal#to_s", () => {
  assert.equal(money(100000), "1000.0");
  assert.equal(money(100050), "1000.5");
  assert.equal(money(100025), "1000.25");
  assert.equal(money(0), "0.0");
  assert.equal(money(null), "");
});

test("dateUtc renders strftime('%Y-%m-%d %H:%M:%S') in UTC", () => {
  assert.equal(dateUtc("2026-09-15T20:10:03Z"), "2026-09-15 20:10:03");
});

test("the file has the BOM, the scope row, a blank row, the founder columns, and one row per record newest first", () => {
  const csv = founderCsv([
    { id: "inv_a", visible: true, status: "active", group: "IS READY", applied_at: "2026-09-01T00:00:00Z", amounts: { committed_cents: 250000, in_escrow_cents: 250000 }, investor: { name: "Ada Lovelace", legal_name: "Analytical Engines LLC", via_entity: true, email: "ada@x.test", address: { line: "1 Way, Apt 2", city: "London", state: null, postal_code: "N1", country: "United Kingdom" }, bio: null }, needs_whitelisting: false, investment_type: "SAFE", offering_type: "Reg CF", message: 'She said "hi"', blockers: [{ key: "needs_id", description: "Upload an ID" }], contracts: [{ name: "SAFE", override_amount_cents: null, early_bird: true }, { name: "Side letter", override_amount_cents: 100000, early_bird: false }], external_username: null },
    { id: "inv_b", visible: true, status: "active", group: "PENDING", applied_at: "2026-09-02T00:00:00Z", amounts: { committed_cents: 10000, in_escrow_cents: 0 }, shares: "29.585798", average_share_price: "3.38", investor: { name: "Bob", legal_name: "Bob", via_entity: false, email: "bob@x.test", address: {} }, needs_whitelisting: true, investment_type: "SAFE", offering_type: "Reg CF", blockers: [], contracts: [] },
  ]);
  const lines = csv.split("\n");
  assert.equal(lines[0], "﻿Campaign Scope: All Campaigns");
  assert.equal(lines[1], "");
  assert.equal(lines[2], COLUMNS.join(","));
  assert.ok(lines[3].startsWith("inv_b,Bob,Bob,bob@x.test,No,PENDING,2026-09-02 00:00:00,100.0,29.58,3.38,0.0,Yes,SAFE,Reg CF,"), lines[3]);
  // inv_a: quoted address (comma), quoted message (quotes doubled), multi-contract cells joined with newlines (quoted)
  const a = csv.slice(csv.indexOf("inv_a,"));
  assert.ok(a.includes('Analytical Engines LLC,Ada Lovelace,ada@x.test,Yes,IS READY,2026-09-01 00:00:00,2500.0,,,2500.0,,SAFE,Reg CF,N1,United Kingdom,,London,"1 Way, Apt 2",,"She said ""hi""",needs_id,Upload an ID,,"Yes\nNo","SAFE\nSide letter","\n1000.0"'), a);
});
