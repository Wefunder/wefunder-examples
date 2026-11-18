// What each Wefunder state means to a data-room user. Pure, shared by the server-rendered page
// and the polling panel, tested in plain Node.
import type { LinkState, SessionStatus } from "./wefunder.ts";

export type Tone = "neutral" | "info" | "success" | "warn";
export type Shown = { label: string; tone: Tone };

// A member link's `state`, derived live by Wefunder on every read.
//   created   nobody has invested through it yet (opening the page does not change it)
//   bound     a Wefunder account holds it
//   invested  that account invested in this round after the link was minted
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
    case "completed": return { label: "Investment complete", tone: "success" };
    case "in_progress": return { label: "Checkout in progress", tone: "info" };
    case "pending": return { label: "Checkout not opened yet", tone: "neutral" };
    case "abandoned": return { label: "Checkout left unfinished", tone: "warn" };
    case "expired": return { label: "Checkout link expired", tone: "warn" };
    case "canceled": return { label: "Checkout canceled", tone: "warn" };
    default: return { label: "Not started", tone: "neutral" };
  }
}

export function sessionButton(status: SessionStatus | null | undefined): string {
  if (status === "completed") return "Invest again at checkout";
  if (status === "pending" || status === "in_progress" || status === "abandoned") return "Continue checkout";
  return "Go straight to checkout";
}

// Nothing more will happen to these without a new click, so the app stops asking Wefunder.
export const linkSettled = (state: LinkState | null | undefined) => state === "invested" || state === "canceled";
export const sessionSettled = (status: SessionStatus | null | undefined) => status === "completed" || status === "expired" || status === "canceled";
