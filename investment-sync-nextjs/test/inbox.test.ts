import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ATTEMPTS, processInbox, recordEvent, type Envelope } from "../lib/inbox.ts";
import { EMPTY, load, save, type State } from "../lib/store.ts";
import { company, fakeInvestments, page, rec, resetStore, useTempStore } from "./helpers.ts";

useTempStore();

const changed = (id: string, companyId: string): Envelope => ({
  id, event: "investment.changed", created_at: "2026-10-01T00:00:00Z", mode: "live",
  data: { investment: "inv_a", company: companyId, reason: "updated" },
});

test("the inbox key is (event id, installation id): a replay is one row, two installs are two", () => {
  const s: State = structuredClone(EMPTY);
  assert.equal(recordEvent(s, changed("evt_1", "co_1"), "inst_1"), true);
  assert.equal(recordEvent(s, changed("evt_1", "co_1"), "inst_1"), false);  // retried delivery
  assert.equal(recordEvent(s, changed("evt_1", "co_2"), "inst_2"), true);   // same event id, another install
  assert.deepEqual(s.events.map((e) => `${e.id} ${e.installation_id} ${e.company}`).sort(), ["evt_1 inst_1 co_1", "evt_1 inst_2 co_2"]);
  assert.ok(s.events.every((e) => e.processed_at === null));                 // stored, not yet processed
});

test("two deliveries racing to store keep one row per pair and lose neither", async () => {
  await resetStore([]);
  const a = await load();
  const b = await load();
  recordEvent(a, changed("evt_1", "co_1"), "inst_1");
  recordEvent(b, changed("evt_1", "co_1"), "inst_1");                       // the same pair, delivered twice at once
  recordEvent(b, changed("evt_2", "co_1"), "inst_1");
  await save(a);
  await save(b);
  const stored = await load();
  assert.deepEqual(stored.events.map((e) => e.id).sort(), ["evt_1", "evt_2"]);
});

test("processing syncs each named company once, from its own token, and marks every row", async () => {
  await resetStore([company("co_1", "inst_1", "tok_1", "c1"), company("co_2", "inst_2", "tok_2", "c1")]);
  const s = await load();
  recordEvent(s, changed("evt_1", "co_1"), "inst_1");
  recordEvent(s, changed("evt_1", "co_1"), "inst_1");                       // replay: no second row
  recordEvent(s, changed("evt_1", "co_2"), "inst_2");                       // same event for the second install
  recordEvent(s, changed("evt_2", "co_1"), "inst_1");                       // another change at co_1: shares its sync
  recordEvent(s, changed("evt_3", "co_gone"), "inst_9");                    // a company we hold no install for
  await save(s);

  const calls: string[] = [];
  const f = fakeInvestments({ c1: page([rec("inv_a")], "c2") }, calls);
  const result = await processInbox({ fetch: f });
  assert.deepEqual(calls.sort(), ["tok_1 c1", "tok_2 c1"]);                 // one sync per company, never crossed
  assert.deepEqual(result.synced.sort(), ["co_1", "co_2"]);
  assert.equal(result.processed, 4);

  const stored = await load();
  assert.deepEqual(stored.events.map((e) => `${e.id}/${e.installation_id} ${e.outcome}`).sort(), [
    "evt_1/inst_1 synced", "evt_1/inst_2 synced", "evt_2/inst_1 synced", "evt_3/inst_9 not installed here",
  ]);
  assert.equal(stored.companies.co_1.sync.cursor, "c2");
  assert.equal(stored.companies.co_2.sync.cursor, "c2");

  assert.deepEqual(await processInbox({ fetch: f }), { processed: 0, failed: 0, synced: [] });  // nothing left
  assert.equal(calls.length, 2);
});

test("a failed sync leaves its rows queued for the next pass, then gives up after MAX_ATTEMPTS", async () => {
  await resetStore([company("co_1", "inst_1", "tok_1", "c1")]);
  const s = await load();
  recordEvent(s, changed("evt_1", "co_1"), "inst_1");
  await save(s);
  const down = fakeInvestments({ c1: { status: 403, body: { error: { type: "forbidden", message: "insufficient scope" } } } });

  assert.deepEqual(await processInbox({ fetch: down }), { processed: 0, failed: 1, synced: [] });
  let row = (await load()).events[0];
  assert.equal(row.processed_at, null);
  assert.equal(row.attempts, 1);

  for (let i = 1; i < MAX_ATTEMPTS; i++) await processInbox({ fetch: down });
  row = (await load()).events[0];
  assert.match(row.outcome ?? "", /^failed: /);
  assert.notEqual(row.processed_at, null);
});
