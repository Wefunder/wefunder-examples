// The requests this example sends to Wefunder, checked against the real SDK with a fake fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { errorKey } from "../lib/errors.ts";
import { createCheckoutSession, getCheckoutSession, getMemberLink, listMemberLinks, mintMemberLink, raiseStats } from "../lib/wefunder.ts";
import { OFFERING, TOKEN, apiError, fakeWefunder, memberLink, session } from "./helpers.ts";

test("raise totals are read from the offering's stats with the installation token", async () => {
  const { deps, calls } = fakeWefunder(() => ({ body: { data: { offering: OFFERING, currency: "usd", by_status: {}, total: { count: 0, committed_cents: 0, raised_cents: 0 } } } }));
  const stats = await raiseStats(OFFERING, deps);
  assert.equal(stats.offering, OFFERING);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [`GET /offerings/${OFFERING}/stats`]);
  assert.equal(calls[0]?.token, TOKEN);
});

test("a member link is minted with the data room's user id as its reference, and nothing else about the user", async () => {
  const { deps, calls } = fakeWefunder(() => ({ status: 201, body: { data: memberLink("il_1", "created", { reference: "dr_user_1001" }) } }));
  const link = await mintMemberLink(OFFERING, "dr_user_1001", deps);
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.path, `/offerings/${OFFERING}/member_links`);
  assert.deepEqual(calls[0]?.body, { member_link: { reference: "dr_user_1001" } }); // no email, no name
  assert.deepEqual(link, { id: "il_1", url: "https://wefunder.example/example-co?invite_token=il_1", state: "created", reference: "dr_user_1001", wefunderUserId: null, investmentId: null });
});

test("pressing Invest again returns the same live link: a 200 is as good as a 201", async () => {
  const { deps } = fakeWefunder(() => ({ status: 200, body: { data: memberLink("il_1", "bound", { reference: "dr_user_1001", wefunder_user_id: "usr_abc" }) } }));
  const link = await mintMemberLink(OFFERING, "dr_user_1001", deps);
  assert.equal(link.id, "il_1");
  assert.equal(link.state, "bound");
  assert.equal(link.wefunderUserId, "usr_abc");
});

test("a link is read by id, and the founder's list follows every page", async () => {
  const { deps, calls } = fakeWefunder((call) => {
    if (call.path === "/member_links/il_2") return { body: { data: memberLink("il_2", "invested", { investment_id: "inv_9" }) } };
    if (call.query.cursor === "p2") return { body: { data: [memberLink("il_1", "created")], meta: { has_more: false } } };
    return { body: { data: [memberLink("il_3", "canceled"), memberLink("il_2", "invested")], meta: { has_more: true, next_cursor: "p2" } } };
  });
  assert.equal((await getMemberLink("il_2", deps)).investmentId, "inv_9");
  assert.deepEqual((await listMemberLinks(OFFERING, deps)).map((l) => `${l.id}:${l.state}`), ["il_3:canceled", "il_2:invested", "il_1:created"]);
  assert.deepEqual(calls.map((c) => c.method), ["GET", "GET", "GET"]); // reading never mints
});

test("an investment session is created for the user's email with both return URLs and an idempotency key", async () => {
  const { deps, calls } = fakeWefunder(() => ({ status: 201, body: { data: session("is_1", "pending", { email: "ada@example.com" }) } }));
  const s = await createCheckoutSession(
    OFFERING,
    { email: "ada@example.com", successUrl: "http://localhost:3000/?checkout=success", cancelUrl: "http://localhost:3000/?checkout=cancel", idempotencyKey: "key-1" },
    deps,
  );
  assert.equal(calls[0]?.path, `/offerings/${OFFERING}/investment_sessions`);
  assert.deepEqual(calls[0]?.body, {
    investment_session: { email: "ada@example.com", success_url: "http://localhost:3000/?checkout=success", cancel_url: "http://localhost:3000/?checkout=cancel" },
  });
  assert.equal(calls[0]?.idempotencyKey, "key-1");
  assert.deepEqual(s, { id: "is_1", url: "https://wefunder.example/invest/session/is_1", status: "pending", email: "ada@example.com", investmentId: null });
});

test("a session is read by id", async () => {
  const { deps, calls } = fakeWefunder(() => ({ body: { data: session("is_1", "completed", { investment_id: "inv_5" }) } }));
  const s = await getCheckoutSession("is_1", deps);
  assert.equal(calls[0]?.path, "/investment_sessions/is_1");
  assert.equal(s.status, "completed");
  assert.equal(s.investmentId, "inv_5");
});

test("Wefunder's refusals map to the fixed sentences the page can show", async () => {
  const cases: Array<[number, string, "member_link" | "investment_session", string]> = [
    [422, "offering_not_open", "member_link", "not_open"],
    [422, "offering_has_no_page", "member_link", "no_page"],
    [404, "not_found", "member_link", "not_covered"],
    [403, "forbidden", "member_link", "not_allowed"],
    [401, "unauthorized", "member_link", "not_allowed"],
    [409, "session_conflict", "investment_session", "session_conflict"],
    [422, "validation_error", "investment_session", "return_url"],
    [422, "offering_not_open", "investment_session", "not_open"],
    [422, "validation_error", "member_link", "invalid"],
  ];
  for (const [status, type, call, expected] of cases) {
    const { deps } = fakeWefunder(() => apiError(status, type));
    const attempt = call === "member_link" ? mintMemberLink(OFFERING, "dr_user_1001", deps) : createCheckoutSession(OFFERING, { email: "a@example.com", successUrl: "http://localhost:3000/", cancelUrl: "http://localhost:3000/" }, deps);
    const error = await attempt.then(() => null, (e: unknown) => e);
    assert.equal(errorKey(error, call), expected, `${status} ${type} on ${call}`);
  }
  assert.equal(errorKey(new Error("socket hang up"), "member_link"), "unknown");
});
