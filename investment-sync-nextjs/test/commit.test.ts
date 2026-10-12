// The commit fence (lib/store.ts `commitSync`): a sync's cursor and records reach the store only
// if the stored generation is still the one the sync started from, and a sync that does not
// commit leaves nothing behind in the caller's copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncCompany } from "../lib/installs.ts";
import { load, save, StaleSync, testHooks, update } from "../lib/store.ts";
import { company, fakeInvestments, page, rec, resetStore, useTempStore } from "./helpers.ts";

useTempStore();

test("an expired lease holder that commits after its successor is refused and discards its result", async () => {
  await resetStore([company("co_1", "inst_1", "tok_1", "c1")]);
  const a = await load();                                         // A: holds the lease, then outlives it
  const calls: string[] = [];
  const f = fakeInvestments({ c1: { ...page([rec("inv_old")], "c2"), delayMs: 80 } }, calls);
  const slow = syncCompany(a, a.companies.co_1, f);

  // While A is still listing, a successor (its own lease after A's expired) commits generation 1.
  // The file backend cannot expire a lease, so the successor's commit is written directly: that
  // is exactly what the store looks like to A when its lease is gone.
  await new Promise((r) => setTimeout(r, 20));
  await update((s) => {
    s.companies.co_1.sync = { ...s.companies.co_1.sync, cursor: "c9", generation: 1 };
    s.companies.co_1.records = { inv_new: rec("inv_new") };
  });

  await assert.rejects(slow, StaleSync);
  const stored = (await load()).companies.co_1;
  assert.equal(stored.sync.cursor, "c9");                         // the successor's commit stands
  assert.equal(stored.sync.generation, 1);
  assert.deepEqual(Object.keys(stored.records), ["inv_new"]);
  // A's copy was rolled back to what it read: no cursor, records or queued line survive the refusal…
  assert.equal(a.companies.co_1.sync.cursor, "c1");
  assert.equal(a.companies.co_1.sync.generation, 0);
  assert.deepEqual(a.companies.co_1.records, {});
  assert.equal(a.notifications.length, 0);
  // …so the route's trailing save of A's copy cannot regress the store either.
  await save(a);
  assert.equal((await load()).companies.co_1.sync.cursor, "c9");
  assert.deepEqual(Object.keys((await load()).companies.co_1.records), ["inv_new"]);
});

test("a failed commit leaves the caller holding the base generation; a later overlapping sync wins and the caller's final save keeps it", async () => {
  await resetStore([company("co_1", "inst_1", "tok_1", "c1")]);
  const a = await load();
  const f = fakeInvestments({ c1: page([rec("inv_a", { amounts: { committed_cents: 100, currency: "usd" } })], "c2") });

  testHooks.beforeWrite = () => { throw new Error("disk full"); };
  try {
    await assert.rejects(syncCompany(a, a.companies.co_1, f), /disk full/);
  } finally {
    delete testHooks.beforeWrite;
  }
  assert.equal(a.companies.co_1.sync.generation, 0);              // not bumped: the write never happened
  assert.equal(a.companies.co_1.sync.cursor, "c1");
  assert.deepEqual(a.companies.co_1.records, {});
  assert.equal(a.notifications.length, 0);                        // the "New investment" line went with it
  assert.equal((await load()).companies.co_1.sync.generation, 0);

  const b = await load();                                         // a competing sync now commits generation 1
  await syncCompany(b, b.companies.co_1, f);
  assert.equal((await load()).companies.co_1.sync.generation, 1);

  await save(a);                                                  // the failed caller's route still saves on the way out
  const stored = (await load()).companies.co_1;
  assert.equal(stored.sync.generation, 1);
  assert.equal(stored.sync.cursor, "c2");
  assert.deepEqual(Object.keys(stored.records), ["inv_a"]);
  assert.equal((await load()).notifications.length, 1);           // B's line, queued once
});
