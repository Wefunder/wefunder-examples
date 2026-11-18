// Wefunder's error → a short key → a fixed sentence. A failed click redirects back to the page
// with only the key in the URL, and the page prints the sentence for that key, so a crafted URL
// cannot put its own text on the data room. Wefunder's full message and request id go to the
// server log (never the token).
import { WefunderError } from "@wefunder/sdk";

export const MESSAGES = {
  not_open: "This round isn't open for investment on Wefunder yet. Check back once it opens.",
  no_page: "This company's Wefunder page isn't published yet, so there is nowhere to send you.",
  not_covered: "This data room is not connected to that round. (Operator: check WEFUNDER_OFFERING_ID, and that the app is installed on the company that runs it.)",
  not_allowed: "This data room's Wefunder connection was refused. (Operator: check the installation token, that the install is still active, and that it carries the scopes in .env.example.)",
  session_conflict: "You already have a checkout in progress for this round that was started somewhere else. Finish that one, or use the Invest on Wefunder button.",
  return_url: "Checkout could not be started. (Operator: DATA_ROOM_URL must be on the origin of one of the app's registered redirect URIs.)",
  invalid: "Wefunder did not accept that request. (Operator: see the server log for the reason.)",
  busy: "Wefunder is rate-limiting this data room. Try again in a minute.",
  unknown: "Something went wrong reaching Wefunder. Try again in a minute.",
} as const;

export type ErrorKey = keyof typeof MESSAGES;

export const isErrorKey = (v: unknown): v is ErrorKey => typeof v === "string" && Object.hasOwn(MESSAGES, v);

export function errorKey(e: unknown, call: "member_link" | "investment_session"): ErrorKey {
  if (!(e instanceof WefunderError)) return "unknown";
  if (e.status === 422 && e.type === "offering_not_open") return "not_open";
  if (e.status === 422 && e.type === "offering_has_no_page") return "no_page";
  if (e.status === 409 && call === "investment_session") return "session_conflict";
  if (e.status === 422 && call === "investment_session" && e.type === "validation_error") return "return_url";
  if (e.status === 422) return "invalid";
  if (e.status === 404) return "not_covered";
  if (e.status === 401 || e.status === 403) return "not_allowed";
  if (e.status === 429) return "busy";
  return "unknown";
}

// For the server log: enough to find the request with Wefunder support, nothing secret.
export function describe(e: unknown): string {
  if (e instanceof WefunderError) return `${e.status} ${e.type}: ${e.message}${e.requestId ? ` (request ${e.requestId})` : ""}`;
  return e instanceof Error ? e.message : String(e);
}
