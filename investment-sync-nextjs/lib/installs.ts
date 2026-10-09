// Turning installs into company state (guide, Steps 2 and 3). Three arrivals converge here:
//   - the connected staff user installs from the dashboard (POST /installations → install + token)
//   - a founder installs through the link; Wefunder hits the setup URL with the installation_id
//     and we mint the token for it (POST /installations/{id}/tokens) with the staff user
//   - "Discover" adopts installs made elsewhere (a colleague, the portal) the same way
import type { Wefunder, TokenSet } from "@wefunder/sdk";
import { WefunderAuthError, WefunderTokenPersistenceError } from "@wefunder/sdk";
import { env, PII_SCOPE } from "./env.ts";
import { WefunderError, companyClient, eligible, install as apiInstall, listInstallations, mintToken, sync, userClient, type Fetch } from "./wefunder.ts";
import { enqueue } from "./notify.ts";
import { emptySync, load, log, save, withLock, type CompanyState, type State } from "./store.ts";

type Installation = NonNullable<Awaited<ReturnType<typeof listInstallations>>[number]>;
type Minted = Awaited<ReturnType<typeof mintToken>>["token"];

// Thrown when the staff user's Wefunder session can no longer be refreshed; the dashboard turns
// it into a "reconnect" prompt instead of a raw token-endpoint error.
export class SessionExpired extends Error {
  constructor(detail: string) { super(`Wefunder session expired; reconnect. (${detail})`); }
}

// The SDK client for the connected staff user. Every refreshed token set is persisted BEFORE the
// request that needed it continues: refresh tokens rotate, and a crash between refresh and save
// would leave us holding a dead grant.
export function staffClient(s: State): Wefunder {
  if (!s.user) throw new Error("no connected user — connect first");
  const user = s.user;
  return userClient(user.tokens, {
    save: async (tokens: TokenSet) => { user.tokens = tokens; await save(s); },
  });
}

// Normalize the SDK's auth failures into SessionExpired for the UI, and persist the dead grant so
// the dashboard stops retrying a refresh token that will never work again.
export async function withStaff<T>(s: State, fn: (wf: Wefunder) => Promise<T>): Promise<T> {
  try {
    return await fn(staffClient(s));
  } catch (e) {
    if (e instanceof WefunderTokenPersistenceError) throw e;
    const invalidGrant = e instanceof WefunderAuthError || (e instanceof Error && /invalid_grant/.test(e.message));
    if (invalidGrant && s.user) {
      s.user.tokens = { accessToken: s.user.tokens.accessToken, scope: s.user.tokens.scope, expiresAt: 0 };
      await save(s);
      throw new SessionExpired((e as Error).message);
    }
    throw e;
  }
}

// Both install paths end with the same facts saved together: the install id, the token, and the
// scopes that were GRANTED. The server grants requested ∩ app-held and drops the rest without an
// error, so the identity flag is read from the response, never assumed from what we asked for.
export function upsertCompany(s: State, installation: Installation, minted: Minted | null): CompanyState {
  const a = installation.attributes ?? {};
  const target = a.target ?? {};
  const id = target.id ?? "";
  const existing = s.companies[id];
  const grantedScopes = minted?.scope ? minted.scope.split(" ").filter(Boolean) : (a.scopes ?? existing?.scopes ?? []);
  const company: CompanyState = {
    id,
    name: target.name ?? existing?.name ?? id,
    installation_id: installation.id ?? existing?.installation_id ?? "",
    tier: a.tier ?? existing?.tier ?? "",
    scopes: grantedScopes,
    identity: grantedScopes.includes(PII_SCOPE),
    token: minted?.access_token ? { accessToken: minted.access_token, scope: minted.scope ?? "" } : existing?.token ?? null,
    disconnected: null,                              // a fresh install or mint means we are connected again
    sync: existing?.sync ?? emptySync(),
    records: existing?.records ?? {},
    installed_at: a.installed_at ?? existing?.installed_at ?? new Date().toISOString(),
  };
  s.companies[id] = company;
  if (env.installScopes.includes(PII_SCOPE) && !company.identity) {
    // The guide says stop here and fix the app's scopes before importing. The example keeps the
    // company so the dashboard can show the problem; syncing it yields records with no identity.
    log(s, `${company.name}: the install carries no ${PII_SCOPE} (granted: ${grantedScopes.join(" ") || "nothing"}). Add the scope to the app in the portal, then revoke and install again.`);
  }
  return company;
}

