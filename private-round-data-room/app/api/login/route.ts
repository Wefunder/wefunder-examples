// STUB LOGIN: check the shared password, set a signed cookie naming the fixture user.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_HOURS, passwordMatches, signSession } from "@/lib/auth.ts";
import { env } from "@/lib/env.ts";
import { findUser } from "@/lib/users.ts";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const user = findUser(String(form.get("user_id") ?? ""));
  if (!user || !passwordMatches(String(form.get("password") ?? ""), env.demoPassword)) {
    return NextResponse.redirect(new URL("/login?failed=1", req.url), 303);
  }
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(SESSION_COOKIE, signSession(user.id, env.sessionSecret), {
    httpOnly: true,
    // Lax: a form posted from another site arrives without the cookie, so it cannot press
    // Invest for a signed-in user.
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  return res;
}
