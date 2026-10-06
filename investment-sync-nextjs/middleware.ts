// The dashboard and the mirror JSON show investor names and emails once the install grants PII,
// so the demo is not left open on a public URL. HTTP basic auth with DEMO_PASSWORD; Wefunder's
// own callbacks (webhooks, OAuth redirect, setup URL) must stay reachable and are exempt.
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return NextResponse.next(); // local development without a password set
  if (req.nextUrl.pathname.startsWith("/api/wefunder/")) return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [, pass = ""] = atob(encoded).split(":");
    if (pass === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Wefunder example"' } });
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
