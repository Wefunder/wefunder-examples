# Member links (Next.js, plain `fetch`)

A small syndicate member portal built on [Member Links](https://docs.wefunder.com/partner-api/spvs/member-links).
A member link sends **one of your members** to **one deal page** on Wefunder and tells you what
that person did there. It carries no email: it binds to whichever Wefunder account first invests
through it (or to the account you pre-bind), and from then on only that account gets the
invitation's private-round access and invited pricing. You key each link on your own member id
(`reference`), and Wefunder answers with the link's live `state`: `created`, `bound`,
`invested` or `canceled`.

The app has two pages:

1. **`/`, the member portal.** Pick a member from the fixture (`data/members.json`), and you see a
   card for each deal. **Invest** posts to `/api/invest`, which calls
   `POST /offerings/{id}/member_links` with `reference` = the member's id (and their
   `wefunder_user_id` when the fixture has one), then redirects the browser to the link's
   `attributes.url`. This runs on the server, so the install token never reaches the browser.
2. **`/admin`, every link this install minted.** For each deal it reads
   `GET /offerings/{id}/member_links` and follows `next_cursor` to the last page. It shows each
   link's state, reference, `wefunder_user_id` and `investment_id`, with a **Cancel** button
   (`POST /member_links/{id}/cancel`).

`@wefunder/sdk` (0.1.0-beta.13) does not cover member links yet, so `lib/member_links.ts` calls
the REST API with `fetch` in one small typed module. Swap it for the SDK once member links land
there.

## Prerequisites

- **An app installed on your syndicate or company** with `read:invite_links` and
  `write:invite_links`, granted on both the install and its token. A syndicate's offerings are
  the SPVs it leads; a company's are all of its rounds.
- **The install's token** (`at_live_…`), the syndicate- or company-owned token you get when the
  app is installed. A user token gets `404` from every member-link endpoint, because a member
  link belongs to an install.
- **Preview scopes enabled for the app.** Member links are part of the invite-only Partner API
  preview.
- **At least one open offering** with a Wefunder page.
- Node 22.

