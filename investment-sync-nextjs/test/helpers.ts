// Shared by the tests that go through the real store (a JSON file in a temporary directory) and
// the real company client (the SDK with an injected fetch). No network.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EMPTY, emptySync, save, type CompanyState, type State } from "../lib/store.ts";

// The file backend resolves `.data/store.json` against the working directory on every call.
export function useTempStore() {
  process.chdir(mkdtempSync(path.join(tmpdir(), "investment-sync-test-")));
}

export async function resetStore(companies: CompanyState[]): Promise<void> {
  rmSync(path.join(process.cwd(), ".data"), { recursive: true, force: true });
  const s: State = structuredClone(EMPTY);
  for (const c of companies) s.companies[c.id] = c;
  await save(s);
}

export const company = (id: string, installationId: string, token: string, cursor: string | null = null): CompanyState => ({
  id, name: id, installation_id: installationId, tier: "editor", scopes: ["read:investments"], identity: false,
  token: { accessToken: token, scope: "read:investments" }, disconnected: null,
  sync: { ...emptySync(), cursor }, records: {}, installed_at: "2026-10-01T00:00:00Z",
});

export const rec = (id: string, extra: Record<string, unknown> = {}) => ({ id, visible: true, status: "active", observed_at: "2026-10-01T00:00:00Z", ...extra });

export const page = (data: unknown[], next: string, mode = "delta") => ({ body: { data, meta: { mode, has_more: false, next_cursor: next, page_count: 1, published_through: null } } });

type Reply = { status?: number; body: unknown; delayMs?: number };

// A fake `GET /investments`, scripted by cursor. Records "<token> <cursor>" for every call.
export function fakeInvestments(script: Record<string, Reply>, calls: string[] = []) {
  const f = async (input: URL | RequestInfo, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const u = new URL(req.url);
    assert.equal(u.pathname, "/investments");
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const cursor = u.searchParams.get("cursor") ?? "";
    calls.push(`${token} ${cursor}`);
    const r = script[cursor];
    if (!r) throw new Error(`unexpected cursor ${JSON.stringify(cursor)}`);
    if (r.delayMs) await new Promise((done) => setTimeout(done, r.delayMs));
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  };
  return f as unknown as typeof fetch;
}
