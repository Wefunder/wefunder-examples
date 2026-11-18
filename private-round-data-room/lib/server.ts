// The server-side glue: who is signed in, and the Wefunder credentials. `server-only`, like
// lib/env.ts, so none of this can be imported into a Client Component.
//
// THE RULE THIS FILE EXISTS FOR: nothing about the round (totals, links, sessions) is rendered
// or returned without a signed-in data-room user. Every page calls `requireUser()` or
// `requireFounder()` first, and every route handler checks `currentUser()` first.
// test/gate.test.ts fails if a new page or route forgets.
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession } from "./auth.ts";
import { env } from "./env.ts";
import { findUser, type DataRoomUser } from "./users.ts";
import type { Deps } from "./wefunder.ts";

export async function currentUser(): Promise<DataRoomUser | null> {
  const jar = await cookies();
  return findUser(verifySession(jar.get(SESSION_COOKIE)?.value, env.sessionSecret));
}

export async function requireUser(): Promise<DataRoomUser> {
  return (await currentUser()) ?? redirect("/login");
}

export async function requireFounder(): Promise<DataRoomUser> {
  const user = await requireUser();
  return user.role === "founder" ? user : redirect("/");
}

// The company-owned installation token, for calls made on the server.
export const wefunder = (): Deps => ({ token: env.installToken, apiBase: env.apiBase });
