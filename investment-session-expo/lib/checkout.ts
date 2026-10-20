import * as WebBrowser from "expo-web-browser";
import { RETURN_URL, outcomeFromAuthSession } from "./return_url.ts";

// Opens the hosted page in a SYSTEM browser sheet: ASWebAuthenticationSession on iOS (shares
// Safari's cookies, so an investor already signed in to Wefunder skips login, and closes itself
// when the page navigates to our scheme) and Custom Tabs on Android. Never a WebView: the hosted
// page asks for a Wefunder password, passkey, Google/Apple sign-in and bank details, and must
// open only where this app cannot read or change what the investor types.
export async function openCheckout(sessionUrl: string) {
  const result = await WebBrowser.openAuthSessionAsync(sessionUrl, RETURN_URL);
  return outcomeFromAuthSession(result);
}
