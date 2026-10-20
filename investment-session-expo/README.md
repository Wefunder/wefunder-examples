# Investment session on mobile (Expo + a Node companion server)

A small Expo app that does what the
[mobile guide](https://docs.wefunder.com/guides/investment-sessions-mobile) describes: list an
offering, tap **Invest**, and send the investor through Wefunder's hosted checkout in a **system
browser sheet**, then get them back into the app and show what happened.

```
phone (Expo)                       server/ (Node)                       Wefunder
────────────                       ──────────────                       ────────
GET /offerings ───────────────────▶ wf.offerings.get(id) ─────────────▶ GET /offerings/{id}
tap Invest
POST /sessions {offering, email} ─▶ wf.investmentSessions.create ─────▶ POST /offerings/{id}/investment_sessions
◀── { id, url } ───────────────────◀── { data: { id, attributes.url } }
openAuthSessionAsync(url) ─────────────────────────────────────────────▶ hosted checkout
◀── wefunderexample://invest/return?result=success|cancel ─────────────◀
GET /sessions/:id ────────────────▶ wf.investmentSessions.get ────────▶ GET /investment_sessions/{id}
◀── { status, investment_id }
```

Two rules from the guide shape the layout:

- **The token that mints sessions stays on a server.** The app never holds it; it talks only to
  `server/`, which holds the install token and calls Wefunder with `@wefunder/sdk`.
- **The hosted page opens only where the app cannot read what the investor types.** The app uses
  `expo-web-browser`'s `openAuthSessionAsync`, which is `ASWebAuthenticationSession` on iOS and
  Custom Tabs on Android. There is no `react-native-webview` here, and there must not be: the
  guide's supported-surfaces table lists `WKWebView`, `UIWebView` and Android `WebView` as
  **Not supported**, because "the app that hosts a web view can read and inject into the page, so
  the investor's Wefunder password and bank login would pass through a surface you control",
  Google refuses OAuth inside embedded web views, and bank linking does not hand off reliably
  from one.

## Setup

1. **Create an app** in the [developer portal](https://docs.wefunder.com/getting-started/authentication)
   and tick `write:investment_sessions` and `read:investment_sessions`. Tick `read:public` too if
   you want company names in the list (without it the list shows bare offering ids; minting still
   works).
2. **Register the return scheme as a redirect URI** on the app's keys:
   `wefunderexample://invest/return`. `success_url` and `cancel_url` must use an origin or custom
   scheme one of the app's redirect URIs uses, or the mint is refused with `422 validation_error`.
   The sandbox and live keys share the list. Register only schemes you control: a redirect URI
   also receives OAuth authorization codes.
3. **Install the app on the company** (or syndicate) that runs the offering, then **mint an
   installation token** on the Installations page
   ([how](https://docs.wefunder.com/getting-started/install)). Use a sandbox token first.
4. **Configure and start the server:**

   ```bash
   cd server
   cp .env.example .env            # WEFUNDER_INSTALL_TOKEN, WEFUNDER_OFFERING_IDS, RETURN_URL
   npm install
   npm start                       # http://0.0.0.0:4181
   npm test                        # mint handler against a mocked fetch, no network
   ```

5. **Configure and start the app** (from this directory):

   ```bash
   cp .env.example .env            # EXPO_PUBLIC_SERVER_URL, reachable from the phone
   npm install
   npx expo run:ios                # or: npx expo run:android
   npm test                        # return-URL handling, in plain Node
   ```

   A custom scheme needs a **development build** (`expo run:ios` / `run:android`, or an EAS
   build): Expo Go cannot register `wefunderexample://`, so a return from the hosted page would
   not reach the app there. `npx expo start` then serves the JS to that build.

6. Test on a real phone, both legs. The guide's note applies: simulators and emulators do not
   always hand a custom scheme back to the app the way a device does.

## What to read

```
App.tsx                 the screen: offerings list, email, Invest → mint → open → confirm → show
lib/checkout.ts         openAuthSessionAsync(url, RETURN_URL): the only place the page is opened
lib/return_url.ts       the return URL scheme and its parser (pure; tested in Node)
lib/server.ts           the three calls to the companion server
server/lib/mint.ts      wf.investmentSessions.create with both return URLs and an Idempotency-Key
server/lib/app.ts       GET /offerings · POST /sessions · GET /sessions/:id, as a pure handler
server/server.ts        node:http wrapper, no framework
test/, server/test/     run in CI without a device, Metro, or network
```

### The return URL

Both URLs point at one place and differ by a query parameter, because `ASWebAuthenticationSession`
watches a single scheme:

```
success_url = wefunderexample://invest/return?result=success
cancel_url  = wefunderexample://invest/return?result=cancel
```

On cancel, Wefunder appends `session_id` and `reason` (`user_canceled`, `user_left`, `canceled`
or `expired`); the URL is hierarchical (`scheme://host/path`) so it can carry them. `user_left`
means the session is still live and the same `url` can be reopened.

The app treats the return as a hint, not proof, since anything on the device can open its scheme.
After the sheet closes, for any reason, it asks the server for the session's status, which the
server reads with the install token (`GET /investment_sessions/{id}`). A closed sheet with no
return (`cancel` / `dismiss` from `openAuthSessionAsync`) is handled the same way.

## What this example simplifies

- **No authentication on the companion server, and the investor types their email.** A production
  backend authenticates its own app user, takes `email` or `wefunder_user_id` from that account,
  and never mints for an address a caller supplies.
- **The outcome is read by polling once.** A production backend learns it from the
  `investment_session.completed` / `.canceled` / `.expired`
  [webhooks](https://docs.wefunder.com/partner-api/webhooks/events) and keeps its own record; the
  app asks that backend, never Wefunder.
- **A fresh idempotency key per request.** A backend that retries keys on its own checkout
  attempt so a replay returns the same session.
- **Offerings are a list of ids in `.env`**, read with the install token; a product would list the
  deals its own catalogue knows about.
- **The return scheme is a custom scheme.** An iOS universal link or Android app link (an `https`
  URL on a registered redirect URI's origin) is the same flow with a verified domain, and is what
  a shipped app should use.
