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
   `410` re-lists and replaces the API-managed set.
4. **Receive signed webhooks** (`investment.changed`) and sync the company they name. The event
   is a nudge, not the data.
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
npm test                          # sync loop, webhook verification, money feed, install state
```

For webhooks and the install callback to reach you locally, expose port 3000 with a tunnel and
register `https://<tunnel>/api/wefunder/webhooks` as the endpoint and
`https://<tunnel>/api/wefunder/setup` as the app's setup URL.

## Deploy (Vercel)

```bash
npx vercel link && npx vercel --prod
```

State (tokens, cursors, records, seen event ids, the outbox) needs a store on Vercel. Attach one
from the Marketplace and redeploy; the app reads `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Upstash)
or `REDIS_URL`. Without either it falls back to `/tmp` and the dashboard says so.

A timer is the safety net next to webhooks: `{ "crons": [{ "path": "/api/sync", "schedule": "*/30 * * * *" }] }`.

## Layout

```
app/api/wefunder/oauth/{start,callback}   connect the staff user (PKCE via @wefunder/sdk)
app/api/installs/route.ts                 eligible companies (GET) · install + receive the company token (POST)
app/api/installs/discover/route.ts        adopt installs made elsewhere (portal, founder link); mint their tokens
app/api/wefunder/setup/route.ts           setup-URL callback for founder-link installs
app/api/companies/[id]/{sync,revoke,reconnect,csv}
app/api/wefunder/webhooks/route.ts        signed receiver (constructEventFromRequest) → sync the named company
app/api/sync/route.ts                     sync every company (timer target)
app/api/notifications/drain/route.ts      deliver pending money-feed lines
lib/wefunder.ts                           every SDK call this app makes, one function each
lib/installs.ts                           install → company state; granted scopes; disconnected handling
lib/notify.ts                             the money-feed rule and the outbox
lib/store.ts                              persistence (Upstash / Redis / JSON file)
lib/founder_csv.ts                        the founder CSV, column for column
test/                                     runs against the SDK with an injected fetch; no network
```

## What this example simplifies

- **One JSON blob of state.** Fine here, wrong in production: overlapping syncs of one company can
  save an older cursor. Keep one row per company and lock per company (guide, Step 4).
- **Sync runs inline in the webhook handler.** A real receiver answers 200 and syncs from a queue.
- **An install without identity access is kept and flagged** rather than refused, so the dashboard
  can show the problem. The guide says stop and fix the app's scopes before importing.
- **Dashboard auth is HTTP basic** with one shared password.
