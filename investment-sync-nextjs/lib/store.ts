// A tiny key/value store: Upstash / Redis when configured, a JSON file otherwise. The state is
// exactly what a real integration must persist: the connected staff user's token set, one
// company-owned token + sync cursor + mirror per installed company, the webhook inbox, and the
// notification outbox.
//
// It is one JSON blob loaded per request. Two things keep that blob honest under concurrency:
//
//   - `withLock(name, fn)` serializes work on one name. `syncCompany` (lib/installs.ts) holds
//     `company:<id>` for the whole sync, so two syncs of one company (a webhook nudge racing the
//     timer) run one after the other, and the second starts from the cursor the first saved.
//     `drainOutbox` (lib/notify.ts) holds `outbox` around load → post → persist, so two requests
//     never post the same Slack line.
//   - `commitSync()` is the ONLY way a sync's cursor and records reach the store, and it is fenced
//     by `sync.generation`: the commit is accepted only if the stored generation is still the one
//     the sync started from. The remote lock is a lease (`ttlMs`), and a sync can outlive it: a
//     long bootstrap, or the SDK's rate-limit waits. If a successor syncs and commits meanwhile,
//     the expired holder's commit is refused (StaleSync) and discarded, never written over the
//     newer cursor. The lock prevents wasted work; the fence prevents lost work.
//   - `save()` is a short read-merge-write under the `store` lock. A copy loaded earlier can never
//     put back an older cursor and records for a company (`sync.generation` decides, and only
//     `commitSync` ever raises it), and the webhook inbox and the outbox are unioned, so a stored
//     delivery or a queued Slack line is never dropped by a request that loaded the blob before it
//     was written.
//
// Everything else in the blob (the log, the staff user's token set, install metadata) is
// last-writer-wins. A production integration keeps one row per company and per inbox entry in a
// database and gets the same guarantees from a row lock and a unique index (guide, Step 4).
import { randomBytes } from "node:crypto";
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
  // +1 for every sync committed through `commitSync`, which refuses to commit unless the stored
  // generation is still the one the sync read. `save()` keeps whichever copy of cursor + records
  // has the higher generation, so a stale copy never moves the cursor back.
  generation: number;
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

// The webhook inbox (guide, Step 4 "The webhook"): one row per (event id, installation id), stored
// before the receiver answers 2xx and worked off afterwards by `processInbox` (lib/inbox.ts).
export type WebhookEventRecord = {
  id: string;                     // evt_…
  installation_id: string;        // inst_… from the envelope; with `id`, the dedupe key
  company: string | null;         // co_… the event names
  event: string;
  created_at: string;
  mode: string;
  data: Record<string, unknown>;
  received_at: string;
  processed_at: string | null;    // null = still queued
  outcome: string | null;         // "synced", "disconnected", "not installed here", "ignored", "failed: …"
  attempts: number;               // failed syncs so far
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
  // Taken on the STORED row under the store lock (`claimNotification`) before a post is
  // attempted, and cleared after it. A drain only posts a line whose claim it won, so a drain
  // that outlived its lock's lease cannot be joined by a second poster.
  claimed_until?: string | null;
  claimed_by?: string | null;
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

export const emptySync = (): SyncState => ({ cursor: null, published_through: null, last_synced_at: null, bootstraps: 0, generation: 0 });

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
// Resolved per call rather than at import, so the tests can chdir into a temporary directory.
const file = () => (EPHEMERAL ? "/tmp/wefunder-investment-sync-store.json" : path.join(process.cwd(), ".data", "store.json"));

type RedisClient = {
  get(k: string): Promise<string | null>;
  set(k: string, v: string, opts?: { NX?: boolean; PX?: number }): Promise<string | null>;
  eval(script: string, opts: { keys: string[]; arguments: string[] }): Promise<unknown>;
  connect(): Promise<unknown>;
  isOpen: boolean;
};
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
    return withDefaults(JSON.parse(await fs.readFile(file(), "utf8")) as State);
  } catch {
    return structuredClone(EMPTY);
  }
}

async function write(state: State): Promise<void> {
  if (BACKEND === "redis") { await (await redis()).set(KEY, JSON.stringify(state)); return; }
  if (BACKEND === "kv") { await (await kv()).set(KEY, state); return; }
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(state, null, 2));
}

// Read what is stored now, fold it into `state`, write `state`. Mutates `state`, so the caller's
// copy matches what was written. The header says what is merged and why.
export async function save(state: State): Promise<void> {
  await withLock("store", async () => {
    merge(state, await load());
    await write(state);
  });
}

// Thrown by `commitSync` when the stored generation moved while this sync ran: another holder
// committed first (the lease expired, or a stale copy raced). The caller discards its result.
export class StaleSync extends Error {
  constructor(companyId: string, expected: number, found: number) {
    super(`${companyId}: sync result discarded; stored generation is ${found}, this sync started from ${expected}`);
  }
}

