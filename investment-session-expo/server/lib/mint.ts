// The one call this example makes that needs the install token: minting a hosted investment
// session. Through the official SDK (`@wefunder/sdk` 1.1.0 or newer, which added
// `wf.investmentSessions`): `create(offeringId, input)` is
// `POST /offerings/{id}/investment_sessions` with `{ investment_session: input }` and sends the
// `Idempotency-Key` header, the same request the guide shows with curl
// (https://docs.wefunder.com/guides/investment-sessions-mobile, "Your backend mints the session").
import { Wefunder, WefunderError } from "@wefunder/sdk";
import { randomUUID } from "node:crypto";

export type Fetch = typeof fetch;

export type MintDeps = {
  token: string;
  returnUrl: string;
  apiBase?: string;
  fetch?: Fetch;
  idempotencyKey?: () => string;
};

export type MintRequest = { offeringId: string; email: string };
export type Minted = { id: string; url: string };
export type SessionStatus = { id: string; status: string; investment_id: string | null };

export const client = (d: { token: string; apiBase?: string; fetch?: Fetch }) =>
  new Wefunder({ accessToken: d.token, baseUrl: d.apiBase, fetch: d.fetch });

// Both return URLs point at one place and differ by `result=`, because ASWebAuthenticationSession
// watches a single scheme. Wefunder appends `session_id` and `reason` to the cancel one.
export function returnUrls(base: string): { success_url: string; cancel_url: string } {
  return { success_url: `${base}?result=success`, cancel_url: `${base}?result=cancel` };
}

export async function mintSession(req: MintRequest, deps: MintDeps): Promise<Minted> {
  const wf = client(deps);
  const session = await wf.investmentSessions.create(
    req.offeringId,
    { email: req.email, ...returnUrls(deps.returnUrl) },
    // A fresh key per request: if the phone retries (the first reply was lost in flight) the
    // app's second POST mints or returns the recipient's existing active session anyway, so a
    // stable key is not needed for correctness here. A production backend keys on its own
    // checkout attempt id so a retried request replays the same response.
    { idempotencyKey: (deps.idempotencyKey ?? randomUUID)() },
  );
  const url = session.attributes?.url;
  if (!session.id || !url) throw new Error("Wefunder returned a session without an id or url");
  return { id: session.id, url };
}

export async function sessionStatus(id: string, deps: MintDeps): Promise<SessionStatus> {
  const s = await client(deps).investmentSessions.get(id);
  return { id: s.id ?? id, status: String(s.attributes?.status ?? "unknown"), investment_id: s.attributes?.investment_id ?? null };
}

// What the app shows per offering. `GET /offerings/{id}` needs read:public (or read:explore); an
// install token without it still mints, so a failed lookup degrades to the bare id rather than
// hiding the offering.
export type OfferingSummary = { id: string; company_name: string; tagline: string | null; logo_url: string | null };

export async function offeringSummaries(ids: string[], deps: MintDeps): Promise<OfferingSummary[]> {
  const wf = client(deps);
  return Promise.all(
    ids.map(async (id) => {
      try {
        const o = await wf.offerings.get(id);
        return { id, company_name: o.attributes?.company_name ?? id, tagline: o.attributes?.tagline ?? null, logo_url: o.attributes?.logo_url ?? null };
      } catch (e) {
        if (e instanceof WefunderError) return { id, company_name: id, tagline: null, logo_url: null };
        throw e;
      }
    }),
  );
}
