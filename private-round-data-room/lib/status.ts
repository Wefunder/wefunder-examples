// Keeping each user's state current by polling, inside one token's rate limit.
//
// Every data-room user's request is made with the SAME company token, and a token gets 1,000
// requests an hour. So nothing here asks Wefunder on every page view:
//
//   - raise totals are read at most once a minute for everyone together;
//   - a user's link or session is read at most once a minute, only after they clicked (there is
//     an id to read), and never again once it has settled (invested / completed / canceled ...);
//   - nothing in this file creates anything. Links and sessions are minted on a click, in the
//     two routes under app/api/invest/.
//
// WHERE A WEBHOOK SLOTS IN. Member links have no webhook today, so polling is the only way to
// learn that one was used. When `member_link.bound` / `member_link.invested` events ship, a
// signed receiver calls `recordLink` with the link from the event and the poll below becomes the
// fallback. Investment sessions already have `investment_session.completed`, `.canceled` and
// `.expired` (beta); a receiver for those calls `recordSession` the same way. Receiving and
// verifying deliveries is covered at https://docs.wefunder.com/guides/handling-webhooks.
import { summarize, type Raise } from "./raise.ts";
import { linkSettled, sessionSettled } from "./states.ts";
import { recordFor, update, type UserRecord } from "./store.ts";
import { getCheckoutSession, getMemberLink, raiseStats, type CheckoutSessionView, type Deps, type MemberLinkView } from "./wefunder.ts";

export const RAISE_TTL_MS = 60_000;
export const USER_TTL_MS = 60_000;
// A "check now" (the investor just came back from checkout) may skip the minute, but not this.
export const FORCE_FLOOR_MS = 5_000;

export type Clock = { now?: () => number };

// ── Raise totals, shared by every user ──────────────────────────────────────────────────────

type Cached = { at: number; raise: Raise };
const raises = new Map<string, Cached>();

// The last totals read, re-read once they are a minute old. If Wefunder cannot be reached the
// last totals are served with `stale: true`; with none yet, `raise` is null and the page says so.
export async function cachedRaise(offeringId: string, deps: Deps & Clock): Promise<{ raise: Raise | null; stale: boolean; error?: unknown }> {
  const now = (deps.now ?? Date.now)();
  const hit = raises.get(offeringId);
  if (hit && now - hit.at < RAISE_TTL_MS) return { raise: hit.raise, stale: false };
  try {
    const raise = summarize(await raiseStats(offeringId, { ...deps, maxRetries: 0 }));
    raises.set(offeringId, { at: now, raise });
    return { raise, stale: false };
  } catch (error) {
    return { raise: hit?.raise ?? null, stale: true, error };
  }
}

export const forgetRaises = () => raises.clear(); // tests

// ── One user's link and session ─────────────────────────────────────────────────────────────

export type UserStatus = {
  record: UserRecord;
  // True while something may still change, so the page keeps asking this app (not Wefunder).
  watching: boolean;
  error?: unknown;
};

const due = (checkedAt: number | undefined, now: number, force: boolean) => {
  const age = now - (checkedAt ?? 0);
  return force ? age >= FORCE_FLOOR_MS : age >= USER_TTL_MS;
};

export async function userStatus(offeringId: string, userId: string, deps: Deps & Clock & { force?: boolean }): Promise<UserStatus> {
  const now = (deps.now ?? Date.now)();
  const force = deps.force ?? false;
  const once: Deps = { ...deps, maxRetries: 0 };
  let record = await recordFor(offeringId, userId);
  let error: unknown;

  if (record.linkId && !linkSettled(record.linkState) && due(record.linkCheckedAt, now, force)) {
    try {
      record = await recordLink(offeringId, userId, await getMemberLink(record.linkId, once), now);
    } catch (e) {
      error = e; // keep the last state we read; the next poll tries again
    }
  }
  if (record.sessionId && !sessionSettled(record.sessionStatus) && due(record.sessionCheckedAt, now, force)) {
    try {
      record = await recordSession(offeringId, userId, await getCheckoutSession(record.sessionId, once), now);
    } catch (e) {
      error = e;
    }
  }

  const watching = Boolean((record.linkId && !linkSettled(record.linkState)) || (record.sessionId && !sessionSettled(record.sessionStatus)));
  return { record, watching, error };
}

// Save what Wefunder said about a user's member link: after a mint, after a poll, and (once the
// events exist) from a webhook receiver.
export function recordLink(offeringId: string, userId: string, link: MemberLinkView, now: number = Date.now()): Promise<UserRecord> {
  return update(offeringId, userId, {
    linkId: link.id,
    linkState: link.state,
    linkCheckedAt: now,
    wefunderUserId: link.wefunderUserId,
    investmentId: link.investmentId,
  });
}

// The same for an investment session.
export function recordSession(offeringId: string, userId: string, session: CheckoutSessionView, now: number = Date.now()): Promise<UserRecord> {
  return update(offeringId, userId, {
    sessionId: session.id,
    sessionStatus: session.status,
    sessionCheckedAt: now,
    sessionInvestmentId: session.investmentId,
  });
}
