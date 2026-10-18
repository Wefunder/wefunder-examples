// The three routes the app calls, as a pure function of (method, path, body) so they can be
// tested without binding a port. `server.ts` wraps this in `node:http`.
//
// There is no authentication on this server. A production backend authenticates its own app
// user, takes the investor's email (or `wefunder_user_id`) from that account rather than the
// request body, and never lets a caller mint sessions for arbitrary addresses.
import { WefunderError } from "@wefunder/sdk";
import { mintSession, offeringSummaries, sessionStatus, type MintDeps } from "./mint.ts";

export type Reply = { status: number; body: unknown };

export type AppDeps = MintDeps & { offeringIds: string[] };

const error = (status: number, type: string, message: string): Reply => ({ status, body: { error: { type, message } } });

export async function handle(method: string, path: string, body: unknown, deps: AppDeps): Promise<Reply> {
  try {
    if (method === "GET" && path === "/offerings") {
      return { status: 200, body: await offeringSummaries(deps.offeringIds, deps) };
    }
    if (method === "POST" && path === "/sessions") {
      const b = (body ?? {}) as { offering_id?: unknown; email?: unknown };
      if (typeof b.offering_id !== "string" || !deps.offeringIds.includes(b.offering_id)) {
        return error(422, "unknown_offering", "offering_id must be one of the configured offerings");
      }
      if (typeof b.email !== "string" || !b.email.includes("@")) return error(422, "invalid_email", "email is required");
      return { status: 201, body: await mintSession({ offeringId: b.offering_id, email: b.email }, deps) };
    }
    const m = method === "GET" ? path.match(/^\/sessions\/([^/]+)$/) : null;
    if (m) return { status: 200, body: await sessionStatus(decodeURIComponent(m[1]), deps) };
    return error(404, "not_found", `no route for ${method} ${path}`);
  } catch (e) {
    // A Wefunder refusal (422 for a return URL the app did not register, 403 for a missing
    // scope, 409 session_conflict…) is passed through with its type so the phone can show it.
    if (e instanceof WefunderError) return error(e.status, e.type, e.message);
    throw e;
  }
}
