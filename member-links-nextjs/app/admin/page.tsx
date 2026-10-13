// The staff side: every member link this install minted, per deal, read live from Wefunder
// (GET /offerings/{id}/member_links, following next_cursor). Nothing is stored here; state,
// wefunder_user_id and investment_id are Wefunder's current answer.
import { env } from "@/lib/env.ts";
import { memberLinks } from "@/lib/client.ts";
import { members } from "@/lib/members.ts";
import { describeErrorKey, errorKey, type MemberLink } from "@/lib/member_links.ts";

export const dynamic = "force-dynamic";

const STATE_CHIP: Record<MemberLink["attributes"]["state"], string> = {
  created: "chip-neutral",
  bound: "chip-info",
  invested: "chip-success",
  canceled: "chip-danger",
};

const memberName = (reference: string | null) => members.find((m) => m.id === reference)?.name ?? null;

async function loadOffering(id: string): Promise<{ links: MemberLink[]; error: string | null }> {
  try {
    return { links: await memberLinks().listAll(id), error: null };
  } catch (e) {
    console.error(`listing member links on ${id} failed:`, e);
    return { links: [], error: errorKey(e) };
  }
}

export default async function Admin({ searchParams }: { searchParams: Promise<{ canceled?: string; state?: string; error?: string }> }) {
  const { canceled, state, error } = await searchParams;
  const offerings = env.offerings;
  const results = await Promise.all(offerings.map((o) => loadOffering(o.id)));

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Member links</h1>
          <p className="sub">Every link this install minted, read live from Wefunder. Responses carry Wefunder ids only, never a member&apos;s email.</p>
        </div>
        <div className="right"><a href="/" className="btn">Member portal</a></div>
      </header>

      {canceled && <div className="callout callout-info">Canceled <span className="mono">{canceled}</span>{state ? <> · state is now <strong>{state}</strong></> : null}.</div>}
      {error && <div className="callout callout-warn" role="alert">{describeErrorKey(error)}</div>}

      {offerings.length === 0 && <div className="empty"><strong>No deals configured.</strong> Set <code>WEFUNDER_OFFERING_IDS</code>.</div>}

      {offerings.map((o, i) => {
        const { links, error: listError } = results[i];
        return (
          <section key={o.id} className="card">
            <div className="card-head">
              <div>
                <h2>{o.label}</h2>
                <p className="meta"><span className="mono">{o.id}</span><span>·</span><span>{links.length} link{links.length === 1 ? "" : "s"}</span></p>
              </div>
            </div>
            <div className="card-body">
              {listError ? (
                <div className="callout callout-warn">{describeErrorKey(listError)}</div>
              ) : links.length === 0 ? (
                <div className="empty">No member links yet. One is minted the first time a member clicks <em>Invest</em> on this deal.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Link</th><th>State</th><th>Reference</th><th>Wefunder user</th><th>Investment</th><th>Created</th><th /></tr></thead>
                    <tbody>
                      {links.map((l) => {
                        const a = l.attributes;
                        const name = memberName(a.reference);
                        return (
                          <tr key={l.id}>
                            <td className="mono">{l.id}</td>
                            <td><span className={`chip ${STATE_CHIP[a.state] ?? "chip-neutral"}`}>{a.state}</span></td>
                            <td><span className="mono">{a.reference ?? "—"}</span>{name && <span className="t3"> · {name}</span>}</td>
                            <td className="mono t2">{a.wefunder_user_id ?? "—"}</td>
                            <td className="mono t2">{a.investment_id ?? "—"}</td>
                            <td className="t3">{new Date(a.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td>
                            <td className="num">
                              {a.state === "canceled" || a.state === "invested" ? null : (
                                <form className="inline" action={`/api/member_links/${encodeURIComponent(l.id)}/cancel`} method="post">
                                  <button type="submit" className="btn btn-sm btn-ghost btn-danger" title="Retract the invitation. Releases a pre-bound account if nobody invested through it.">Cancel</button>
                                </form>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}