// Test seam: lets a test make the next write fail to prove a failed commit leaves nothing behind.
export const testHooks: { beforeWrite?: (s: State) => void } = {};

// Commit one company's sync result: the cursor, records and the outbox lines queued with them.
// Conditional on the stored generation still being `base` — the generation the sync started
// from. Under the `store` lock: load, compare, bump to base + 1, merge, write. A failed compare
// writes nothing and throws StaleSync; a failed write throws with the generation NOT bumped, so
// the caller's copy still reads as the base generation and a later `save()` of it cannot win a
// tie against whoever commits next.
export async function commitSync(state: State, companyId: string, base: number): Promise<void> {
  await withLock("store", async () => {
    const stored = await load();
    const ours = state.companies[companyId];
    const theirs = stored.companies[companyId];
    // A different stored installation is a mirror this install does not continue (`upsertCompany`
    // starts a new install from generation 0), so its generation is not this sync's baseline.
    const found = theirs && theirs.installation_id === ours.installation_id ? (theirs.sync.generation ?? 0) : 0;
    if (found !== base) throw new StaleSync(companyId, base, found);
    const before = ours.sync.generation ?? 0;
    ours.sync.generation = base + 1;
    try {
      merge(state, stored);
      testHooks.beforeWrite?.(state);
      await write(state);
    } catch (e) {
      ours.sync.generation = before;
      throw e;
    }
  });
}

const claimLive = (n: Notification, now = Date.now()) => !!n.claimed_until && new Date(n.claimed_until).getTime() > now;

// Claim one outbox line for `owner`: under the store lock, read the STORED row and take it only if
// it is still pending and unclaimed (or `owner` already holds it); write; mirror the stored row
// into `state`. Returns whether this worker owns the line. Two drains that both loaded the line
// as pending cannot both win: the second one's compare runs against the first one's write.
export async function claimNotification(state: State, id: string, owner: string, ttlMs: number): Promise<boolean> {
  return withLock("store", async () => {
    const stored = await load();
    const row = stored.notifications.find((n) => n.id === id);
    if (!row || row.delivered_at || (claimLive(row) && row.claimed_by !== owner)) {
      if (row) adoptNotification(state, row);
      return false;
    }
    row.attempts += 1;
    row.claimed_until = new Date(Date.now() + ttlMs).toISOString();
    row.claimed_by = owner;
    await write(stored);
    adoptNotification(state, row);
    return true;
  });
}

// Record a claimed line's outcome on the STORED row (delivered, or pending again with the claim
// released), only while `owner` still holds the claim; mirror it into `state`.
export async function settleNotification(state: State, id: string, owner: string, delivered: boolean): Promise<void> {
  await withLock("store", async () => {
    const stored = await load();
    const row = stored.notifications.find((n) => n.id === id);
    if (!row || row.claimed_by !== owner) { if (row) adoptNotification(state, row); return; }
    if (delivered) row.delivered_at = new Date().toISOString();
    row.claimed_until = null;
    row.claimed_by = null;
    await write(stored);
    adoptNotification(state, row);
  });
}

function adoptNotification(state: State, row: Notification): void {
  const i = state.notifications.findIndex((n) => n.id === row.id);
  if (i >= 0) state.notifications[i] = row; else state.notifications.unshift(row);
}

export async function update(fn: (s: State) => void | Promise<void>): Promise<State> {
  const s = await load();
  await fn(s);
  await save(s);
  return s;
}

export const eventKey = (e: Pick<WebhookEventRecord, "id" | "installation_id">) => `${e.id}|${e.installation_id}`;

export function merge(ours: State, stored: State): void {
  for (const [id, c] of Object.entries(ours.companies)) {
    const theirs = stored.companies[id];
    if (!theirs || theirs.installation_id !== c.installation_id) continue;
    if ((theirs.sync.generation ?? 0) > (c.sync.generation ?? 0)) {
      c.sync = theirs.sync;
      c.records = theirs.records;
    }
  }
  // The inbox is keyed on (event id, installation id): this union is its unique index. A row both
  // copies hold keeps the further-along state (processed beats queued, more attempts beat fewer).
  ours.events = union(ours.events, stored.events, eventKey,
    (a, b) => (!!a.processed_at !== !!b.processed_at ? (a.processed_at ? a : b) : (a.attempts ?? 0) >= (b.attempts ?? 0) ? a : b),
    (e) => e.received_at, (e) => e.processed_at === null);   // rows from before the inbox have no processed_at: finished
  // A line both copies hold keeps the further-along state. A delivery attempt moves a line
  // pending → claimed (attempts + 1, claimed_until set) → delivered, or → cleared (claim nulled,
  // still pending). So: delivered beats pending; more attempts beat fewer (a persisted claim must
  // survive a save by a copy that never saw it); at equal attempts the cleared claim is the later
  // state and beats the live one.
  ours.notifications = union(ours.notifications, stored.notifications, (n) => n.id,
    (a, b) => (!!a.delivered_at !== !!b.delivered_at ? (a.delivered_at ? a : b)
      : a.attempts !== b.attempts ? (a.attempts > b.attempts ? a : b)
      : !!a.claimed_until !== !!b.claimed_until ? (a.claimed_until ? b : a) : a),
    (n) => n.created_at, (n) => !n.delivered_at);
}

