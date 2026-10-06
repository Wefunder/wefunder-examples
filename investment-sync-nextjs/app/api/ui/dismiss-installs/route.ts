// Hide the "companies you edit aren't installed yet" callout. The cookie remembers WHICH set of
// companies was dismissed, so a new eligible company brings the callout back once.
import { NextResponse, type NextRequest } from "next/server";
import { DISMISS_COOKIE } from "@/lib/dismiss.ts";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const key = String(form.get("key") ?? "");
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(DISMISS_COOKIE, key, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  return res;
}
