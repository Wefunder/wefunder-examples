// Every setting the example needs, read once. Missing OAuth credentials fail loudly at the
// first use rather than producing a confusing redirect to Wefunder.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — copy .env.example to .env.local and fill it in`);
  return v;
}

// `||`, not `??`: a variable that exists but is EMPTY (easy to do in a hosting dashboard) must
// fall back too.
const optional = (name: string) => process.env[name] || undefined;

export const PII_SCOPE = "read:investors:pii";

export const env = {
  get clientId() { return required("WEFUNDER_CLIENT_ID"); },
  get clientSecret() { return required("WEFUNDER_CLIENT_SECRET"); },
  get redirectUri() { return required("WEFUNDER_REDIRECT_URI"); },
  get webhookSecret() { return required("WEFUNDER_WEBHOOK_SECRET"); },

  // Leave unset in production. The SDK picks the sandbox consent host automatically for a
  // pk_test_ client id; these exist for pointing at a non-standard deployment.
  apiBase: optional("WEFUNDER_API_BASE"),
  oauthBase: optional("WEFUNDER_OAUTH_BASE"),

  // What the connected STAFF user's token needs: list eligible companies, install, mint, revoke.
  // It never reads investments; the company-owned tokens do.
  userScopes: ["read:installations", "write:installations", "read:profile"],

  // What each install asks for. The server grants the intersection of this and what the app
  // holds, silently: `lib/installs.ts` reads the GRANTED set back and flags a company whose
  // install carries no identity access.
  installScopes: (process.env.WEFUNDER_INSTALL_SCOPES || `read:investments read:offerings ${PII_SCOPE}`).split(/\s+/).filter(Boolean),

  // Optional Slack incoming webhook for the money feed (guide, Step 6). Without it the feed is
  // only shown on the dashboard.
  slackWebhookUrl: optional("SLACK_WEBHOOK_URL"),
};
