# Private round data room (Next.js, `@wefunder/sdk`)

A small Next.js app that does what the
[private round data room guide](https://docs.wefunder.com/guides/private-round-data-room)
describes: a data room on **your own domain**, behind **your own login**, for a private round
that runs on Wefunder.

Signed in, an investor sees how the round is going and can go invest. Investing itself happens on
Wefunder, which handles the account, identity checks, documents and payment. The app shows two
ways to get there, side by side:

| | Member link | Investment session |
|---|---|---|
| Sends the investor to | The round's page on Wefunder, with access to the private round already in place | Wefunder's hosted checkout for the round, then back to your data room |
| You give Wefunder | Your own user id, as an opaque `reference`. No email | The investor's email |
| The investor uses | Any Wefunder account. The link binds to the first account that invests through it | The account for that email |
| Stability | Generally available | **Beta** |
| Pick it when | You want them to read the round's page and terms on Wefunder first, or you do not know which email they will use there | They have read everything in your data room, you know their email, and you want the shortest path to checkout and a return to your site |

Start with member links. Add investment sessions if the extra step of the round's page costs you
investors. `WEFUNDER_CHECKOUT_SESSIONS=off` hides the second button.

```
browser (signed in to YOUR data room)      this app's server                     Wefunder
─────────────────────────────────────      ─────────────────                     ────────
GET /  ───────────────────────────────────▶ wf.offerings.stats(ofr) ───────────▶ GET  /offerings/{id}/stats
◀── raise totals                            (cached one minute)

press "Invest on Wefunder"
POST /api/invest/link ────────────────────▶ wf.memberLinks.create(ofr,           POST /offerings/{id}/member_links
◀── 303 to the link's url                     { reference: your user id }) ─────▶
     … the round's page on Wefunder …

press "Go straight to checkout"
POST /api/invest/session ─────────────────▶ wf.investmentSessions.create(ofr,    POST /offerings/{id}/investment_sessions
◀── 303 to the session's url                  { email, success_url, cancel_url })▶
     … Wefunder's hosted checkout …
◀── back to /?checkout=success|cancel

GET /api/status (every 15 s) ─────────────▶ wf.memberLinks.get(id)               GET  /member_links/{id}
◀── { link, session }                       wf.investmentSessions.get(id) ─────▶ GET  /investment_sessions/{id}
                                            (each at most once a minute)
```

Three rules shape the layout:

- **The installation token stays on the server.** It is your company's own credential. Only
  `lib/env.ts` reads it, that file is `server-only`, and the one Client Component talks to this
  app's `/api/status`, never to Wefunder. `npm run check:bundle` fails the build if the token or
  the SDK reaches the files a browser downloads.
- **Nothing about the round renders without a signed-in data-room user.** Every page and route
  checks the session first; `test/gate.test.ts` fails if a new one forgets.
- **Links and sessions are minted on a click, never ahead of time and never by the poll.** A
  user who has not pressed Invest costs no request and has nothing at Wefunder.

## Set it up

Use the sandbox first: nothing in a sandbox realm touches live data and no money moves.

1. **Create an app** in the [developer portal](https://wefunder.com/developers) and tick these
   scopes on it **before** you install it. An install carries the scopes ticked when it was made.

   | Scope | For |
   |---|---|
   | `read:investments` | raise totals (`GET /offerings/{id}/stats`) |
   | `read:invite_links`, `write:invite_links` | member links |
   | `read:investment_sessions`, `write:investment_sessions` | investment sessions (skip both with `WEFUNDER_CHECKOUT_SESSIONS=off`) |

2. **For investment sessions, register a redirect URI on this app's origin**, for example
   `http://localhost:3000/oauth/callback`. This example has no OAuth flow; the URI is there
   because a session's return URLs must be on the origin of one of the app's registered redirect
   URIs. Without it, creating a session is a `422`. Register only origins you control.
3. **Install the app on your company and mint an installation token.** In the sandbox, that is
   your realm's seeded company, signed in as the seeded founder:
   [Installing in your realm](https://docs.wefunder.com/getting-started/sandbox#installing-in-your-realm).
   On live it is your own company: [Install your app](https://docs.wefunder.com/getting-started/install).
   The token (`at_test_…` in the sandbox) acts as the company, not as you.
4. **Note the round's offering id** (`ofr_…`). It must be a round of the company the token is
   installed on; any other offering is refused. In the sandbox, your realm's seeded company has
   one open round: use it as the stand-in for your private round.
5. **Configure and run:**

   ```bash
   cp .env.example .env.local        # WEFUNDER_INSTALL_TOKEN, WEFUNDER_OFFERING_ID, SESSION_SECRET, DEMO_PASSWORD
   npm install
   npm run dev                       # http://localhost:3000
   npm test                          # requests, polling rules, login cookie, the gate; no network
   ```

6. **Walk it through.** Sign in as a fixture investor and press **Invest on Wefunder**. The
   round's page opens on your realm host; invest there with a new account and the Stripe test
   card `4242 4242 4242 4242`. Back in the data room the status turns to **Invested on
   Wefunder** within a minute. Then try **Go straight to checkout**: it opens the hosted checkout
   for the fixture's email and returns you to the data room. Sign in as the founder fixture and
   open **Who has invested** to see every user's state.

## What to read

```
app/page.tsx                      the data room: totals, the two ways to invest, placeholder documents
app/invest_panel.tsx              the only Client Component: both buttons, both states, the poll of /api/status
app/admin/page.tsx                the founder's view: every data-room user and what they did on Wefunder
app/api/invest/link/route.ts      member link: mint on click with reference = your user id, 303 to its url
app/api/invest/session/route.ts   investment session: create for the user's email, 303 to hosted checkout
app/api/status/route.ts           the signed-in user's own link and session state, as JSON
app/login, app/api/login|logout   STUB login (fixture users, one shared password)
lib/wefunder.ts                   every SDK call this app makes, one function each (no wf.raw)
lib/status.ts                     the polling rules and the one-minute caches; where a webhook slots in
lib/store.ts                      what the data room remembers per user and offering (a JSON file)
lib/raise.ts, lib/states.ts       stats → the numbers shown; Wefunder states → labels and button text
lib/errors.ts                     Wefunder's refusals → fixed sentences
lib/auth.ts, lib/users.ts         STUB session cookie and STUB user directory
lib/env.ts, lib/server.ts         settings and the signed-in user; both server-only
scripts/check-bundle.mjs          after a build: no token and no SDK in the browser's files
test/                             runs against the SDK with an injected fetch; no network
```

## How state stays current

Member links have no webhook today, so the app polls. The page asks this app's `/api/status`
every 15 seconds while something can still change; this app asks Wefunder **at most once a
minute** per user, by id (`GET /member_links/{id}`, `GET /investment_sessions/{id}`), and stops
once the link or session has settled. Raise totals are read once a minute for everyone together.
The founder's table reads the two list endpoints instead, one request per page for the whole
round.

`invested` is not final. Wefunder derives a link's state on every read from the account's active
investments, so if the investment is later canceled the link reads `bound` again. The app
therefore re-reads an invested link every 15 minutes rather than never. A canceled investment
also drops out of the round's totals.

That budget matters: every data-room user shares the one company token, and a token gets 1,000
requests an hour ([rate limits](https://docs.wefunder.com/guides/rate-limiting)). One user
watching both a link and a session costs up to 120 requests an hour, so this design is
comfortable for a handful of people on the page at once. For more, lengthen `USER_TTL_MS`, or
refresh every user from the two list endpoints on a timer.

`lib/status.ts` marks where a webhook receiver would call in. Investment sessions already emit
`investment_session.completed`, `.canceled` and `.expired`; when member links emit events too,
both receivers write the same rows the poll writes and the poll becomes the fallback.

## When your Reg CF goes live

A company's rounds are separate offerings, each with its own `ofr_…` id, and the same install
covers all of them.

- **Point the data room at the new offering.** Set `WEFUNDER_OFFERING_ID` to the Reg CF
  offering's id. Each offering has its own links, so the same user ids, sent as the same
  `reference`s, mint new links there; nothing carries over from the private round and nothing
  needs migrating. `lib/store.ts` keys its rows by offering for this reason.
- **The public raise widget becomes usable.** A private round is invisible to a publishable key,
  which is why this example reads totals with the company's own token behind a login. Once the
  Reg CF is public, [Show Your Raise on Your Own Site](https://docs.wefunder.com/guides/raise-stats-widget)
  ([`raise-stats-widget`](../raise-stats-widget)) puts its numbers on a public page with no
  server and no token.

What you may say publicly about either round, and when, is a securities-law question and not
something this example answers. See the next section.

## Before you put this in front of investors

This is example code, not legal advice, and Wefunder does not recommend any offering.

- **A Rule 506(b) round allows no general solicitation.** Keep the raise totals and both invest
  buttons behind your login, as this example does, and give accounts only to people you are
  permitted to offer the round to. Investors self-certify that they are accredited when they
  invest on Wefunder.
- **A Rule 506(c) round permits general solicitation**, and investors must verify that they are
  accredited before investing, which happens on Wefunder at checkout.
- **Which rule your round uses, who may be given access, and what you may show or say before a
  Reg CF is filed are questions for your securities counsel and your Wefunder contact.** Ask
  them before you open the data room, and again before you change what it shows.

The [guide](https://docs.wefunder.com/guides/private-round-data-room#before-you-launch) says the
same in more detail.

## What this example simplifies

- **The login is a stub.** Fixture users in `lib/users.ts`, one shared `DEMO_PASSWORD`, a signed
  cookie. It exists so there is a login for the Wefunder calls to sit behind. Replace it and the
  user directory with your own before anyone else signs in.
- **One JSON file of state** (`.data/store.json`): each user's link id, session id and last
  state, per offering. Writes are queued inside one process, which is enough for `npm run dev`
  or a single `next start`. More than one instance needs a real table keyed on (your user id,
  offering id), and the one-minute caches in `lib/status.ts` become per-instance.
- **The investor's email comes from the fixture.** An investment session is addressed to an
  email, and Wefunder's checkout is for that person. Use an address the user has confirmed with
  you, never one typed into a form by whoever is signed in.
- **Documents are placeholders.** Serving files to signed-in users is your data room's own job.
- **No pre-binding.** Once a member link binds, its `wefunder_user_id` is saved; passing it when
  you mint that person's next link binds the new link up front. That option is enabled per app,
  so this example leaves it out ([Member Links](https://docs.wefunder.com/member-links)).
