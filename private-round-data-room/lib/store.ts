// What the data room remembers about each user's trip to Wefunder: the id of their member link
// and of their investment session on a round, and the last state it read for each. In your app
// this is a small table keyed on (your user id, offering id); here it is one JSON file.
//
// The ids are what make polling cheap and safe: `GET /member_links/{id}` reads a link without
// creating one, so a user who never clicked Invest never costs a request.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LinkState, SessionStatus } from "./wefunder.ts";

export type UserRecord = {
  linkId?: string;
  linkState?: LinkState;
  linkCheckedAt?: number;
  // Set once the link binds. Keep it: it is how you would pre-bind this person's next link.
  wefunderUserId?: string | null;
  investmentId?: string | null;

  sessionId?: string;
  sessionStatus?: SessionStatus;
  sessionCheckedAt?: number;
  sessionInvestmentId?: string | null;
};

// offering id → your user id → record. Keyed by offering because each offering has its own
// links: when the Reg CF opens, the same user ids start fresh under the new offering id.
export type State = { offerings: Record<string, Record<string, UserRecord>> };

// Resolved against the working directory on every call (the tests point it at a temp dir).
const file = () => path.join(process.env.DATA_ROOM_STORE_DIR || path.join(process.cwd(), ".data"), "store.json");

export async function load(): Promise<State> {
  try {
    return JSON.parse(await readFile(file(), "utf8")) as State;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { offerings: {} };
    throw e;
  }
}

export async function recordFor(offeringId: string, userId: string): Promise<UserRecord> {
  return (await load()).offerings[offeringId]?.[userId] ?? {};
}

// Writes are queued in this process and each one re-reads the file, so two requests that finish
// together both land. That is enough for `npm run dev` or one `next start`; see the README for
// what more than one instance needs.
let queue: Promise<unknown> = Promise.resolve();

export function update(offeringId: string, userId: string, patch: UserRecord): Promise<UserRecord> {
  const run = queue.then(async () => {
    const state = await load();
    const forOffering = (state.offerings[offeringId] ??= {});
    const next = { ...forOffering[userId], ...patch };
    forOffering[userId] = next;
    await mkdir(path.dirname(file()), { recursive: true });
    const tmp = `${file()}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, file());
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}
