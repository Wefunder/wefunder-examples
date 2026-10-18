// The return leg of a hosted investment session, with no React Native imports so it can be
// unit-tested in plain Node (`npm test`).
//
// Both return URLs point at ONE place and differ only by a query parameter, because
// ASWebAuthenticationSession watches a single scheme (see "One callback for both" in
// https://docs.wefunder.com/guides/investment-sessions-mobile). The scheme is the one
// `app.json` registers (`expo.scheme`) and must also be on the app's OAuth redirect URIs in the
// developer portal, or the mint is refused with 422.

export const APP_SCHEME = "wefunderexample";

// Hierarchical form (`scheme://host/path`), never `scheme:opaque`: Wefunder appends
// `session_id` and `reason` to cancel_url, which an opaque URL cannot carry.
export const RETURN_URL = `${APP_SCHEME}://invest/return`;

export type ReturnOutcome =
  | { kind: "success" }
  | { kind: "cancel"; sessionId: string | null; reason: string | null }
  | { kind: "unrelated" };

export function returnUrls(base: string = RETURN_URL): { successUrl: string; cancelUrl: string } {
  return { successUrl: `${base}?result=success`, cancelUrl: `${base}?result=cancel` };
}

// Classifies the URL the browser sheet handed back. Anything on the device can open the app's
// scheme, so this is a hint about which leg the investor came back on, never proof that an
// investment exists: the app confirms with the server (`GET /sessions/:id`), which reads the
// session's status with the install token.
export function parseReturnUrl(url: string, base: string = RETURN_URL): ReturnOutcome {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "unrelated" };
  }
  const expected = new URL(base);
  if (parsed.protocol !== expected.protocol || parsed.host !== expected.host || parsed.pathname !== expected.pathname) {
    return { kind: "unrelated" };
  }
  switch (parsed.searchParams.get("result")) {
    case "success":
      return { kind: "success" };
    case "cancel":
      // `reason` is user_canceled, user_left, canceled or expired. `user_left` means the session
      // is still live: the investor can reopen the same url later.
      return { kind: "cancel", sessionId: parsed.searchParams.get("session_id"), reason: parsed.searchParams.get("reason") };
    default:
      return { kind: "unrelated" };
  }
}

// The shape `expo-web-browser`'s openAuthSessionAsync resolves with: `success` carries the
// return URL; `cancel` and `dismiss` mean the investor closed the sheet before the page reached
// it (the session is then still live until it completes or expires).
export type AuthSessionResult = { type: "success"; url: string } | { type: "cancel" | "dismiss" | "opened" | "locked" };

export function outcomeFromAuthSession(result: AuthSessionResult, base: string = RETURN_URL): ReturnOutcome | { kind: "closed" } {
  if (result.type === "success") return parseReturnUrl(result.url, base);
  return { kind: "closed" };
}
