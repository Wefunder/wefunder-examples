// Shared by the tests: a temporary store directory and a scripted fake of the Wefunder API that
// the real SDK talks to through an injected fetch. No network.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Deps } from "../lib/wefunder.ts";

export const OFFERING = "ofr_test_private_round";
export const TOKEN = "at_test_example_token";

// lib/store.ts resolves its file from DATA_ROOM_STORE_DIR on every call.
export function useTempStore(): void {
  process.env.DATA_ROOM_STORE_DIR = mkdtempSync(path.join(tmpdir(), "data-room-test-"));
}

export type Call = { method: string; path: string; query: Record<string, string>; token: string; body: unknown; idempotencyKey: string | null };
export type Reply = { status?: number; body: unknown };
export type Handler = (call: Call) => Reply;

// A fetch that records every request the SDK makes and answers from `handler`.
export function fakeWefunder(handler: Handler): { deps: Deps; calls: Call[] } {
  const calls: Call[] = [];
  const f = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    const text = await req.text();
    const call: Call = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      token: (req.headers.get("authorization") ?? "").replace(/^Bearer /, ""),
      body: text ? JSON.parse(text) : null,
      idempotencyKey: req.headers.get("idempotency-key"),
    };
    calls.push(call);
    const reply = handler(call);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { deps: { token: TOKEN, fetch: f as typeof fetch }, calls };
}

export const memberLink = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "member_link",
  attributes: {
    url: `https://wefunder.example/example-co?invite_token=${id}`,
    state,
    reference: null,
    wefunder_user_id: null,
    investment_id: null,
    offering: OFFERING,
    created_at: "2026-11-17T00:00:00Z",
    ...extra,
  },
});

export const session = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "investment_session",
  attributes: { status, url: `https://wefunder.example/invest/session/${id}`, email: null, investment_id: null, ...extra },
});

export const apiError = (status: number, type: string, message = type): Reply => ({ status, body: { error: { type, message, request_id: "req_test" } } });
