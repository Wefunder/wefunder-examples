// Everything this example calls on Wefunder, through the official SDK (`@wefunder/sdk`, 0.1.0-beta.12
// or newer for the `installations` namespace). Small on purpose: every call the guide describes is
// one function here, so the guide (https://docs.wefunder.com/guides/sync-investments-to-crm) and the
// code can be read side by side. Nothing here touches `wf.raw`.
import {
  Wefunder,
  WefunderError,
  createAuthorizationUrl,
  exchangeCode as sdkExchangeCode,
  generatePkce,
  type TokenSet,
  type TokenStore,
} from "@wefunder/sdk";
import { randomBytes } from "node:crypto";
import { env } from "./env.ts";
import type { CompanyState, CompanyToken, InvestmentRecord } from "./store.ts";

export type Fetch = typeof fetch;

// ── Two kinds of client ─────────────────────────────────────────────────────────

// The connected STAFF user. Holds a rotating token set; the SDK refreshes it and hands every new
// set to `store.save`, which must persist it before anything else runs (a refresh token is
// single-use; replaying the old one fails with invalid_grant until someone reconnects).
export function userClient(tokens: TokenSet, store: TokenStore, f?: Fetch): Wefunder {
  return new Wefunder({
    tokens,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    store,
    baseUrl: env.apiBase,
    oauthBaseUrl: env.oauthBase,
    fetch: f,
  });
}

// A company-owned token acts AS the company: `GET /investments` returns that company's records
// and nothing else. No expiry, no refresh; it stops working the moment the install is revoked.
export function companyClient(token: CompanyToken, f?: Fetch): Wefunder {
  return new Wefunder({ accessToken: token.accessToken, baseUrl: env.apiBase, fetch: f });
}

// ── OAuth (Authorization Code + PKCE) for the staff user ────────────────────────

export function beginAuthorization(): { url: string; state: string; codeVerifier: string } {
  const pkce = generatePkce();
  const state = randomBytes(16).toString("base64url");
  const url = createAuthorizationUrl({
    clientId: env.clientId,
    redirectUri: env.redirectUri,
    scopes: env.userScopes,
    state,
    pkce,
    oauthBaseUrl: env.oauthBase,
  });
  return { url, state, codeVerifier: pkce.codeVerifier };
}

export function exchangeCode(code: string, codeVerifier: string): Promise<TokenSet> {
  return sdkExchangeCode({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    redirectUri: env.redirectUri,
    code,
    codeVerifier,
    oauthBaseUrl: env.oauthBase,
  });
}

// ── Installations (guide, Steps 2 and 3) ────────────────────────────────────────

export function me(wf: Wefunder) {
  return wf.users.me();
}

export function eligible(wf: Wefunder) {
  return wf.installations.eligibleTargets({ target_type: "company" });
}

export async function listInstallations(wf: Wefunder) {
  return (await wf.installations.list()).data ?? [];
}

// Install the app on a company and receive the company-owned token: the credential this
// integration keeps for that company. The token is shown once. `data.attributes.scopes` is
// what was GRANTED (requested ∩ what the app holds), which can be less than `scopes`.
// `installOrMintToken` covers the race where a colleague installed between our `eligible` call
// and this one: on 409 already_installed it mints a token for the existing install instead.
export function install(wf: Wefunder, companyId: string, scopes: string[]) {
  return wf.installations.installOrMintToken({ target_type: "company", target_id: companyId, scopes });
}

// An install exists (a founder used the link, a colleague installed, or a crash lost the token):
// mint the company-owned token for it. `token.scope` is the credential's effective grant.
export function mintToken(wf: Wefunder, installationId: string) {
  return wf.installations.mintToken(installationId);
}

export function revoke(wf: Wefunder, installationId: string) {
  return wf.installations.revoke(installationId);
}

// ── Investment sync (guide, Step 4), per installed company ──────────────────────
//
// list:   wf.investments.list({ per_page })          → every record, pages via meta.next_cursor
// sync:   wf.investments.list({ cursor })            → only records changed since that cursor
// 410:    the position predates pruned changes       → list again and REPLACE every record held
//
// A record with visible:false and nothing else is a tombstone: delete your copy.
// investor.deactivated:true means the account was deactivated: overwrite your copy (identity
// fields are redacted); the row's reason is "investor_deactivated".

export type SyncTarget = { records: Record<string, InvestmentRecord>; sync: CompanyState["sync"] };
export type SyncResult = { mode: "bootstrap" | "delta"; pages: number; upserted: number; tombstoned: number; re_bootstrapped: boolean };
export type SyncHooks = {
  journal?: (line: string) => void;
  // Called for every applied record with the copy held BEFORE the change (null if none). This is
  // where the notification outbox decides what a human should hear about (lib/notify.ts).
  onChange?: (held: InvestmentRecord | null, record: InvestmentRecord) => void;
};

export const isTombstone = (r: InvestmentRecord) => r.visible === false && r.status === undefined;

export async function sync(target: SyncTarget, wf: Wefunder, hooks: SyncHooks = {}): Promise<SyncResult> {
  let cursor = target.sync.cursor;
  let mode: "bootstrap" | "delta" = cursor ? "delta" : "bootstrap";
  let reBootstrapped = false;
  let pages = 0, upserted = 0, tombstoned = 0;

  const applyPage = (records: InvestmentRecord[]) => {
    for (const r of records) {
      const held = target.records[r.id] ?? null;
      if (isTombstone(r)) {
        if (held) tombstoned++;
        delete target.records[r.id];
      } else {
        target.records[r.id] = r;
        upserted++;
      }
      hooks.onChange?.(held, r);
    }
  };

  for (;;) {
    let page: Awaited<ReturnType<Wefunder["investments"]["list"]>>;
    try {
      page = await wf.investments.list({ per_page: 100, ...(cursor ? { cursor } : {}) });
    } catch (e) {
      if (e instanceof WefunderError && e.status === 410 && cursor) {
        // Our position predates changes Wefunder has pruned (about 90 days). List again from
        // scratch and REPLACE: records absent from the fresh listing are gone, and only the
        // API-managed set is replaced, never anything else a CRM holds beside it.
        hooks.journal?.(`410 on cursor: position predates retention; re-listing and replacing ${Object.keys(target.records).length} records`);
        target.records = {};
        cursor = null;
        mode = "bootstrap";
        reBootstrapped = true;
        continue;
      }
      throw e;
    }
    pages++;
    const meta = page.meta ?? {};
    if (meta.mode === "bootstrap") {
      if (pages === 1 && !reBootstrapped) target.records = {};
      if (pages === 1) target.sync.bootstraps += 1;
    }
    applyPage((page.data ?? []) as InvestmentRecord[]);
    if (typeof meta.next_cursor === "string" && meta.next_cursor) cursor = meta.next_cursor; // always present; store it even when has_more is false
    if (typeof meta.published_through === "string") target.sync.published_through = meta.published_through;
    if (!meta.has_more) break;
  }

  target.sync.cursor = cursor;
  target.sync.last_synced_at = new Date().toISOString();
  hooks.journal?.(`${mode} sync: ${pages} page(s), ${upserted} upserted, ${tombstoned} tombstoned; holding ${Object.keys(target.records).length}`);
  return { mode, pages, upserted, tombstoned, re_bootstrapped: reBootstrapped };
}

// Retrieve one investment: always the CURRENT state, never the published copy.
export function retrieve(wf: Wefunder, id: string) {
  return wf.investments.get(id);
}

export function offeringStats(wf: Wefunder, offeringId: string) {
  return wf.offerings.stats(offeringId);
}

export { WefunderError };
