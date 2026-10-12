import { test } from "node:test";
import assert from "node:assert/strict";
import { syncCompany } from "../lib/installs.ts";
import { acquireRemote, load, LockBusy, save, withLock, type RemoteLockClient } from "../lib/store.ts";
import { WefunderError } from "../lib/wefunder.ts";
import { company, fakeInvestments, page, rec, resetStore, useTempStore } from "./helpers.ts";

useTempStore();

test("two overlapping syncs of one company run one after the other, and the cursor never moves back", async () => {
  await resetStore([company("co_1", "inst_1", "tok_1", "c1")]);
  const stale = await load();                                  // a request that loaded before either sync
  const a = await load();
  const b = await load();
  const calls: string[] = [];
  const f = fakeInvestments({
    c1: { ...page([rec("inv_a")], "c2"), delayMs: 50 },       // the first sync is slow
    c2: page([rec("inv_b")], "c3"),
  }, calls);

  await Promise.all([syncCompany(a, a.companies.co_1, f), syncCompany(b, b.companies.co_1, f)]);
  // The second waited for the lock, then started from the cursor the first saved. Without the
  // lock both would read c1, and whichever saved last would decide the cursor.
  assert.deepEqual(calls, ["tok_1 c1", "tok_1 c2"]);
  let stored = (await load()).companies.co_1;
  assert.equal(stored.sync.cursor, "c3");
  assert.equal(stored.sync.generation, 2);
  assert.deepEqual(Object.keys(stored.records).sort(), ["inv_a", "inv_b"]);

  // Each route saves its own copy once more on the way out. The first sync's copy (cursor c2) and a
  // copy loaded before both syncs (c1) are older: neither may put its cursor back.
  await save(a);
  await save(stale);
  stored = (await load()).companies.co_1;
  assert.equal(stored.sync.cursor, "c3");
  assert.deepEqual(Object.keys(stored.records).sort(), ["inv_a", "inv_b"]);
  assert.equal(a.companies.co_1.sync.cursor, "c3");             // save() also brings the caller's copy up to date
});

test("a lock still held after waitMs is skipped with LockBusy, and the work never runs", async () => {
  let release!: () => void;
  const holder = withLock("company:co_busy", () => new Promise<void>((r) => { release = r; }));
  let ran = false;
  await assert.rejects(withLock("company:co_busy", async () => { ran = true; }, { waitMs: 30 }), LockBusy);
  assert.equal(ran, false);
  release();
  await holder;
  await withLock("company:co_busy", async () => { ran = true; }, { waitMs: 30 });   // free again
  assert.equal(ran, true);
});

test("a 401 on the company token marks the install disconnected, persists it, and stops further syncs", async () => {
  await resetStore([company("co_1", "inst_1", "tok_revoked", "c1")]);
  const s = await load();
  const calls: string[] = [];
  const f = fakeInvestments({
    c1: { status: 401, body: { error: { type: "unauthorized", message: "The installation this token was issued for has been revoked" } } },
  }, calls);

  await assert.rejects(syncCompany(s, s.companies.co_1, f), (e: unknown) => e instanceof WefunderError && e.status === 401);
  const stored = (await load()).companies.co_1;
  assert.match(stored.disconnected?.reason ?? "", /revoked/);
  assert.equal(stored.sync.cursor, "c1");                       // the cursor is untouched

  const again = await load();
  await assert.rejects(syncCompany(again, again.companies.co_1, f), /disconnected/);
  assert.equal(calls.length, 1);                                // no second call with a dead token
});

// Redis / Upstash: SET NX PX with a token, released only while the token still matches.
function fakeRedis(): RemoteLockClient & { value: (k: string) => string | undefined } {
  const m = new Map<string, { token: string; until: number }>();
  const live = (k: string) => { const v = m.get(k); return v && v.until > Date.now() ? v : undefined; };
  return {
    setNxPx: async (k, token, ttl) => { if (live(k)) return false; m.set(k, { token, until: Date.now() + ttl }); return true; },
    delIfEquals: async (k, token) => { if (live(k)?.token === token) m.delete(k); },
    value: (k) => live(k)?.token,
  };
}

test("the Redis lock waits for a holder, and an expired holder's release does not free the next owner", async () => {
  const r = fakeRedis();
  const first = await acquireRemote(r, "k", { ttlMs: 40, waitMs: 0 });
  assert.ok(first);
  assert.equal(await acquireRemote(r, "k", { waitMs: 0 }), null);          // held: skipped
  const second = await acquireRemote(r, "k", { ttlMs: 10_000, waitMs: 500 }); // waits until the first expires
  assert.ok(second);
  const owner = r.value("k");
  await first!();                                                          // late release with the old token
  assert.equal(r.value("k"), owner);                                       // the second owner keeps the lock
  await second!();
  assert.equal(r.value("k"), undefined);
});
