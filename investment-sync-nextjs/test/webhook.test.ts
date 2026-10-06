import { test } from "node:test";
import assert from "node:assert/strict";
import { constructEvent, signWebhook, WebhookSignatureError } from "@wefunder/sdk";

// Canonical vector from https://docs.wefunder.com/partner-api/webhooks/verification — asserted
// against Wefunder's signing code in their CI, so the SDK's verifier must accept it.
const SECRET = "whsec_docvector_2f9c1a4b8e7d6c5a";
const T = 1705334400;
const BODY = '{"id":"evt_0KZq8xExampleOpened01","event":"offering.opened","created_at":"2026-01-15T12:00:00Z","mode":"live","data":{"offering":"ofr_9m2ExampleRound00","status":"open","company":{"name":"Example Company","url":"example-company"}}}';
const V1 = "0385f3fa13024fc4d851034779083ea49483162d32b668d7646e2b94fccd84db";
const now = () => (T + 10) * 1000;

test("accepts the documented test vector and parses the envelope", () => {
  const event = constructEvent(BODY, { "wefunder-signature": `t=${T},v1=${V1}` }, SECRET, { now });
  assert.equal(event.id, "evt_0KZq8xExampleOpened01");
  assert.equal(event.event, "offering.opened");
});

test("rejects a tampered body with a typed error", () => {
  assert.throws(() => constructEvent(BODY.replace("open", "closed"), { "wefunder-signature": `t=${T},v1=${V1}` }, SECRET, { now }), WebhookSignatureError);
});

test("rejects a stale timestamp (replay)", () => {
  assert.throws(() => constructEvent(BODY, { "wefunder-signature": `t=${T},v1=${V1}` }, SECRET, { now: () => (T + 301) * 1000 }), WebhookSignatureError);
});

test("accepts any matching v1 during a secret rotation", () => {
  const other = signWebhook({ secret: "whsec_other", payload: BODY, timestamp: T });
  const header = `${other},v1=${V1}`;
  const event = constructEvent(BODY, { "wefunder-signature": header }, SECRET, { now });
  assert.equal(event.event, "offering.opened");
});

test("rejects a missing header", () => {
  assert.throws(() => constructEvent(BODY, {}, SECRET, { now }), WebhookSignatureError);
});
