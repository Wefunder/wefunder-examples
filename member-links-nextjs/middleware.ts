// The admin view lists every member link and can cancel them, and every page acts with the
// install token, so the demo is not left open on a public URL. HTTP basic auth with
// DEMO_PASSWORD. Nothing here receives callbacks from Wefunder, so nothing is exempt.
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return NextResponse.next(); // local development without a password set

  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [, pass = ""] = atob(encoded).split(":");
    if (pass === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Wefunder example"' } });
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
