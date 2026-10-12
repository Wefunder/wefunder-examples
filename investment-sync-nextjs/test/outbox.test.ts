// Delivery is serialized (lib/notify.ts `drainOutbox`): two requests holding the same pending
// line post it once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { drainOutbox, enqueue } from "../lib/notify.ts";
import { load, save } from "../lib/store.ts";
import { company, rec, resetStore, useTempStore } from "./helpers.ts";

useTempStore();

test("two overlapping drains post one pending line once, and both copies end up marked delivered", async () => {
  await resetStore([company("co_1", "inst_1", "tok_1", "c1"), company("co_2", "inst_2", "tok_2", "c1")]);
  const seed = await load();
  enqueue(seed, "co_1", null, rec("inv_a", { amounts: { committed_cents: 250000, currency: "usd" } }));
  await save(seed);                                               // A's sync committed a line

  const a = await load();                                         // A goes on to deliver…
  const b = await load();                                         // …while B, syncing another company, holds the same line
  const posts: string[] = [];
  const slowSlack = (async (_url: unknown, init?: RequestInit) => {
    posts.push(String(init?.body));
    await new Promise((r) => setTimeout(r, 60));
    return new Response("ok");
  }) as unknown as typeof fetch;

  const [ra, rb] = await Promise.all([drainOutbox(a, "https://hooks.slack.test/x", slowSlack), drainOutbox(b, "https://hooks.slack.test/x", slowSlack)]);
  assert.equal(posts.length, 1);                                  // one Slack message, not two
  assert.deepEqual([ra.delivered + rb.delivered, ra.failed + rb.failed], [1, 0]);
  assert.ok(a.notifications[0].delivered_at);
  assert.ok(b.notifications[0].delivered_at);
  assert.ok((await load()).notifications[0].delivered_at);
});

test("a failed post stays pending for the next drain, which is also serialized", async () => {
  await resetStore([company("co_1", "inst_1", "tok_1", "c1")]);
  const s = await load();
  enqueue(s, "co_1", null, rec("inv_a", { amounts: { committed_cents: 100, currency: "usd" } }));
  const down = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
  assert.deepEqual(await drainOutbox(s, "https://hooks.slack.test/x", down), { delivered: 0, failed: 1 });
  assert.equal((await load()).notifications[0].delivered_at, null);
  const up = (async () => new Response("ok")) as unknown as typeof fetch;
  assert.deepEqual(await drainOutbox(await load(), "https://hooks.slack.test/x", up), { delivered: 1, failed: 0 });
  assert.ok((await load()).notifications[0].delivered_at);
});
