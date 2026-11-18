import { test } from "node:test";
import assert from "node:assert/strict";
import { SESSION_HOURS, passwordMatches, signSession, verifySession } from "../lib/auth.ts";
import { linkButton, linkSettled, linkShown, sessionButton, sessionSettled, sessionShown } from "../lib/states.ts";
import { USERS, findUser } from "../lib/users.ts";

const SECRET = "test-secret";
const T0 = 1_800_000_000_000;

test("a session cookie names its user until it expires", () => {
  const cookie = signSession("dr_user_1001", SECRET, T0);
  assert.equal(verifySession(cookie, SECRET, T0 + 1), "dr_user_1001");
  assert.equal(verifySession(cookie, SECRET, T0 + SESSION_HOURS * 3600_000), null);
});

test("an altered, re-signed-with-another-secret, or missing cookie names nobody", () => {
  const cookie = signSession("dr_user_1001", SECRET, T0);
  assert.equal(verifySession(cookie.replace("dr_user_1001", "dr_founder_1"), SECRET, T0), null);
  assert.equal(verifySession(signSession("dr_founder_1", "another-secret", T0), SECRET, T0), null);
  assert.equal(verifySession(undefined, SECRET, T0), null);
  assert.equal(verifySession("dr_user_1001", SECRET, T0), null);
  assert.equal(verifySession(cookie, "", T0), null);
});

test("no configured password means nobody signs in", () => {
  assert.equal(passwordMatches("", undefined), false);
  assert.equal(passwordMatches("anything", undefined), false);
  assert.equal(passwordMatches("letmein", "letmein"), true);
  assert.equal(passwordMatches("letmeix", "letmein"), false);
});

test("fixture user ids are unique and are not email addresses: they are sent to Wefunder as references", () => {
  assert.equal(new Set(USERS.map((u) => u.id)).size, USERS.length);
  for (const u of USERS) assert.doesNotMatch(u.id, /@/);
  assert.equal(findUser("dr_user_1001")?.role, "investor");
  assert.equal(findUser("nobody"), null);
  assert.equal(findUser(null), null);
});

test("every Wefunder state has a label, and settled states stop the polling", () => {
  for (const s of ["created", "bound", "invested", "canceled"] as const) assert.ok(linkShown(s).label);
  for (const s of ["pending", "in_progress", "completed", "abandoned", "expired", "canceled"] as const) assert.ok(sessionShown(s).label);
  assert.equal(linkShown(null).label, "Not started");
  assert.equal(linkButton(null), "Invest on Wefunder");
  assert.equal(linkButton("canceled"), "Invest on Wefunder"); // the next click mints a fresh link
  assert.equal(linkButton("bound"), "Continue on Wefunder");
  assert.equal(sessionButton("in_progress"), "Continue checkout"); // active: the same session comes back
  assert.equal(sessionButton("abandoned"), "Go straight to checkout"); // not active: the next press makes a new one
  assert.equal(sessionShown("completed").label, "Checkout finished"); // not "confirmed": payment and verification are separate
  assert.deepEqual([linkSettled("created"), linkSettled("bound"), linkSettled("invested"), linkSettled("canceled")], [false, false, true, true]);
  assert.deepEqual([sessionSettled("pending"), sessionSettled("in_progress"), sessionSettled("abandoned"), sessionSettled("completed"), sessionSettled("expired")], [false, false, true, true, true]);
});
