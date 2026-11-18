// What each Wefunder state means to a data-room user. Pure, shared by the server-rendered page
// and the polling panel, tested in plain Node.
import type { LinkState, SessionStatus } from "./wefunder.ts";

export type Tone = "neutral" | "info" | "success" | "warn";
export type Shown = { label: string; tone: Tone };

// A member link's `state`, derived live by Wefunder on every read.
//   created   nobody has invested through it yet (opening the page does not change it)
//   bound     a Wefunder account holds it, with no active investment through it right now
//   invested  that account has an active investment in this round, made after the link was
//             minted. Not final: if the investment is canceled the link reads `bound` again
//   canceled  you canceled it before any investment; the next click mints a fresh one
export function linkShown(state: LinkState | null | undefined): Shown {
  switch (state) {
    case "invested": return { label: "Invested on Wefunder", tone: "success" };
    case "bound": return { label: "Started on Wefunder", tone: "info" };
    case "created": return { label: "Link ready, no investment yet", tone: "neutral" };
    case "canceled": return { label: "Link canceled", tone: "warn" };
    default: return { label: "Not started", tone: "neutral" };
  }
}

export function linkButton(state: LinkState | null | undefined): string {
  if (state === "invested") return "View your investment on Wefunder";
  if (state === "bound") return "Continue on Wefunder";
  return "Invest on Wefunder";
}

export function sessionShown(status: SessionStatus | null | undefined): Shown {
  switch (status) {
    case "completed": return { label: "Checkout finished", tone: "success" };
    case "in_progress": return { label: "Checkout in progress", tone: "info" };
    case "pending": return { label: "Checkout not opened yet", tone: "neutral" };
    case "abandoned": return { label: "Checkout left unfinished", tone: "warn" };
    case "expired": return { label: "Checkout link expired", tone: "warn" };
    case "canceled": return { label: "Checkout canceled", tone: "warn" };
    default: return { label: "Not started", tone: "neutral" };
  }
}

// A session is ACTIVE while it is pending or in_progress (and unexpired): pressing the button
// again gets the same one back. Anything else, `abandoned` included, is not active, so the next
// press creates a new session.
export function sessionButton(status: SessionStatus | null | undefined): string {
  if (status === "completed") return "Invest again at checkout";
  if (status === "pending" || status === "in_progress") return "Continue checkout";
  return "Go straight to checkout";
}

// Settled: the page stops asking every few seconds. A canceled link and a session that is no
// longer active are not read again. An invested link can change (see above), so lib/status.ts
// still re-reads it now and then.
//
// "Settled" is about polling, not money. `invested` and `completed` mean an investment EXISTS.
// Neither says the payment has arrived or, on a 506(c) round, that accreditation has been
// verified: that is on the investment record (GET /investments/{id}: status, amounts, blockers).
export const linkSettled = (state: LinkState | null | undefined) => state === "invested" || state === "canceled";
export const sessionSettled = (status: SessionStatus | null | undefined) => status === "completed" || status === "abandoned" || status === "expired" || status === "canceled";
