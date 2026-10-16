// Runs the <script> from index.html against a mocked fetch and a stub document,
// so the page keeps doing what the guide promises: one GET with the publishable
// key as a plain bearer (no cookies, no token mint), integer cents formatted as
// whole dollars, "reserved" / "reservations" for a Testing-the-Waters round and
// "raised" / "investors" otherwise, the lifetime total when no round is live,
// and a plain line instead of "Loading…" when the request fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PAGE = join(fileURLToPath(new URL(".", import.meta.url)), "..", "index.html");

function extractScript() {
  const html = readFileSync(PAGE, "utf8");
  const match = html.match(/<script>\n([\s\S]*?)<\/script>/);
  assert.ok(match, "index.html must contain the snippet's <script> block");
  const code = match[1];
  assert.ok(code.includes('"pk_live_YOUR_PUBLISHABLE_KEY"'), "the page ships with the key placeholder");
  assert.ok(!/credentials/.test(code), "the snippet never sends cookies");
  assert.ok(!/sk_live|sk_test|\/oauth\/token/.test(code), "the snippet never touches a secret or mints a token");
  return code.replace('"pk_live_YOUR_PUBLISHABLE_KEY"', '"pk_live_test"').replace('"co_YOUR_COMPANY_ID"', '"co_test"');
}

function run({ fetch }) {
  const el = { _text: "Loading…" };
  let settle;
  const done = new Promise((resolve) => { settle = resolve; });
  Object.defineProperty(el, "textContent", { get: () => el._text, set: (v) => { el._text = v; settle(v); } });
  const calls = [];
  globalThis.document = { getElementById: (id) => { assert.equal(id, "wf-raise"); return el; } };
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return fetch(url, init); };
  new Function(extractScript())();
  return done.then((text) => ({ text, calls }));
}

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const company = (attributes) => ({ data: { attributes } });

test("one plain GET with the publishable key as the bearer; cents shown as whole dollars", async () => {
  const { text, calls } = await run({
    fetch: () => json(company({
      current_raise: { amount_raised_cents: 143723100, funding_target_cents: 500000000, investor_count: 6663, testing_the_waters: false },
      totals: { raised_on_wefunder_all_time_cents: 143678100 },
    })),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.wefunder.com/companies/co_test");
  assert.equal(calls[0].init.headers.Authorization, "Bearer pk_live_test");
  assert.equal(calls[0].init.method, undefined);
  assert.equal(calls[0].init.credentials, undefined);
  assert.equal(text, "$1,437,231 raised of $5,000,000 · 6663 investors");
});

test("a Testing-the-Waters round says reserved and reservations", async () => {
  const { text } = await run({
    fetch: () => json(company({
      current_raise: { amount_raised_cents: 1000000, funding_target_cents: 5000000, investor_count: 7, testing_the_waters: true },
      totals: { raised_on_wefunder_all_time_cents: 0 },
    })),
  });
  assert.equal(text, "$10,000 reserved of $50,000 · 7 reservations");
});

test("no live round: the lifetime total", async () => {
  const { text } = await run({ fetch: () => json(company({ current_raise: null, totals: { raised_on_wefunder_all_time_cents: 250000000 } })) });
  assert.equal(text, "$2,500,000 raised on Wefunder");
});

test("a failed request leaves a plain line, not Loading…", async () => {
  const { text } = await run({ fetch: () => { throw new TypeError("Failed to fetch"); } });
  assert.equal(text, "See our raise on Wefunder");
});
