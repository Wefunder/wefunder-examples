import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertCompany } from "../lib/installs.ts";
import { EMPTY, type State } from "../lib/store.ts";

process.env.WEFUNDER_INSTALL_SCOPES = "read:investments read:offerings read:investors:pii";

const installation = (scopes: string[]) => ({
  id: "inst_1", type: "installation",
  attributes: { target: { type: "company" as const, id: "co_1", name: "Acme" }, tier: "editor", scopes, status: "active" as const, installed_at: "2026-10-01T00:00:00Z", installed_by: "S. Hansen", revoked_at: null },
});

test("the identity flag comes from the GRANTED scopes, not the requested ones", () => {
  const s: State = structuredClone(EMPTY);
  const withPii = upsertCompany(s, installation(["read:investments", "read:offerings", "read:investors:pii"]), { access_token: "at_live_a", scope: "read:investments read:offerings read:investors:pii" });
  assert.equal(withPii.identity, true);

  const dropped = upsertCompany(structuredClone(EMPTY), installation(["read:investments", "read:offerings"]), { access_token: "at_live_b", scope: "read:investments read:offerings" });
  assert.equal(dropped.identity, false);                        // asked for PII, server dropped it silently
});

test("minting for an existing install takes the token's scope as the effective grant and clears disconnected", () => {
  const s: State = structuredClone(EMPTY);
  const first = upsertCompany(s, installation(["read:investments"]), null);
  first.disconnected = { at: "2026-10-02T00:00:00Z", reason: "401" };
  const minted = upsertCompany(s, installation(["read:investments"]), { access_token: "at_live_c", scope: "read:investments read:investors:pii" });
  assert.equal(minted.token?.accessToken, "at_live_c");
  assert.deepEqual(minted.scopes, ["read:investments", "read:investors:pii"]);
  assert.equal(minted.disconnected, null);
  assert.equal(minted.sync, first.sync);                        // the mirror and cursor survive a re-mint
});
