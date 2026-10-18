// Everything the app asks the companion server (`../server`). The Wefunder install token lives
// there and never reaches the phone; the app only ever talks to its own backend.
const BASE = (process.env.EXPO_PUBLIC_SERVER_URL ?? "http://localhost:4181").replace(/\/$/, "");

export type OfferingSummary = { id: string; company_name: string; tagline: string | null; logo_url: string | null };
export type MintedSession = { id: string; url: string };
export type SessionStatus = { id: string; status: string; investment_id: string | null };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = (await res.json().catch(() => ({}))) as { error?: { type?: string; message?: string } } & T;
  if (!res.ok) throw new Error(body.error?.message ?? `${path} failed with ${res.status}`);
  return body;
}

export const listOfferings = () => call<OfferingSummary[]>("/offerings");

export const mintSession = (offeringId: string, email: string) =>
  call<MintedSession>("/sessions", { method: "POST", body: JSON.stringify({ offering_id: offeringId, email }) });

export const getSession = (id: string) => call<SessionStatus>(`/sessions/${encodeURIComponent(id)}`);