// Newest first. Keeps every pending item and the 200 newest finished ones.
function union<T>(ours: T[], theirs: T[], key: (t: T) => string, pick: (a: T, b: T) => T, at: (t: T) => string, pending: (t: T) => boolean): T[] {
  const byKey = new Map<string, T>();
  for (const t of theirs) byKey.set(key(t), t);
  for (const t of ours) { const k = key(t); const held = byKey.get(k); byKey.set(k, held ? pick(t, held) : t); }
  let finished = 0;
  return [...byKey.values()]
    .sort((a, b) => at(b).localeCompare(at(a)))
    .filter((t) => pending(t) || ++finished <= 200);
}

export function log(s: State, line: string) {
  s.log.unshift(`${new Date().toISOString()} ${line}`);
  s.log = s.log.slice(0, 80);
}

// ── Locks ───────────────────────────────────────────────────────────────────────
//
// `withLock(name, fn)` runs `fn` while holding `name`, waiting up to `waitMs` for it; if it is
// still held then, it throws LockBusy and `fn` never runs. The file backend locks inside this
// process (a JSON file is only safe with one server process anyway). Redis and Upstash use
// `SET key token NX PX ttl` with a random token, and release only while the token still matches,
// so a lock that expired and was taken by another request is never deleted by its first owner.
// `ttlMs` is a lease, not a guarantee: a sync that outlives it loses its exclusivity, which is
// why the sync's commit is fenced by generation (`commitSync`) rather than trusting the lock.

export class LockBusy extends Error {
  constructor(name: string) { super(`${name} is busy (another request holds its lock); try again shortly`); }
}

export type LockOptions = { waitMs?: number; ttlMs?: number };

// The two calls a remote lock needs, so Redis and Upstash share one acquire loop.
export type RemoteLockClient = {
  setNxPx(key: string, token: string, ttlMs: number): Promise<boolean>;
  delIfEquals(key: string, token: string): Promise<void>;
};

const RELEASE = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

async function remoteLockClient(): Promise<RemoteLockClient> {
  if (BACKEND === "redis") {
    const r = await redis();
    return {
      setNxPx: async (key, token, ttl) => (await r.set(key, token, { NX: true, PX: ttl })) === "OK",
      delIfEquals: async (key, token) => { await r.eval(RELEASE, { keys: [key], arguments: [token] }); },
    };
  }
  const k = await kv();
  return {
    setNxPx: async (key, token, ttl) => (await k.set(key, token, { nx: true, px: ttl })) === "OK",
    delIfEquals: async (key, token) => { await k.eval(RELEASE, [key], [token]); },
  };
}

type Release = () => Promise<void>;

export async function acquireRemote(client: RemoteLockClient, key: string, { waitMs = 30_000, ttlMs = 120_000 }: LockOptions = {}): Promise<Release | null> {
  const token = randomBytes(16).toString("hex");
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (await client.setNxPx(key, token, ttlMs)) return () => client.delIfEquals(key, token);
    const left = deadline - Date.now();
    if (left <= 0) return null;
    await new Promise<void>((r) => setTimeout(r, Math.min(150, left)));
  }
}

const held = new Map<string, Promise<void>>();

export async function acquireLocal(key: string, { waitMs = 30_000 }: LockOptions = {}): Promise<Release | null> {
  const deadline = Date.now() + waitMs;
  while (held.has(key)) {
    const left = deadline - Date.now();
    if (left <= 0) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([held.get(key), new Promise<void>((r) => { timer = setTimeout(r, left); })]);
    clearTimeout(timer);
  }
  let release!: () => void;
  held.set(key, new Promise<void>((r) => { release = r; }));    // same tick as the check above: no gap
  return async () => { held.delete(key); release(); };
}

export async function withLock<T>(name: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  const key = `${KEY}:lock:${name}`;
  const release = BACKEND === "file" ? await acquireLocal(key, opts) : await acquireRemote(await remoteLockClient(), key, opts);
  if (!release) throw new LockBusy(name);
  try {
    return await fn();
  } finally {
    await release();
  }
}
