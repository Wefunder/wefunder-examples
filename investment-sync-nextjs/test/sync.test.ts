import { test } from "node:test";
import assert from "node:assert/strict";
import { Wefunder } from "@wefunder/sdk";
import { sync, type SyncTarget } from "../lib/wefunder.ts";
import { emptySync, type InvestmentRecord } from "../lib/store.ts";

const fresh = (): SyncTarget => ({ records: {} as Record<string, InvestmentRecord>, sync: emptySync() });

// A fake Wefunder: a script of responses keyed by the cursor param. Injected through the SDK's
// `fetch` option, so the real client code path (headers, envelope, error mapping) is exercised.
function fakeServer(script: Record<string, { status?: number; body: unknown }>, seen: string[] = []) {
  const f = async (input: URL | RequestInfo) => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    assert.equal(u.pathname, "/investments");
    const key = u.searchParams.get("cursor") ?? "";
    seen.push(key);
    const r = script[key];
    if (!r) throw new Error(`unexpected cursor ${JSON.stringify(key)}`);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  };
  return new Wefunder({ accessToken: "at_live_company", fetch: f as unknown as typeof fetch, retry: { maxRetries: 0 } as never });
}

const rec = (id: string, extra: Record<string, unknown> = {}) => ({ id, visible: true, status: "active", observed_at: "2026-10-01T00:00:00Z", ...extra });

test("bootstrap follows has_more, stores the final cursor, then a delta applies tombstones", async () => {
  const s = fresh();
  const seen: string[] = [];
  let result = await sync(s, fakeServer({
    "": { body: { data: [rec("inv_a"), rec("inv_b")], meta: { mode: "bootstrap", has_more: true, next_cursor: "c1", page_count: 1, published_through: "2026-09-18T00:00:00Z" } } },
    c1: { body: { data: [rec("inv_c")], meta: { mode: "bootstrap", has_more: false, next_cursor: "c2", page_count: 2, published_through: "2026-09-18T00:00:00Z" } } },
  }, seen));
  assert.deepEqual(seen, ["", "c1"]);
  assert.equal(result.mode, "bootstrap");
  assert.equal(Object.keys(s.records).length, 3);
  assert.equal(s.sync.cursor, "c2");
  assert.equal(s.sync.bootstraps, 1);

  // Delta: inv_b left our view (tombstone), inv_a changed. onChange sees the held copy.
  const changes: [string | null, string][] = [];
  result = await sync(s, fakeServer({
    c2: { body: { data: [{ id: "inv_b", visible: false }, rec("inv_a", { status: "executed" })], meta: { mode: "delta", has_more: false, next_cursor: "c3", page_count: 1, published_through: "2026-09-18T01:00:00Z" } } },
  }), { onChange: (held, r) => changes.push([held ? String(held.status) : null, String(r.status ?? "tombstone")]) });
  assert.equal(result.mode, "delta");
  assert.equal(result.tombstoned, 1);
  assert.equal(s.records["inv_b"], undefined);
  assert.equal(s.records["inv_a"].status, "executed");
  assert.equal(s.sync.cursor, "c3");
  assert.deepEqual(changes, [["active", "tombstone"], ["active", "executed"]]);
});

test("a 410 on a stale cursor re-lists and REPLACES what we hold", async () => {
  const s = fresh();
  s.sync.cursor = "ancient";
  s.records = { inv_gone: rec("inv_gone") as InvestmentRecord }; // a record the fresh list no longer returns
  const result = await sync(s, fakeServer({
    ancient: { status: 410, body: { error: { type: "gone", message: "cursor predates the retention window" } } },
    "": { body: { data: [rec("inv_a")], meta: { mode: "bootstrap", has_more: false, next_cursor: "c9", page_count: 1, published_through: null } } },
  }));
  assert.equal(result.re_bootstrapped, true);
  assert.deepEqual(Object.keys(s.records), ["inv_a"]);
  assert.equal(s.sync.cursor, "c9");
});

test("an own-audience canceled record (visible:false WITH a status) is kept, not tombstoned", async () => {
  const s = fresh();
  await sync(s, fakeServer({
    "": { body: { data: [{ id: "inv_mine", visible: false, status: "canceled", observed_at: "2026-10-01T00:00:00Z" }], meta: { mode: "bootstrap", has_more: false, next_cursor: "c1", page_count: 1, published_through: null } } },
  }));
  assert.equal(s.records["inv_mine"].status, "canceled");
});

test("an empty delta page still advances the cursor", async () => {
  const s = fresh();
  s.sync.cursor = "c5";
  await sync(s, fakeServer({ c5: { body: { data: [], meta: { mode: "delta", has_more: false, next_cursor: "c6", page_count: 1, published_through: null } } } }));
  assert.equal(s.sync.cursor, "c6");
});
