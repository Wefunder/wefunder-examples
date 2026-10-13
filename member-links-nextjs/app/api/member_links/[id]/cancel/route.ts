// Admin "Cancel": POST /member_links/{id}/cancel. Idempotent. A link nobody invested through is
// released from any account it was bound to; one an investment went through keeps state invested.
import { NextResponse, type NextRequest } from "next/server";
import { memberLinks } from "@/lib/client.ts";
import { errorKey } from "@/lib/member_links.ts";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const link = await memberLinks().cancel(id);
    return NextResponse.redirect(new URL(`/admin?canceled=${encodeURIComponent(link.id)}&state=${encodeURIComponent(link.attributes.state)}`, req.url), 303);
  } catch (e) {
    console.error(`cancel ${id} failed:`, e);
    return NextResponse.redirect(new URL(`/admin?error=${encodeURIComponent(errorKey(e))}`, req.url), 303);
  }
}