**Sandbox:** member links are live-only for now. Sandbox support is tracked in
[Wefunder/wefunder#23884](https://github.com/Wefunder/wefunder/issues/23884) and is not
available yet, so this app runs against real offerings. Use test members and cancel what you mint.

## Environment

| Variable | |
|---|---|
| `WEFUNDER_ACCESS_TOKEN` | The install token. Server-only: never prefix it `NEXT_PUBLIC_`. |
| `WEFUNDER_OFFERING_IDS` | The deals to show, as `ofr_…` ids separated by spaces or commas. An optional `=Label` sets the card title (`ofr_abc=Arc_Hockey`; underscores show as spaces). |
| `DEMO_PASSWORD` | HTTP basic auth for every page. Set it on anything that isn't localhost. |
| `WEFUNDER_API_BASE` | Optional. Defaults to `https://wefunder.com/api/v2`. |

## Run it

```bash
cp .env.example .env.local        # fill in the token and offering ids
npm install
npm run dev                       # http://localhost:3000
npm test                          # the API client against a fake Wefunder; no network
npm run typecheck
```

## Walkthrough

1. Open `/`. You're signed in as the first fixture member, Avery Quinn (`member_1001`).
2. Click **Invest** on a deal. The server mints Avery's link and sends you to the deal page with
   `?invite_token=…`. The server log shows `created (201)`.
3. Go back and click **Invest** again. The log now shows `existing (200)`: the same `reference`
   on the same offering returns Avery's live link instead of minting a second one.
4. Switch to another member and click **Invest** on the same deal. They get their own link. Each
   member gets one link per deal, and one `reference` works across every offering.
5. Open `/admin`. Each link shows `created` until an account invests through it. Then it moves to
   `bound`, with `wefunder_user_id` set, and to `invested`, with `investment_id` set, once that
   account invests in this offering. There are no member-link webhooks yet, so reload the page
   (that is, poll) to see a change.
6. Copy a `wefunder_user_id` from the admin table into that member's `wefunder_user_id` in
   `data/members.json`, then click **Invest** on a *different* deal as that member. The new link
   is bound to their account from the start (`state: bound` before anyone opens it), so a
   forwarded copy is useless to anyone else. Pre-binding is in preview and enabled per app:
   until Wefunder turns it on for yours, this step answers `403 personal_invites_not_enabled`.
7. Click **Cancel** on a link nobody invested through. Its state becomes `canceled` and any
   pre-bound account is released (`wefunder_user_id` goes back to `null`). If that member clicks
   **Invest** again, Wefunder mints a fresh link (`201`), because a canceled link is no longer
   the reference's live link.

### Errors the portal explains

| Answer | When | What the member sees |
|---|---|---|
| `409 reference_conflict` | The `reference` already has a live link bound to a different account than the `wefunder_user_id` you sent | The link is bound to a different account than the one on file |
| `422 offering_not_open` | The offering isn't open for investment | The deal isn't open right now |
| `422 offering_has_no_page` | The offering has no Wefunder page to link to | The deal has no page yet |
| `404 not_found` | The install can't reach the offering, the token is a user token, or the `wefunder_user_id` is unknown | The deal couldn't be found for this install |
| `403 personal_invites_not_enabled` | You sent a `wefunder_user_id` and pre-binding isn't enabled for your app | Pre-binding isn't enabled; clear the member's `wefunder_user_id` or ask Wefunder |

The redirect back to the portal carries only a short key (`?error=offering_not_open`). The page
maps it to a fixed sentence, so a crafted URL can't put words on your portal. Wefunder's full
message and `request_id` go to the server log.

## Notes

- **Binding happens at the member's first investment.** Until then the link is `created`, and
  anyone who has it can open the deal page. The first account that invests through it holds it.
- **Pre-binding with `wefunder_user_id`.** Once you know a member's account (from an earlier
  link's `wefunder_user_id`), pass it on their next links. Those links are bound from the start.
  Repeating a `reference` with a `wefunder_user_id` binds a live link nobody has redeemed yet. If
  the link is already bound to someone else, the answer is `409 reference_conflict`. Pre-binding
  is a per-app preview (`403 personal_invites_not_enabled` until Wefunder enables it); unbound
  links need nothing extra.
- **Wrong-account modal.** Someone who opens a bound link while logged out, or signed in to a
  different account, gets no private access and no invited pricing. Wefunder tells them the
  invitation is for a different account and offers to sign them in with the right one. It shows
  a masked hint of the invited address (like `ja....@example.com`), never the address itself. If
  the round is public they can still invest, at standard terms.
- **Cancel releases unused links.** Canceling is idempotent. A link nobody invested through is
  released from any pre-bound account. A link an investment went through stays `invested`, and
  that investment keeps its terms. Revoking your install cancels every unused link it minted.
- **Responses never include the member's email**, even if your app has PII scope. Links carry
  Wefunder ids only.
- **No local store.** Unlike `investment-sync-nextjs`, this app keeps no state. The API already
  does the job of a `(member, offering) → il_…` table: a repeated `reference` returns the live
  link, and the list endpoint is the source of truth for state. A production portal would still
  record each `il_` id and the `wefunder_user_id` it learns, so that it can poll
  `GET /member_links/{id}` for specific links and pre-bind future ones.

## Layout

```
app/page.tsx                          member portal: member switcher, one card per deal
app/admin/page.tsx                    every link per deal (all pages), state and ids, Cancel
app/api/invest/route.ts               POST member_links with reference (+ wefunder_user_id) → 303 to attributes.url
app/api/member_links/[id]/cancel      POST /member_links/{id}/cancel → back to /admin
app/api/member/route.ts               the demo's "sign in as" cookie
lib/member_links.ts                   the typed REST client: create, listPage, listAll, get, cancel; error mapping
lib/client.ts                         builds the client from the server's environment
lib/members.ts, data/members.json     the fixture members (fake people)
lib/env.ts                            settings
middleware.ts                         HTTP basic auth (DEMO_PASSWORD)
test/                                 the client against an injected fetch; no network
```

## What this example simplifies

- **The "signed in" member is a cookie** you can switch freely. A real portal identifies the
  member through its own login and never lets them choose a `reference`.
- **The admin view lists live on every load**, one request per page per deal. A portal with many
  links would cache, or record each link it mints and poll only the ones not yet `invested` or
  `canceled`.
- **Dashboard auth is HTTP basic** with one shared password, and members and staff share it.
