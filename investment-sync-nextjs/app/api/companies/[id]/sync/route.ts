// Sync one installed company with its company-owned token, then deliver any money-feed lines.
import { NextResponse, type NextRequest } from "next/server";
import { WefunderError } from "@wefunder/sdk";
import { syncCompany } from "@/lib/installs.ts";
import { drain } from "@/lib/notify.ts";
import { env } from "@/lib/env.ts";
import { load, save, log } from "@/lib/store.ts";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await load();
  const company = s.companies[id];
  if (!company) return NextResponse.json({ error: "unknown company" }, { status: 404 });
  let result: unknown = null;
  let error: string | null = null;
  try {
    result = await syncCompany(s, company);
    await drain(s, env.slackWebhookUrl);
  } catch (e) {
    error = e instanceof WefunderError ? `${e.status} ${e.type}: ${e.message}${e.requestId ? ` (request ${e.requestId})` : ""}` : (e as Error).message;
    log(s, `${company.name}: sync failed: ${error}`);
  }
  await save(s);
  const wantsHtml = (req.headers.get("accept") ?? "").includes("text/html");
  if (wantsHtml) return NextResponse.redirect(new URL(error ? "/?sync=failed" : "/?sync=ok", req.url), 303);
  return error ? NextResponse.json({ error }, { status: 502 }) : NextResponse.json(result);
}

export const GET = POST;