export async function installCompany(s: State, companyId: string): Promise<CompanyState> {
  const known = s.companies[companyId];
  if (known?.disconnected) throw new Error(`${known.name} was disconnected by its founder; clear that first (Reconnect) rather than reinstalling over their decision`);
  return withStaff(s, async (wf) => {
    const res = await apiInstall(wf, companyId, env.installScopes);
    if (!res.data) throw new Error("install returned no installation");
    const company = upsertCompany(s, res.data, res.token ?? null);
    log(s, `installed on ${company.name} (${company.installation_id}, tier ${company.tier}, granted ${company.scopes.join(" ")}); company token stored`);
    return company;
  });
}

// Installs we learned about from the setup URL but could not mint for yet.
export async function adoptPendingInstalls(s: State) {
  if (!s.user || s.pending_installs.length === 0) return;
  await withStaff(s, async (wf) => {
    const known = new Map((await listInstallations(wf)).map((i) => [i.id, i]));
    const left: State["pending_installs"] = [];
    for (const p of s.pending_installs) {
      const installation = known.get(p.installation_id);
      if (!installation || installation.attributes?.status !== "active") { log(s, `install ${p.installation_id}: not visible or not active; dropping`); continue; }
      try {
        const res = await mintToken(wf, p.installation_id);
        const company = upsertCompany(s, res.data ?? installation, res.token ?? null);
        log(s, `minted a company token for ${company.name} (founder-link install ${p.installation_id})`);
      } catch (e) {
        log(s, `could not mint for ${p.installation_id}: ${(e as Error).message}`);
        left.push(p);
      }
    }
    s.pending_installs = left;
  });
}

// Adopt active installs of this app that we hold no token for: founder-link installs whose setup
// callback was missed, installs a colleague made in the portal. A company a founder disconnected
// is skipped on purpose: `eligible` lists it again with installed:false immediately (removing the
// app does not remove our staff from the team), and reinstalling on that signal would override
// the founder's decision.
export async function discoverInstalls(s: State): Promise<{ adopted: string[]; listed: number }> {
  return withStaff(s, async (wf) => {
    const all = await listInstallations(wf);
    const adopted: string[] = [];
    for (const inst of all) {
      const a = inst.attributes ?? {};
      const targetId = a.target?.id ?? "";
      const known = s.companies[targetId];
      if (a.status !== "active" || a.target?.type !== "company") continue;
      if (known?.disconnected) continue;
      if (known?.token && known.installation_id === inst.id) continue;
      try {
        const res = await mintToken(wf, inst.id ?? "");
        const company = upsertCompany(s, res.data ?? inst, res.token ?? null);
        adopted.push(company.name);
        log(s, `discovered install ${inst.id} on ${company.name}; company token minted`);
      } catch (e) {
        log(s, `could not adopt ${inst.id}: ${(e as Error).message}`);
      }
    }
    return { adopted, listed: all.length };
  });
}

// Sync one installed company with its own token, one sync per company at a time (guide, Step 4).
// The company lock is held from reading the cursor to saving the new one: a second sync of the
// same company waits (up to 30s, then LockBusy) and starts from the cursor the first one saved.
// A 401 means the founder removed the app (or Wefunder withdrew the app's PII approval): mark it,
// stop, and leave the decision to a human.
export async function syncCompany(s: State, company: CompanyState, f?: Fetch) {
  return withLock(`company:${company.id}`, async () => {
    // `s` was loaded before we waited for the lock; a sync that finished meanwhile moved this
    // company's cursor on. Read it again now, or this run replays from the old position.
    // Only the lock-owned fields are refreshed: the token and the disconnected flag in `s` may be
    // newer than the stored ones (an install or re-mint this request has not saved yet).
    const current = (await load()).companies[company.id];
    if (current && current.installation_id === company.installation_id && (current.sync.generation ?? 0) > (company.sync.generation ?? 0)) {
      company.sync = current.sync;
      company.records = current.records;
    }
    if (company.disconnected) throw new Error(`${company.name} is disconnected (${company.disconnected.reason}); not syncing`);
    const token = company.token;
    if (!token) throw new Error(`no token for ${company.name} — mint one first`);
    try {
      const result = await sync(company, companyClient(token, f), {
        journal: (line) => log(s, `${company.name}: ${line}`),
        onChange: (held, record) => enqueue(s, company.id, held, record),
      });
      company.sync.generation = (company.sync.generation ?? 0) + 1;
      await save(s);                                   // records, cursor and outbox lines, before the lock is released
      return result;
    } catch (e) {
      if (e instanceof WefunderError && e.status === 401) {
        company.disconnected = { at: new Date().toISOString(), reason: e.message || "401 from the company token" };
        log(s, `${company.name}: company token refused (401). A founder removed the app, or its PII approval was withdrawn. Marked disconnected; nothing will reinstall on its own.`);
        await save(s);
      }
      throw e;
    }
  });
}

// The staff user's view of what they could install on, for the dashboard.
export async function eligibleCompanies(s: State) {
  return withStaff(s, (wf) => eligible(wf));
}
