// Every setting the example needs, read once. A missing token fails loudly at the first API call
// rather than producing a confusing 401 from Wefunder.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — copy .env.example to .env.local and fill it in`);
  return v;
}

// `||`, not `??`: a variable that exists but is EMPTY (easy to do in a hosting dashboard) must
// fall back too.
const optional = (name: string) => process.env[name] || undefined;

export const DEFAULT_API_BASE = "https://wefunder.com/api/v2";

export type OfferingConfig = { id: string; label: string };

// "ofr_abc123=Arc Hockey ofr_def456" → [{ id: "ofr_abc123", label: "Arc Hockey" }, { id: "ofr_def456", label: "ofr_def456" }].
// Labels are display-only; the API is only ever given the id. Separated by commas or whitespace,
// so a label cannot contain either (use `_` or `-`; underscores render as spaces).
export function parseOfferings(raw: string | undefined): OfferingConfig[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((entry) => {
      const [id, label] = entry.split("=");
      return { id, label: label ? label.replace(/_/g, " ") : id };
    });
}

export const env = {
  // A syndicate- or company-owned install token (at_live_…) with read:invite_links and
  // write:invite_links. Server-only: never prefix it NEXT_PUBLIC_.
  get accessToken() { return required("WEFUNDER_ACCESS_TOKEN"); },

  get offerings() { return parseOfferings(process.env.WEFUNDER_OFFERING_IDS); },

  // Leave unset for production. Exists for pointing at a non-standard deployment.
  get apiBase() { return optional("WEFUNDER_API_BASE") ?? DEFAULT_API_BASE; },
};
