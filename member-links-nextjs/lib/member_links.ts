// The Member Links API (https://docs.wefunder.com/partner-api/spvs/member-links), one function per
// endpoint. Plain fetch: `@wefunder/sdk` does not cover member links yet. Every call here runs on
// the server; the install token never reaches the browser.
//
//   POST /offerings/{id}/member_links      create (or return the live link for a repeated reference)
//   GET  /offerings/{id}/member_links      list your install's links on an offering, newest first
//   GET  /member_links/{id}                one link, with its live state
//   POST /member_links/{id}/cancel         retract it (idempotent)

export type Fetch = typeof fetch;

export type MemberLinkState = "created" | "bound" | "invested" | "canceled";

export type MemberLink = {
  id: string; // il_…, opaque: never parse it
  type: "member_link";
  attributes: {
    url: string; // the deal page carrying this link's token: send the member here
    state: MemberLinkState;
    reference: string | null;
    wefunder_user_id: string | null; // usr_… of the bound account. Never an email.
    investment_id: string | null;
    offering: string;
    created_at: string;
  };
};

export type CreateInput = { reference?: string; wefunder_user_id?: string };

export type CreateResult = {
  link: MemberLink;
  // false when the reference already had a live link on this offering (200), true when minted (201).
  created: boolean;
};

export type ListPage = { links: MemberLink[]; hasMore: boolean; nextCursor: string | null };

export type ClientOptions = { accessToken: string; apiBase: string; fetch?: Fetch };

// Every non-2xx answer. `code` is the envelope's `error.type` (reference_conflict,
// offering_not_open, offering_has_no_page, not_found, …).
export class MemberLinkError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly requestId: string | null;

  constructor(status: number, code: string | null, message: string, requestId: string | null) {
    super(message);
    this.name = "MemberLinkError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export function createClient(opts: ClientOptions) {
  const f = opts.fetch ?? fetch;
  const base = opts.apiBase.replace(/\/+$/, "");

  async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const res = await f(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* a proxy's HTML error page */ }
    if (!res.ok) throw toError(res.status, json, res.headers.get("x-request-id"));
    return { status: res.status, json };
  }

  async function listPage(offeringId: string, cursor?: string | null): Promise<ListPage> {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const { json } = await request("GET", `/offerings/${encodeURIComponent(offeringId)}/member_links${q}`);
    const meta = json?.meta ?? {};
    // next_cursor is opaque: it can arrive as a number or a string, and is absent on the last
    // page. Pass it back exactly as received.
    const raw = meta.next_cursor;
    const nextCursor = (typeof raw === "string" && raw) || typeof raw === "number" ? String(raw) : null;
    return {
      links: (json?.data ?? []) as MemberLink[],
      hasMore: meta.has_more === true,
      nextCursor,
    };
  }

  return {
    // reference = your member id. Repeating it on the same offering returns that member's live
    // link with 200 instead of minting another, so callers need no store of their own to avoid
    // duplicates. wefunder_user_id pre-binds the link to an account you already know.
    async create(offeringId: string, input: CreateInput): Promise<CreateResult> {
      const memberLink: CreateInput = {};
      if (input.reference) memberLink.reference = input.reference;
      if (input.wefunder_user_id) memberLink.wefunder_user_id = input.wefunder_user_id;
      const { status, json } = await request("POST", `/offerings/${encodeURIComponent(offeringId)}/member_links`, { member_link: memberLink });
      return { link: json.data as MemberLink, created: status === 201 };
    },

    listPage,

    // Every link on the offering, following next_cursor while has_more. `maxPages` bounds a
    // runaway loop (a server that keeps answering has_more with the same cursor).
    async listAll(offeringId: string, maxPages = 50): Promise<MemberLink[]> {
      const all: MemberLink[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < maxPages; page++) {
        const r: ListPage = await listPage(offeringId, cursor);
        all.push(...r.links);
        if (!r.hasMore || !r.nextCursor || r.nextCursor === cursor) break;
        cursor = r.nextCursor;
      }
      return all;
    },

    async get(id: string): Promise<MemberLink> {
      const { json } = await request("GET", `/member_links/${encodeURIComponent(id)}`);
      return json.data as MemberLink;
    },

    async cancel(id: string): Promise<MemberLink> {
      const { json } = await request("POST", `/member_links/${encodeURIComponent(id)}/cancel`);
      return json.data as MemberLink;
    },
  };
}

export type MemberLinksClient = ReturnType<typeof createClient>;

// Wefunder's error envelope: { error: { type, message, details, request_id } }. `type` is the
// machine-readable reason (reference_conflict, offering_not_open, not_found, …).
function toError(status: number, json: any, headerRequestId: string | null): MemberLinkError {
  const err = json?.error ?? {};
  const code = typeof err.type === "string" ? err.type : null;
  const message = typeof err.message === "string" && err.message ? err.message : `HTTP ${status}`;
  const requestId = typeof err.request_id === "string" ? err.request_id : headerRequestId;
  return new MemberLinkError(status, code, message, requestId);
}

// What to tell the person who clicked, in two steps: `errorKey` reduces a failure to a short key
// (safe to put in a redirect URL), `describeErrorKey` turns the key into a sentence. The page
// renders only these fixed sentences, never text taken from the URL, so a crafted link cannot put
// words on the portal. The full Wefunder message goes to the server log.
const MESSAGES: Record<string, string> = {
  reference_conflict:
    "This member's link on that deal is already bound to a different Wefunder account than the wefunder_user_id we have on file for them.",
  offering_not_open: "That deal isn't open for investment right now.",
  offering_has_no_page: "That deal has no Wefunder page to send members to yet.",
  personal_invites_not_enabled:
    "Pre-binding links to a member's Wefunder account isn't enabled for this app yet. Clear the member's wefunder_user_id, or ask Wefunder to enable it.",
  unknown_offering: "That deal isn't one this portal lists.",
  "401": "Wefunder rejected the access token. Check WEFUNDER_ACCESS_TOKEN.",
  "403": "The token is missing a scope. It needs read:invite_links and write:invite_links, on both the token and the install.",
  "404":
    "Wefunder couldn't find that deal for this install, or the member's wefunder_user_id is unknown. The app must be installed on the deal's syndicate or company, and the token must be that install's token (a user token gets 404).",
  "409": "Wefunder reported a conflict creating the link. The server log has the details.",
  "422": "Wefunder couldn't create the link. The server log has the details.",
};

const KNOWN_CODES = new Set(["reference_conflict", "offering_not_open", "offering_has_no_page", "personal_invites_not_enabled"]);

export function errorKey(e: unknown): string {
  if (!(e instanceof MemberLinkError)) return "unexpected";
  if (e.code && KNOWN_CODES.has(e.code)) return e.code;
  return String(e.status);
}

export function describeErrorKey(key: string): string {
  return MESSAGES[key] ?? "Something went wrong talking to Wefunder. The server log has the details.";
}
