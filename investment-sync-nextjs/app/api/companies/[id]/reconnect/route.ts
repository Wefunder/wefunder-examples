// A human decided to reconnect a company its founder had disconnected: clear the flag and drop the
// stale token. The next Install or Discover may then act on it. This is deliberately a separate
// click from installing, so a founder's removal is never undone by a loop.
import { NextResponse, type NextRequest } from "next/server";
import { load, save, log } from "@/lib/store.ts";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await load();
  const company = s.companies[id];
  if (!company) return NextResponse.json({ error: "unknown company" }, { status: 404 });
  company.disconnected = null;
  company.token = null;
  log(s, `${company.name}: cleared the disconnected flag after speaking with the founder; install again from Connection`);
  await save(s);
  return NextResponse.redirect(new URL("/", req.url), 303);
}
