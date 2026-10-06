// A tiny key/value store: Upstash / Redis when configured, a JSON file otherwise. The state is
// exactly what a real integration must persist: the connected staff user's token set, one
// company-owned token + sync cursor + mirror per installed company, the webhook event ids it has
// already seen, and the notification outbox.
//
// It is one JSON blob loaded and saved per request, which is fine for an example and wrong for
// production: two overlapping syncs of the same company (a webhook nudge racing the timer) can
// each apply pages and the slower one then saves the older cursor. A real integration keeps one
// row per company and takes a per-company lock (or a single-consumer queue keyed by company)
// around sync. See the guide, Step 4.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { TokenSet } from "@wefunder/sdk";

// A company-owned token: minted from an installation, no expiry, no refresh. Dies with the install.
export type CompanyToken = { accessToken: string; scope: string };

export type InvestmentRecord = Record<string, unknown> & { id: string; visible: boolean };

export type SyncState = {
  cursor: string | null;          // opaque; pass back verbatim
  published_through: string | null;
  last_synced_at: string | null;
  bootstraps: number;             // how many times we listed from scratch (a 410 forces one)
};

// One installed company: the install, the company-owned token it stands for, and our mirror.
export type CompanyState = {
  id: string;                     // co_…
  name: string;
  installation_id: string;        // inst_…
  tier: string;
  scopes: string[];               // what was GRANTED (install response), not what we asked for
  identity: boolean;              // scopes include read:investors:pii
  token: CompanyToken | null;     // null until minted (a founder-link install we have not minted for yet)
  // Set when a company token starts returning 401: a founder removed the app. Nothing here
  // reinstalls on its own; a human clears it (see the guide, Step 2 "A founder revoked you").
  disconnected: { at: string; reason: string } | null;
  sync: SyncState;
  records: Record<string, InvestmentRecord>;
  installed_at: string;
};

export type WebhookEventRecord = {
  id: string;
  event: string;
  created_at: string;
  mode: string;
  data: Record<string, unknown>;
  received_at: string;
};

// The notification outbox (guide, Step 6). A line is decided and queued in the same save as the
// record change, then delivered separately, so a failed Slack post is retried rather than lost.
export type Notification = {
  id: string;
  company: string;
  investment: string;
  line: string;
  created_at: string;
  delivered_at: string | null;
  attempts: number;
};

export type State = {
  // The Wefunder STAFF user connected to this integration (Authorization Code + PKCE). Their
  // token set is used only to list eligible companies, install, mint and revoke; never to read
  // investments. Refresh tokens rotate, so the SDK persists each new set here through a TokenStore.
  user: { name: string | null; tokens: TokenSet } | null;
  companies: Record<string, CompanyState>;
  // Setup-URL callbacks for installs we could not resolve yet (no user token at the time).
  pending_installs: { installation_id: string; state: string | null; received_at: string }[];
  events: WebhookEventRecord[];
  pending_oauth: Record<string, { code_verifier: string; created_at: string }>;
  notifications: Notification[];
  log: string[];
};

export const EMPTY: State = { user: null, companies: {}, pending_installs: [], events: [], pending_oauth: {}, notifications: [], log: [] };

export const emptySync = (): SyncState => ({ cursor: null, published_through: null, last_synced_at: null, bootstraps: 0 });

const KEY = "wefunder-examples:investment-sync:v1";
// Vercel's filesystem is read-only except /tmp, and /tmp does not survive between invocations.
// Without a store the app still works there, but state is ephemeral; the dashboard says so.
//
// Backends, in order of preference:
//   KV_REST_API_URL    → Upstash for Redis over REST (`vercel integration add upstash/upstash-kv`)
//   REDIS_URL          → standard Redis (e.g. Redis Cloud, `vercel integration add redis`)
//   otherwise          → a JSON file (.data/store.json locally, /tmp on Vercel)
export const BACKEND: "kv" | "redis" | "file" = process.env.KV_REST_API_URL ? "kv" : process.env.REDIS_URL ? "redis" : "file";
export const EPHEMERAL = BACKEND === "file" && !!process.env.VERCEL;
const FILE = EPHEMERAL ? "/tmp/wefunder-investment-sync-store.json" : path.join(process.cwd(), ".data", "store.json");

type RedisClient = { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<unknown>; connect(): Promise<unknown>; isOpen: boolean };
let redisClient: RedisClient | null = null;
async function redis(): Promise<RedisClient> {
  if (!redisClient) {
    const { createClient } = await import("redis");
    redisClient = createClient({ url: process.env.REDIS_URL }) as unknown as RedisClient;
  }
  if (!redisClient.isOpen) await redisClient.connect();
  return redisClient;
}

async function kv() {
  const mod = await import("@vercel/kv");
  return mod.kv;
}

function withDefaults(s: Partial<State>): State {
  return { ...structuredClone(EMPTY), ...s };
}

export async function load(): Promise<State> {
  if (BACKEND === "redis") {
    const raw = await (await redis()).get(KEY);
    return raw ? withDefaults(JSON.parse(raw) as State) : structuredClone(EMPTY);
  }
  if (BACKEND === "kv") return withDefaults((await (await kv()).get<State>(KEY)) ?? {});
  try {
    return withDefaults(JSON.parse(await fs.readFile(FILE, "utf8")) as State);
  } catch {
    return structuredClone(EMPTY);
  }
}

export async function save(state: State): Promise<void> {
  if (BACKEND === "redis") { await (await redis()).set(KEY, JSON.stringify(state)); return; }
  if (BACKEND === "kv") { await (await kv()).set(KEY, state); return; }
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(state, null, 2));
}

export async function update(fn: (s: State) => void | Promise<void>): Promise<State> {
  const s = await load();
  await fn(s);
  await save(s);
  return s;
}

export function log(s: State, line: string) {
  s.log.unshift(`${new Date().toISOString()} ${line}`);
  s.log = s.log.slice(0, 80);
}
