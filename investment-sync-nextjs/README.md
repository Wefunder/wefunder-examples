# Investment sync (Next.js, `@wefunder/sdk`)

A small Next.js app that does everything the
[sync guide](https://docs.wefunder.com/guides/sync-investments-to-crm) describes, in the order a
firm that helps many founders raise would do it:

1. **Connect one staff user** (Authorization Code + PKCE through the SDK's helpers). That token
   installs, mints and revokes; it never reads investments.
2. **Install on each company** the user can edit (`GET /installations/eligible` →
   `POST /installations`), or adopt installs founders made through your install link. Each install
   returns a **company-owned token**; the app keeps one per company and reads back the scopes
   that were **granted**, which can be fewer than it asked for.
3. **List once, then sync by cursor** with the company's own token
   (`wf.investments.list({ cursor })`). Tombstones delete, deactivated investors overwrite, a
   `410` re-lists and replaces the API-managed set. One sync per company at a time: a second
   sync of the same company waits for the first and starts from the cursor it saved.
4. **Receive signed webhooks** (`investment.changed`): verify, **store** the delivery keyed on
   (event id, installation id), answer `200`, then sync the company it names from the stored row.
   The event is a nudge, not the data.
5. **Post a money feed** from the app's own before/after copies: new investment, group or status
   change, amount change, removal. Lines go through an outbox so a failed Slack post is retried,
   never lost.

The dashboard at `/` shows each stage's state. Each company card has **Sync now**, **Download
CSV** (the founder Investor CSV rebuilt from the mirror, for diffing against wefunder.com's), and
**Revoke**. A company whose founder removed the app shows **disconnected**; nothing here reinstalls
on its own (see `lib/installs.ts`).

## Run it

```bash
cp .env.example .env.local        # values from the developer portal
npm install
npm run dev                       # http://localhost:3000
npm test                          # sync loop, per-company lock, webhook inbox, money feed, install state
```

For webhooks and the install callback to reach you locally, expose port 3000 with a tunnel and
register `https://<tunnel>/api/wefunder/webhooks` as the endpoint and
`https://<tunnel>/api/wefunder/setup` as the app's setup URL.

## Deploy (Vercel)

```bash
npx vercel link && npx vercel --prod
```

State (tokens, cursors, records, the webhook inbox, the outbox) needs a store on Vercel. Attach
one from the Marketplace and redeploy; the app reads `KV_REST_API_URL` + `KV_REST_API_TOKEN`
(Upstash) or `REDIS_URL`. Without either it falls back to `/tmp` and the dashboard says so. The
same store holds the per-company locks (`SET NX PX`), so the lock spans every function instance.

A timer is both the inbox worker and the safety net next to webhooks:
`{ "crons": [{ "path": "/api/sync", "schedule": "*/30 * * * *" }] }`.

### How a webhook is processed

The receiver verifies the signature, saves the delivery to the inbox, and only then answers `200`.
A failed save answers `500`, and Wefunder retries the delivery with backoff. A repeat of an
(event id, installation id) pair already held is acknowledged and not stored again. The same event
delivered for two installed companies is two rows and two syncs.

The stored rows are processed in two places. Neither needs a separate worker process, because
Vercel has none:

- **Right after the response**, through Next.js `after()`. On Vercel it runs inside the same
  invocation via `waitUntil`, so a change usually lands within seconds.
- **On the timer** (`/api/sync`), which works off anything still queued before it syncs the
  remaining companies. This catches rows whose post-response pass failed or was cut off.

A row is marked processed only after its company's sync is saved. A sync that keeps failing
leaves the row queued, and the row is given up after 5 passes. The timer still syncs that company
every 30 minutes either way.

## Layout

```
app/api/wefunder/oauth/{start,callback}   connect the staff user (PKCE via @wefunder/sdk)
app/api/installs/route.ts                 eligible companies (GET) · install + receive the company token (POST)
app/api/installs/discover/route.ts        adopt installs made elsewhere (portal, founder link); mint their tokens
app/api/wefunder/setup/route.ts           setup-URL callback for founder-link installs
app/api/companies/[id]/{sync,revoke,reconnect,csv}
app/api/wefunder/webhooks/route.ts        signed receiver (constructEventFromRequest) → store in the inbox → 200 → after()
app/api/sync/route.ts                     work off the inbox, then sync every other company (timer target)
app/api/notifications/drain/route.ts      deliver pending money-feed lines
lib/wefunder.ts                           every SDK call this app makes, one function each (no wf.raw)
lib/installs.ts                           install → company state; granted scopes; locked per-company sync; disconnected handling
lib/inbox.ts                              the webhook inbox: store keyed on (event id, installation id), process afterwards
lib/notify.ts                             the money-feed rule and the outbox
lib/store.ts                              persistence (Upstash / Redis / JSON file), locks, merge-on-save
lib/founder_csv.ts                        the founder CSV, column for column
test/                                     runs against the SDK with an injected fetch; no network
```

## What this example simplifies

- **One JSON blob of state instead of database rows.** Syncs are serialized per company, and
  `save()` merges, so a cursor never moves back and no inbox row or outbox line is lost. The rest
  of the blob is last-writer-wins: the log, install metadata, and the staff user's token set.
  `lib/store.ts` explains the details. A production integration keeps one row per company and per
  inbox entry, and uses a row lock and a unique index instead.
- **The file store's lock only covers one process.** That is enough for `npm run dev` or a single
  `next start`. Anything with more than one instance needs Upstash or Redis, which the Vercel
  deploy needs anyway.
- **An install without identity access is kept and flagged** rather than refused, so the dashboard
  can show the problem. The guide says stop and fix the app's scopes before importing.
- **Dashboard auth is HTTP basic** with one shared password.
