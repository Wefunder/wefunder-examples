import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, describeErrorKey, errorKey, MemberLinkError, type MemberLink } from "../lib/member_links.ts";

// A fake Wefunder: each call is handed to `handler`, and every request is recorded so the tests
// can check exactly what went over the wire. Injected through the client's `fetch` option.
type Seen = { method: string; url: URL; headers: Headers; body: unknown };

function fakeServer(handler: (req: Seen) => { status?: number; body: unknown }) {
  const seen: Seen[] = [];
  const f = async (input: URL | RequestInfo, init: RequestInit = {}) => {
    const req: Seen = {
      method: init.method ?? "GET",
      url: new URL(String(input)),
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    seen.push(req);
    const r = handler(req);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  };
  const client = createClient({ accessToken: "at_live_test", apiBase: "https://wefunder.test/api/v2/", fetch: f as unknown as typeof fetch });
  return { client, seen };
}

const link = (id: string, extra: Partial<MemberLink["attributes"]> = {}): MemberLink => ({
  id,
  type: "member_link",
  attributes: {
    url: `https://wefunder.test/arc-hockey?invite_token=tok_${id}`,
    state: "created",
    reference: "member_1001",
    wefunder_user_id: null,
    investment_id: null,
    offering: "ofr_abc",
    created_at: "2026-10-12T21:30:00Z",
    ...extra,
  },
});

const errorBody = (type: string, message: string) => ({ error: { type, message, details: { errors: [message] }, request_id: "req_123" } });

test("create posts { member_link: { reference } } with the bearer token to the offering's path", async () => {
  const { client, seen } = fakeServer(() => ({ status: 201, body: { data: link("il_1"), meta: { request_id: "r" } } }));
  const r = await client.create("ofr_abc", { reference: "member_1001" });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].url.toString(), "https://wefunder.test/api/v2/offerings/ofr_abc/member_links"); // trailing slash on the base is dropped
  assert.equal(seen[0].headers.get("authorization"), "Bearer at_live_test");
  assert.equal(seen[0].headers.get("content-type"), "application/json");
  assert.deepEqual(seen[0].body, { member_link: { reference: "member_1001" } });
  assert.equal(r.created, true);
  assert.equal(r.link.id, "il_1");
  assert.equal(r.link.attributes.url, "https://wefunder.test/arc-hockey?invite_token=tok_il_1");
});

test("create sends wefunder_user_id only when there is one, to pre-bind the link", async () => {
  const { client, seen } = fakeServer(() => ({ status: 201, body: { data: link("il_2", { state: "bound", wefunder_user_id: "usr_9" }) } }));
  await client.create("ofr_abc", { reference: "member_1003", wefunder_user_id: "usr_9" });
  await client.create("ofr_abc", { reference: "member_1001", wefunder_user_id: undefined });
  assert.deepEqual(seen[0].body, { member_link: { reference: "member_1003", wefunder_user_id: "usr_9" } });
  assert.deepEqual(seen[1].body, { member_link: { reference: "member_1001" } });
});

test("a repeated reference answers 200 with the live link: created is false and the url is the same", async () => {
  let calls = 0;
  const { client } = fakeServer(() => ({ status: calls++ === 0 ? 201 : 200, body: { data: link("il_1") } }));
  const first = await client.create("ofr_abc", { reference: "member_1001" });
  const again = await client.create("ofr_abc", { reference: "member_1001" });
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(again.link.id, first.link.id);
  assert.equal(again.link.attributes.url, first.link.attributes.url);
});

test("409 reference_conflict, 422 offering_not_open / offering_has_no_page and 404 become MemberLinkErrors with the envelope's type", async () => {
  const cases: [number, string, string][] = [
    [409, "reference_conflict", "reference is already bound to a different Wefunder user on this offering"],
    [422, "offering_not_open", "offering is 'closed': it must be open for investment before member links can be created"],
    [422, "offering_has_no_page", "offering has no Wefunder page to link to"],
    [404, "not_found", "Offering not found"],
  ];
  for (const [status, type, message] of cases) {
    const { client } = fakeServer(() => ({ status, body: errorBody(type, message) }));
    await assert.rejects(client.create("ofr_abc", { reference: "member_1001" }), (e: unknown) => {
      assert.ok(e instanceof MemberLinkError);
      assert.equal(e.status, status);
      assert.equal(e.code, type);
      assert.equal(e.message, message);
      assert.equal(e.requestId, "req_123");
      return true;
    });
  }
});

