// Everything this example calls on Wefunder, through the official SDK (`@wefunder/sdk` 1.1.0 or
// newer, which has `wf.offerings.stats`, `wf.memberLinks` and `wf.investmentSessions`). One
// function per call, so the guide (https://docs.wefunder.com/guides/private-round-data-room) and
// the code can be read side by side. Nothing here touches `wf.raw`.
//
// Every call is made with the COMPANY-OWNED installation token: your app acting as your company.
// It is passed in (`deps.token`) rather than read from the environment so these functions run in
// tests with an injected fetch, and so the only module that reads the token is lib/env.ts.
import { Wefunder, type InvestmentSession, type MemberLink, type OfferingStats } from "@wefunder/sdk";

export type Fetch = typeof fetch;
// `maxRetries: 0` turns off the SDK's retry-with-backoff. The polling reads use it: they have a
// last-known answer to show and another try a minute later, so a page should not wait on them.
export type Deps = { token: string; apiBase?: string; fetch?: Fetch; maxRetries?: number };

const client = (d: Deps) =>
  new Wefunder({ accessToken: d.token, baseUrl: d.apiBase, fetch: d.fetch, retry: d.maxRetries === undefined ? undefined : { maxRetries: d.maxRetries } });

// ── Raise totals ────────────────────────────────────────────────────────────────────────────

// GET /offerings/{id}/stats (read:investments). The sums over the investment records your
// company can list for this round, by status. It answers for a private round because the token
// is the company's own; the public raise widget cannot see a private round at all.
export function raiseStats(offeringId: string, d: Deps): Promise<OfferingStats> {
  return client(d).offerings.stats(offeringId);
}

// ── Flavor 1: member links (generally available) ────────────────────────────────────────────

export type LinkState = "created" | "bound" | "invested" | "canceled";

export type MemberLinkView = {
  id: string;
  url: string;
  state: LinkState;
  reference: string | null;
  wefunderUserId: string | null;
  investmentId: string | null;
};

function linkView(l: MemberLink): MemberLinkView {
  const a = l.attributes;
  if (!l.id || !a?.url || !a.state) throw new Error("Wefunder returned a member link without an id, url or state");
  return { id: l.id, url: a.url, state: a.state, reference: a.reference ?? null, wefunderUserId: a.wefunder_user_id ?? null, investmentId: a.investment_id ?? null };
}

// POST /offerings/{id}/member_links (write:invite_links) with `reference` = YOUR user id.
// Repeating a reference on the same offering returns that user's live link (200) instead of
// minting a second one (201), so this is safe to call on every click and needs no lock.
// The link opens the round's page on Wefunder with the private round visible, and binds to the
// first Wefunder account that invests through it. No email is sent to Wefunder.
export async function mintMemberLink(offeringId: string, userId: string, d: Deps): Promise<MemberLinkView> {
  return linkView(await client(d).memberLinks.create(offeringId, { reference: userId }));
}

// GET /member_links/{id} (read:invite_links). `state` is derived live on every read.
export async function getMemberLink(id: string, d: Deps): Promise<MemberLinkView> {
  return linkView(await client(d).memberLinks.get(id));
}

// GET /offerings/{id}/member_links, every page. One request per page for the whole round, which
// is why the founder's table uses this instead of one GET per user.
export async function listMemberLinks(offeringId: string, d: Deps): Promise<MemberLinkView[]> {
  const out: MemberLinkView[] = [];
  for await (const l of client(d).memberLinks.all(offeringId)) out.push(linkView(l));
  return out;
}

// ── Flavor 2: investment sessions (beta) ────────────────────────────────────────────────────

export type SessionStatus = "pending" | "in_progress" | "completed" | "abandoned" | "expired" | "canceled";

export type CheckoutSessionView = {
  id: string;
  url: string;
  status: SessionStatus;
  email: string | null;
  investmentId: string | null;
};

function sessionView(s: InvestmentSession): CheckoutSessionView {
  const a = s.attributes;
  if (!s.id || !a?.url || !a.status) throw new Error("Wefunder returned an investment session without an id, url or status");
  return { id: s.id, url: a.url, status: a.status, email: a.email ?? null, investmentId: a.investment_id ?? null };
}

export type CheckoutSessionInput = { email: string; successUrl: string; cancelUrl: string; idempotencyKey?: string };

// POST /offerings/{id}/investment_sessions (write:investment_sessions). A single-use hosted
// checkout for one known email. If that email already has an active session on the offering,
// Wefunder returns it instead of creating a second. `success_url` and `cancel_url` must be on
// the origin of one of your app's registered redirect URIs.
export async function createCheckoutSession(offeringId: string, input: CheckoutSessionInput, d: Deps): Promise<CheckoutSessionView> {
  const session = await client(d).investmentSessions.create(
    offeringId,
    { email: input.email, success_url: input.successUrl, cancel_url: input.cancelUrl },
    { idempotencyKey: input.idempotencyKey },
  );
  return sessionView(session);
}

// GET /investment_sessions/{id} (read:investment_sessions).
export async function getCheckoutSession(id: string, d: Deps): Promise<CheckoutSessionView> {
  return sessionView(await client(d).investmentSessions.get(id));
}

// GET /offerings/{id}/investment_sessions, every page: the sessions YOUR app created on the round.
export async function listCheckoutSessions(offeringId: string, d: Deps): Promise<CheckoutSessionView[]> {
  const out: CheckoutSessionView[] = [];
  for await (const s of client(d).investmentSessions.allForOffering(offeringId)) out.push(sessionView(s));
  return out;
}
