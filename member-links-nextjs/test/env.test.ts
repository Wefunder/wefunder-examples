import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOfferings } from "../lib/env.ts";

test("offering ids parse from spaces or commas, with optional =Label", () => {
  assert.deepEqual(parseOfferings("ofr_a=Arc_Hockey, ofr_b\nofr_c"), [
    { id: "ofr_a", label: "Arc Hockey" },
    { id: "ofr_b", label: "ofr_b" },
    { id: "ofr_c", label: "ofr_c" },
  ]);
});

test("unset or empty means no deals", () => {
  assert.deepEqual(parseOfferings(undefined), []);
  assert.deepEqual(parseOfferings("  "), []);
});
