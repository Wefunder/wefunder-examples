// The commit fence (lib/store.ts `commitSync`): a sync's cursor and records reach the store only
// if the stored generation is still the one the sync started from, and a sync that does not
// commit leaves nothing behind in the caller's copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncCompany, upsertCompany } from "../lib/installs.ts";
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

test("reconnect: a new installation on a previously synced company starts over and its first sync commits", async () => {
  const old = company("co_1", "inst_1", "tok_old", "c5");
  old.sync.generation = 2;
  old.records = { inv_stale: rec("inv_stale") };
  old.disconnected = { at: "2026-10-01T00:00:00Z", reason: "revoked" };
  await resetStore([old]);
  const s = await load();
  // The Install route: upsert the new install into `s`, then sync it BEFORE the trailing save.
  const installation = { id: "inst_2", type: "installation", attributes: { target: { type: "company" as const, id: "co_1", name: "co_1" }, tier: "editor", scopes: ["read:investments"], status: "active" as const, installed_at: "2026-10-12T00:00:00Z" } };
  const c = upsertCompany(s, installation, { access_token: "tok_new", scope: "read:investments", token_type: "Bearer", installation: "inst_2", created_at: 0 });
  assert.equal(c.installation_id, "inst_2");
  assert.equal(c.disconnected, null);
  assert.equal(c.sync.cursor, null);                              // the old install's mirror is not continued…
  assert.equal(c.sync.generation, 0);
  assert.deepEqual(c.records, {});

  const calls: string[] = [];
  const f = fakeInvestments({ "": page([rec("inv_fresh")], "c1", "bootstrap") }, calls);
  await syncCompany(s, c, f);                                     // …and the first pull under it commits
  assert.deepEqual(calls, ["tok_new "]);
  await save(s);
  const stored = (await load()).companies.co_1;
  assert.equal(stored.installation_id, "inst_2");
  assert.equal(stored.sync.generation, 1);
  assert.equal(stored.sync.cursor, "c1");
  assert.deepEqual(Object.keys(stored.records), ["inv_fresh"]);
});