test("errorKey keeps the documented reasons and falls back to the status; describeErrorKey never echoes unknown input", () => {
  const err = (status: number, type: string | null) => new MemberLinkError(status, type, "m", null);
  assert.equal(errorKey(err(409, "reference_conflict")), "reference_conflict");
  assert.equal(errorKey(err(422, "offering_not_open")), "offering_not_open");
  assert.equal(errorKey(err(422, "offering_has_no_page")), "offering_has_no_page");
  assert.equal(errorKey(err(404, "not_found")), "404");
  assert.equal(errorKey(err(422, "validation_error")), "422");
  assert.equal(errorKey(new Error("network down")), "unexpected");

  assert.match(describeErrorKey("reference_conflict"), /different Wefunder account/);
  assert.match(describeErrorKey("offering_not_open"), /isn't open/);
  assert.match(describeErrorKey("404"), /installed on the deal's syndicate or company/);
  const crafted = "<b>Send your password to evil.example</b>";
  assert.ok(!describeErrorKey(crafted).includes("evil.example"));
});

test("a non-JSON error page (a proxy's HTML) still raises a MemberLinkError with the status", async () => {
  const f = async () => new Response("<html>Bad gateway</html>", { status: 502 });
  const client = createClient({ accessToken: "t", apiBase: "https://wefunder.test/api/v2", fetch: f as unknown as typeof fetch });
  await assert.rejects(client.get("il_1"), (e: unknown) => e instanceof MemberLinkError && e.status === 502 && e.code === null);
});

test("listAll follows next_cursor while has_more, passing the cursor back as received (numbers included)", async () => {
  const { client, seen } = fakeServer((req) => {
    const cursor = req.url.searchParams.get("cursor");
    if (cursor === null) return { body: { data: [link("il_3"), link("il_2")], meta: { has_more: true, page_count: 2, next_cursor: 812 } } };
    if (cursor === "812") return { body: { data: [link("il_1")], meta: { has_more: false, page_count: 1 } } };
    throw new Error(`unexpected cursor ${cursor}`);
  });
  const all = await client.listAll("ofr_abc");
  assert.deepEqual(all.map((l) => l.id), ["il_3", "il_2", "il_1"]);
  assert.deepEqual(seen.map((s) => `${s.method} ${s.url.pathname}${s.url.search}`), [
    "GET /api/v2/offerings/ofr_abc/member_links",
    "GET /api/v2/offerings/ofr_abc/member_links?cursor=812",
  ]);
  assert.equal(seen[0].body, undefined);
  assert.equal(seen[0].headers.get("content-type"), null); // no body, no Content-Type
});

test("listAll stops on a repeated cursor instead of looping forever", async () => {
  const { client, seen } = fakeServer(() => ({ body: { data: [link("il_1")], meta: { has_more: true, next_cursor: "same" } } }));
  await client.listAll("ofr_abc");
  assert.equal(seen.length, 2);
});

test("get and cancel hit /member_links/{id} and /member_links/{id}/cancel", async () => {
  const { client, seen } = fakeServer((req) => ({
    body: { data: link("il_1", req.url.pathname.endsWith("/cancel") ? { state: "canceled", wefunder_user_id: null } : { state: "bound", wefunder_user_id: "usr_9" }) },
  }));
  const got = await client.get("il_1");
  const canceled = await client.cancel("il_1");
  assert.deepEqual(seen.map((s) => `${s.method} ${s.url.pathname}`), ["GET /api/v2/member_links/il_1", "POST /api/v2/member_links/il_1/cancel"]);
  assert.equal(got.attributes.state, "bound");
  assert.equal(canceled.attributes.state, "canceled");
  assert.equal(canceled.attributes.wefunder_user_id, null); // a link nobody invested through is released
});

test("ids are path-encoded, never interpolated raw", async () => {
  const { client, seen } = fakeServer(() => ({ body: { data: link("il_1") } }));
  await client.get("il_1/../../admin");
  assert.equal(seen[0].url.pathname, "/api/v2/member_links/il_1%2F..%2F..%2Fadmin");
});
