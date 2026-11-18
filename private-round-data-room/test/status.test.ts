// The polling rules: what is asked of Wefunder, how often, and what is never asked.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { recordFor } from "../lib/store.ts";
import { FORCE_FLOOR_MS, INVESTED_TTL_MS, RAISE_TTL_MS, USER_TTL_MS, cachedRaise, forgetRaises, recordLink, recordSession, userStatus } from "../lib/status.ts";
import type { CheckoutSessionView, MemberLinkView } from "../lib/wefunder.ts";
import { OFFERING, apiError, fakeWefunder, memberLink, session, useTempStore } from "./helpers.ts";

const USER = "dr_user_1001";
const T0 = 1_800_000_000_000;

const link = (state: MemberLinkView["state"], extra: Partial<MemberLinkView> = {}): MemberLinkView => ({ id: "il_1", url: "https://wefunder.example/x", state, reference: USER, wefunderUserId: null, investmentId: null, ...extra });
const checkout = (status: CheckoutSessionView["status"]): CheckoutSessionView => ({ id: "is_1", url: "https://wefunder.example/s", status, email: "ada@example.com", investmentId: null });

beforeEach(() => {
  useTempStore();
  forgetRaises();
});

test("a user who never pressed Invest costs no request, and polling never mints a link for them", async () => {
  const { deps, calls } = fakeWefunder(() => ({ body: {} }));
  const status = await userStatus(OFFERING, USER, { ...deps, now: () => T0 });
  assert.deepEqual(status.record, {});
  assert.equal(status.watching, false);
  assert.equal(calls.length, 0);
});

test("a minted link is re-read once it is a minute old, by id, and the new state is saved", async () => {
  await recordLink(OFFERING, USER, link("created"), T0);
  const { deps, calls } = fakeWefunder(() => ({ body: { data: memberLink("il_1", "invested", { wefunder_user_id: "usr_abc", investment_id: "inv_7" }) } }));

  const early = await userStatus(OFFERING, USER, { ...deps, now: () => T0 + USER_TTL_MS - 1 });
  assert.equal(early.record.linkState, "created");
  assert.equal(early.watching, true);
  assert.equal(calls.length, 0);

  const later = await userStatus(OFFERING, USER, { ...deps, now: () => T0 + USER_TTL_MS });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET /member_links/il_1"]);
  assert.equal(later.record.linkState, "invested");
  assert.equal(later.record.wefunderUserId, "usr_abc");
  assert.equal(later.record.investmentId, "inv_7");
  assert.equal(later.watching, false);
  assert.equal((await recordFor(OFFERING, USER)).linkState, "invested");
});

test("a canceled link and a finished session are never asked about again", async () => {
  await recordLink(OFFERING, USER, link("canceled"), T0);
  await recordSession(OFFERING, USER, checkout("completed"), T0);
  const { deps, calls } = fakeWefunder(() => ({ body: {} }));
  const status = await userStatus(OFFERING, USER, { ...deps, now: () => T0 + 100 * INVESTED_TTL_MS, force: true });
  assert.equal(calls.length, 0);
  assert.equal(status.watching, false);
});

test("an invested link is re-read every quarter of an hour, and reads bound again once its investment is canceled", async () => {
  await recordLink(OFFERING, USER, link("invested", { wefunderUserId: "usr_abc", investmentId: "inv_7" }), T0);
  const { deps, calls } = fakeWefunder(() => ({ body: { data: memberLink("il_1", "bound", { wefunder_user_id: "usr_abc", investment_id: null }) } }));

  const soon = await userStatus(OFFERING, USER, { ...deps, now: () => T0 + INVESTED_TTL_MS - 1, force: true });
  assert.equal(calls.length, 0); // not every minute, and "check now" does not hurry it
  assert.equal(soon.watching, false);

  const later = await userStatus(OFFERING, USER, { ...deps, now: () => T0 + INVESTED_TTL_MS });
  assert.deepEqual(calls.map((c) => c.path), ["/member_links/il_1"]);
  assert.equal(later.record.linkState, "bound");
  assert.equal(later.record.investmentId, null);
  assert.equal(later.watching, true); // back to the once-a-minute watch
});

test("coming back from checkout may skip the minute, but not the five-second floor", async () => {
  await recordSession(OFFERING, USER, checkout("in_progress"), T0);
  const { deps, calls } = fakeWefunder(() => ({ body: { data: session("is_1", "completed", { investment_id: "inv_5" }) } }));

  await userStatus(OFFERING, USER, { ...deps, now: () => T0 + FORCE_FLOOR_MS - 1, force: true });
  assert.equal(calls.length, 0);

  const status = await userStatus(OFFERING, USER, { ...deps, now: () => T0 + FORCE_FLOOR_MS, force: true });
  assert.deepEqual(calls.map((c) => c.path), ["/investment_sessions/is_1"]);
  assert.equal(status.record.sessionStatus, "completed");
  assert.equal(status.record.sessionInvestmentId, "inv_5");
});

test("when Wefunder cannot be reached the last state read is kept and reported as stale", async () => {
  await recordLink(OFFERING, USER, link("bound", { wefunderUserId: "usr_abc" }), T0);
  const { deps } = fakeWefunder(() => apiError(429, "rate_limited"));
  const status = await userStatus(OFFERING, USER, { ...deps, now: () => T0 + USER_TTL_MS });
  assert.equal(status.record.linkState, "bound");
  assert.equal(status.watching, true);
  assert.ok(status.error);
});

test("a second offering starts fresh for the same user id", async () => {
  await recordLink(OFFERING, USER, link("invested"), T0);
  assert.deepEqual(await recordFor("ofr_test_reg_cf", USER), {});
});

test("raise totals are read once a minute for everyone, and the last figures survive a failed read", async () => {
  let fail = false;
  const { deps, calls } = fakeWefunder(() =>
    fail ? apiError(503, "unavailable") : { body: { data: { currency: "usd", by_status: { executed: { count: 1, committed_cents: 500_00, raised_cents: 500_00 } }, total: { count: 1, committed_cents: 500_00, raised_cents: 500_00 } } } },
  );

  const first = await cachedRaise(OFFERING, { ...deps, now: () => T0 });
  const second = await cachedRaise(OFFERING, { ...deps, now: () => T0 + RAISE_TTL_MS - 1 });
  assert.equal(calls.length, 1);
  assert.equal(first.raise?.raisedCents, 500_00);
  assert.equal(second.stale, false);

  fail = true;
  const third = await cachedRaise(OFFERING, { ...deps, now: () => T0 + RAISE_TTL_MS });
  assert.equal(third.raise?.raisedCents, 500_00);
  assert.equal(third.stale, true);

  forgetRaises();
  const none = await cachedRaise(OFFERING, { ...deps, now: () => T0 });
  assert.equal(none.raise, null);
  assert.equal(none.stale, true);
});
