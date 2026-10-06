// Download the founder Investor CSV rebuilt from this company's mirrored records, for diffing
// against the one from wefunder.com (Manage Investments → Download CSV).
import { NextResponse, type NextRequest } from "next/server";
import { load } from "@/lib/store.ts";
import { founderCsv } from "@/lib/founder_csv.ts";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await load();
  const company = s.companies[id];
  if (!company) return NextResponse.json({ error: "unknown company" }, { status: 404 });
  const slug = company.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return new NextResponse(founderCsv(Object.values(company.records)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="manage_investments_${slug}.csv"`,
    },
  });
}
