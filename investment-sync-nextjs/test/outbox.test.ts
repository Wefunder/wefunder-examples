// Delivery is serialized (lib/notify.ts `drainOutbox`): two requests holding the same pending
// line post it once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAIM_MS, drain, drainOutbox, enqueue, outboxStore, POST_TIMEOUT_MS } from "../lib/notify.ts";
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

// Redis / Upstash: the outbox lock is a lease. If A's drain outlives it, B gets the lock while A
// is still posting. The file mutex cannot expire, so the expired-lease situation is reproduced at
// the layer below the lock: both A and B have loaded the line as pending, A claims and posts, and
// B drains while A's post is in flight, exactly as it would after acquiring an expired lease.
// The claim is a compare-and-set on the stored row, so B loses it and skips the line.
test("after a lease expiry, a drain that loaded the line as pending before the first claim still posts nothing twice", async () => {
  await resetStore([company("co_1", "inst_1", "tok_1", "c1")]);
  const seed = await load();
  enqueue(seed, "co_1", null, rec("inv_a", { amounts: { committed_cents: 100, currency: "usd" } }));
  enqueue(seed, "co_1", null, rec("inv_b", { amounts: { committed_cents: 200, currency: "usd" } }));
  await save(seed);
  const a = await load();
  const b = await load();                                         // B loaded BEFORE A claimed anything
  const posts: string[] = [];
  let releaseStall!: () => void;
  const stalled = new Promise<void>((r) => { releaseStall = r; });
  const slack = (async (_url: unknown, init?: RequestInit) => {
    posts.push(String(init?.body));
    if (posts.length === 1) await stalled;                        // A's first post hangs past any lease
    return new Response("ok");
  }) as unknown as typeof fetch;

  const aDrain = drain(a, "https://hooks.slack.test/x", slack, outboxStore(a));
  await new Promise((r) => setTimeout(r, 20));                    // A has won inv_a and is mid-post
  const rb = await drain(b, "https://hooks.slack.test/x", slack, outboxStore(b));   // B: the lease expired; it drains now
  releaseStall();
  const ra = await aDrain;

  assert.equal(posts.length, 2);                                  // inv_a once (A), inv_b once (B)
  assert.equal(new Set(posts).size, 2);
  assert.deepEqual([ra, rb], [{ delivered: 1, failed: 0 }, { delivered: 1, failed: 0 }]);
  const stored = (await load()).notifications;
  assert.ok(stored.every((n) => n.delivered_at && !n.claimed_until && !n.claimed_by));
  assert.equal(stored.find((n) => n.investment === "inv_a")!.attempts, 1);   // B's failed claim is not an attempt
});

test("two drains racing for the same line from the same pending copy: exactly one wins the claim", async () => {
  await resetStore([company("co_1", "inst_1", "tok_1", "c1")]);
  const seed = await load();
  enqueue(seed, "co_1", null, rec("inv_a", { amounts: { committed_cents: 100, currency: "usd" } }));
  await save(seed);
  const a = await load();
  const b = await load();
  const wins = await Promise.all([outboxStore(a).claim(a.notifications[0]), outboxStore(b).claim(b.notifications[0])]);
  assert.deepEqual(wins.sort(), [false, true]);
  assert.equal((await load()).notifications[0].attempts, 1);
});

test("a post is cut off well inside its claim, so a claim never expires mid-post", () => {
  assert.ok(POST_TIMEOUT_MS * 2 < CLAIM_MS);
});
