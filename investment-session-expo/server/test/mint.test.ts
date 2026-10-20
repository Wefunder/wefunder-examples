// The mint handler against a mocked fetch: right endpoint, bearer from the configured token,
// return URLs passed through, idempotency key sent, Wefunder errors propagated with their type.
// No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../lib/app.ts";
import { mintSession, returnUrls } from "../lib/mint.ts";

type Call = { method: string; url: URL; headers: Headers; body: unknown };

function fakeFetch(reply: { status: number; body: unknown }, calls: Call[] = []) {
  const f = async (input: URL | RequestInfo, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const text = await req.text();
    calls.push({ method: req.method, url: new URL(req.url), headers: req.headers, body: text ? JSON.parse(text) : null });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
  };
  return { fetch: f as unknown as typeof fetch, calls };
}

const created = { data: { id: "is_abc123", type: "investment_session", attributes: { status: "pending", url: "https://wefunder.com/invest/session/is_abc123" } } };

const deps = (f: typeof fetch) => ({
  token: "wf_test_token_value",
  returnUrl: "wefunderexample://invest/return",
  fetch: f,
  idempotencyKey: () => "idem-1",
  // retries would otherwise sleep on 5xx; the error test uses a 4xx, which the SDK does not retry
});

test("mints on the offering's sessions endpoint with the install token and both return URLs", async () => {
  const { fetch, calls } = fakeFetch({ status: 201, body: created });
  const minted = await mintSession({ offeringId: "ofr_x1", email: "investor@example.com" }, deps(fetch));

  assert.deepEqual(minted, { id: "is_abc123", url: "https://wefunder.com/invest/session/is_abc123" });
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.method, "POST");
  assert.equal(c.url.origin, "https://api.wefunder.com");
  assert.equal(c.url.pathname, "/offerings/ofr_x1/investment_sessions");
  assert.equal(c.headers.get("authorization"), "Bearer wf_test_token_value");
  assert.equal(c.headers.get("idempotency-key"), "idem-1");
  assert.deepEqual(c.body, {
    investment_session: {
      email: "investor@example.com",
      success_url: "wefunderexample://invest/return?result=success",
      cancel_url: "wefunderexample://invest/return?result=cancel",
    },
  });
});

test("return URLs are hierarchical and differ only by result=", () => {
  assert.deepEqual(returnUrls("com.partner.app://wefunder-return"), {
    success_url: "com.partner.app://wefunder-return?result=success",
    cancel_url: "com.partner.app://wefunder-return?result=cancel",
  });
});

test("a Wefunder refusal propagates with its status and type", async () => {
  const { fetch } = fakeFetch({
    status: 422,
    body: { error: { type: "validation_error", message: "success_url must be on a registered redirect URI" } },
  });
  await assert.rejects(
    mintSession({ offeringId: "ofr_x1", email: "investor@example.com" }, deps(fetch)),
    (e: Error & { status?: number; type?: string }) => e.status === 422 && e.type === "validation_error",
  );
});

test("the HTTP layer: POST /sessions validates, mints, and passes Wefunder errors through", async () => {
  const ok = fakeFetch({ status: 201, body: created });
  const app = { ...deps(ok.fetch), offeringIds: ["ofr_x1"] };

  assert.equal((await handle("POST", "/sessions", { offering_id: "ofr_other", email: "a@b.c" }, app)).status, 422);
  assert.equal((await handle("POST", "/sessions", { offering_id: "ofr_x1", email: "nope" }, app)).status, 422);
  assert.equal(ok.calls.length, 0, "nothing reached Wefunder for an invalid request");

  const minted = await handle("POST", "/sessions", { offering_id: "ofr_x1", email: "investor@example.com" }, app);
  assert.deepEqual(minted, { status: 201, body: { id: "is_abc123", url: "https://wefunder.com/invest/session/is_abc123" } });
  assert.equal(ok.calls[0].url.pathname, "/offerings/ofr_x1/investment_sessions");

  const refused = fakeFetch({ status: 409, body: { error: { type: "session_conflict", message: "another app holds this recipient's session" } } });
  const r = await handle("POST", "/sessions", { offering_id: "ofr_x1", email: "investor@example.com" }, { ...deps(refused.fetch), offeringIds: ["ofr_x1"] });
  assert.equal(r.status, 409);
  assert.equal((r.body as { error: { type: string } }).error.type, "session_conflict");

  assert.equal((await handle("GET", "/nothing", null, app)).status, 404);
});

test("GET /sessions/:id reads the status with the install token", async () => {
  const { fetch, calls } = fakeFetch({ status: 200, body: { data: { id: "is_abc123", attributes: { status: "completed", investment_id: "invt_1" } } } });
  const r = await handle("GET", "/sessions/is_abc123", null, { ...deps(fetch), offeringIds: ["ofr_x1"] });
  assert.deepEqual(r, { status: 200, body: { id: "is_abc123", status: "completed", investment_id: "invt_1" } });
  assert.equal(calls[0].url.pathname, "/investment_sessions/is_abc123");
  assert.equal(calls[0].headers.get("authorization"), "Bearer wf_test_token_value");
});
