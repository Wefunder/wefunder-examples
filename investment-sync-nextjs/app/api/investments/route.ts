// What this integration currently holds: the partner-side mirror per installed company.
import { NextResponse } from "next/server";
import { load } from "@/lib/store.ts";

export async function GET() {
  const s = await load();
  return NextResponse.json(Object.values(s.companies).map((c) => ({
    company: c.id, name: c.name, installation: c.installation_id, identity: c.identity, disconnected: c.disconnected,
    count: Object.keys(c.records).length, cursor: c.sync.cursor, published_through: c.sync.published_through, records: Object.values(c.records),
  })));
}
