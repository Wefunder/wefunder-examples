// The one place the app builds an API client: the install token from the server's environment.
// Route handlers and server components import this; nothing under app/ marked "use client" may.
import { createClient } from "./member_links.ts";
import { env } from "./env.ts";

export function memberLinks() {
  return createClient({ accessToken: env.accessToken, apiBase: env.apiBase });
}
