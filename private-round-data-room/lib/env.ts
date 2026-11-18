// Every setting the example needs, read once, on the server. `server-only` makes the build fail
// if a Client Component ever imports this file, so the installation token cannot be bundled for
// the browser by accident (`npm run check:bundle` looks at the built output as well).
import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set: copy .env.example to .env.local and fill it in`);
  return v;
}

// `||`, not `??`: a variable that exists but is EMPTY (easy to do in a hosting dashboard) must
// fall back too.
const optional = (name: string) => process.env[name] || undefined;

export const env = {
  // The company-owned installation token. Never sent to the browser, never logged.
  get installToken() { return required("WEFUNDER_INSTALL_TOKEN"); },
  // The private round this data room is for.
  get offeringId() { return required("WEFUNDER_OFFERING_ID"); },
  get sessionSecret() { return required("SESSION_SECRET"); },

  demoPassword: optional("DEMO_PASSWORD"),
  companyName: process.env.DATA_ROOM_COMPANY_NAME || "Example Co",

  // Where an investment session sends the investor back to. Its origin must be registered as one
  // of the app's OAuth redirect URIs, or Wefunder refuses the session with 422 validation_error.
  dataRoomUrl: (process.env.DATA_ROOM_URL || "http://localhost:3000").replace(/\/+$/, ""),

  // Member links are generally available; investment sessions are in beta. "off" hides them.
  checkoutSessions: (process.env.WEFUNDER_CHECKOUT_SESSIONS || "on") !== "off",

  // Leave unset. api.wefunder.com routes sandbox and live by the token's prefix.
  apiBase: optional("WEFUNDER_API_BASE"),
};
