// The demo's stand-in for login: pick which fixture member you are.
import { NextResponse, type NextRequest } from "next/server";
import { members, MEMBER_COOKIE } from "@/lib/members.ts";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const id = String(form.get("member") ?? "");
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  if (members.some((m) => m.id === id)) {
    res.cookies.set(MEMBER_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/" });
  }
  return res;
}
