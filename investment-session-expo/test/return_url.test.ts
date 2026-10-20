import { test } from "node:test";
import assert from "node:assert/strict";
import { RETURN_URL, outcomeFromAuthSession, parseReturnUrl, returnUrls } from "../lib/return_url.ts";

test("both return URLs share one base and differ by a query parameter", () => {
  assert.deepEqual(returnUrls(), {
    successUrl: "wefunderexample://invest/return?result=success",
    cancelUrl: "wefunderexample://invest/return?result=cancel",
  });
  assert.match(RETURN_URL, /^wefunderexample:\/\//, "hierarchical form, so Wefunder can append query parameters");
});

test("success return", () => {
  assert.deepEqual(parseReturnUrl("wefunderexample://invest/return?result=success"), { kind: "success" });
});

test("cancel return carries the session id and reason Wefunder appended", () => {
  const url = "wefunderexample://invest/return?result=cancel&session_id=is_abc123&reason=user_left";
  assert.deepEqual(parseReturnUrl(url), { kind: "cancel", sessionId: "is_abc123", reason: "user_left" });
});

test("cancel return without the appended parameters still reads as cancel", () => {
  assert.deepEqual(parseReturnUrl("wefunderexample://invest/return?result=cancel"), { kind: "cancel", sessionId: null, reason: null });
});

test("unrelated URLs: other scheme, other path, missing or unknown result, not a URL", () => {
  for (const url of [
    "https://wefunder.com/invest/return?result=success",
    "wefunderexample://invest/elsewhere?result=success",
    "wefunderexample://other/return?result=success",
    "wefunderexample://invest/return",
    "wefunderexample://invest/return?result=maybe",
    "not a url",
  ]) {
    assert.deepEqual(parseReturnUrl(url), { kind: "unrelated" }, url);
  }
});

test("a custom base is honoured", () => {
  assert.deepEqual(parseReturnUrl("com.partner.app://wefunder-return?result=success", "com.partner.app://wefunder-return"), { kind: "success" });
  assert.deepEqual(parseReturnUrl("wefunderexample://invest/return?result=success", "com.partner.app://wefunder-return"), { kind: "unrelated" });
});

test("the browser sheet's result maps onto an outcome", () => {
  assert.deepEqual(outcomeFromAuthSession({ type: "success", url: "wefunderexample://invest/return?result=success" }), { kind: "success" });
  assert.deepEqual(outcomeFromAuthSession({ type: "cancel" }), { kind: "closed" });
  assert.deepEqual(outcomeFromAuthSession({ type: "dismiss" }), { kind: "closed" });
});
