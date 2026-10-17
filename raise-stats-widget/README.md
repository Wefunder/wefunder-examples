# Raise stats widget (static HTML, publishable key)

One HTML page that shows a company's live Wefunder raise, amount raised, goal and investor
count, on the company's own site. No server, no build step, no SDK: the browser calls
`GET https://api.wefunder.com/companies/{id}` with the app's **publishable key**
(`pk_live_…`) as the bearer. The key reads public data only, so it is safe to ship in a page.
This is the page the [Show Your Raise on Your Own Site](https://docs.wefunder.com/guides/raise-stats-widget)
guide describes; `index.html` carries the guide's snippet unchanged.

## Run it

1. Create an app at <https://wefunder.com/developers> (no permissions or callback URL needed
   for public reads). The app page shows your publishable key and the `co_…` id of each
   company you can edit, with this snippet already filled in.
2. In `index.html`, set `WF_KEY` and `WF_COMPANY`.
3. Serve the file from any origin:

```bash
npm start            # http://localhost:4180 via `serve`
# or: python3 -m http.server 4180
```

Opening the file directly (`file://`) also works; `GET` requests to the API answer for any
origin, so there is no domain to register.

## What it shows

- Money comes back as integer cents (`amount_raised_cents`, `funding_target_cents`); the page
  divides by 100 to display. The dollar-string twins (`amount_raised`, `funding_target`) are
  still present but deprecated.
- A Testing-the-Waters round holds reservations, not investments, so the page says
  "reserved … reservations" when `testing_the_waters` is true and "raised … investors" otherwise.
- When `current_raise` is `null` (no round live right now) the page shows the lifetime total,
  `totals.raised_on_wefunder_all_time_cents`.
- Any failure leaves "See our raise on Wefunder" rather than a stuck "Loading…".

## Tests

```bash
npm test
```

`test/snippet.test.mjs` extracts the `<script>` from `index.html` and runs it against a mocked
`fetch`, so editing the page edits the code under test. It also fails if the snippet ever sends
cookies, touches a secret, or mints a token.

## Limits

The publishable key is rate-limited per key (300 requests per 5 minutes) and per IP. A static
page at any traffic stays far inside that; if you render the number on a hot server-side path,
cache it for a minute. See [Rate limits](https://docs.wefunder.com/concepts/rate-limiting).
