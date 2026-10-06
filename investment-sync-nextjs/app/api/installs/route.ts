// Dashboard actions on installs: list eligible companies (GET) and install on one (POST).
import { NextResponse, type NextRequest } from "next/server";
import { load, save, log } from "@/lib/store.ts";
import { eligibleCompanies, installCompany, syncCompany } from "@/lib/installs.ts";
import { drain } from "@/lib/notify.ts";
import { env } from "@/lib/env.ts";

export async function GET() {
  const s = await load();
  if (!s.user) return NextResponse.json({ error: "connect a user first" }, { status: 409 });
  const data = await eligibleCompanies(s);
  await save(s);
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const companyId = String(form.get("company") ?? "");
  const s = await load();
  let error: string | null = null;
  try {
    const company = await installCompany(s, companyId);
    // First pull right away (guide, Step 3) so the dashboard shows records, not an empty card.
    try { await syncCompany(s, company); await drain(s, env.slackWebhookUrl); } catch (e) { log(s, `${company.name}: first sync failed: ${(e as Error).message}`); }
  } catch (e) {
    error = (e as Error).message;
    log(s, `install on ${companyId} failed: ${error}`);
  }
  await save(s);
  return NextResponse.redirect(new URL(error ? `/?install=failed` : `/?install=ok`, req.url), 303);
}
