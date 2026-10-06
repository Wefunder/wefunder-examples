// Revoke our install on a company (DELETE /installations/{id}); Wefunder revokes every token
// minted for it. We drop the mirror: the records belonged to the install.
import { NextResponse, type NextRequest } from "next/server";
import { revoke } from "@/lib/wefunder.ts";
import { load, save, log } from "@/lib/store.ts";
import { withStaff } from "@/lib/installs.ts";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await load();
  const company = s.companies[id];
  if (!company) return NextResponse.json({ error: "unknown company" }, { status: 404 });
  try {
    await withStaff(s, (wf) => revoke(wf, company.installation_id));
    delete s.companies[id];
    log(s, `revoked install on ${company.name}; dropped ${Object.keys(company.records).length} mirrored records`);
  } catch (e) {
    log(s, `revoke on ${company.name} failed: ${(e as Error).message}`);
  }
  await save(s);
  return NextResponse.redirect(new URL("/", req.url), 303);
}
