// The member-facing side: the portal a syndicate's members see. One card per deal; "Invest" goes
// through /api/invest, which mints (or re-finds) this member's link and sends them to Wefunder.
import { cookies } from "next/headers";
import { env } from "@/lib/env.ts";
import { members, currentMember, MEMBER_COOKIE } from "@/lib/members.ts";
import { describeErrorKey } from "@/lib/member_links.ts";

export const dynamic = "force-dynamic";

export default async function Portal({ searchParams }: { searchParams: Promise<{ error?: string; offering?: string }> }) {
  const { error, offering: failedOffering } = await searchParams;
  const member = currentMember((await cookies()).get(MEMBER_COOKIE)?.value);
  const offerings = env.offerings;

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Member portal</h1>
          <p className="sub">Reference Wefunder integration · each member gets their own <a href="https://docs.wefunder.com/partner-api/spvs/member-links">member link</a> per deal, minted server-side with your install token.</p>
        </div>
        <div className="right">
          <form className="inline" action="/api/member" method="post">
            <label className="t3" htmlFor="member" style={{ marginRight: 6 }}>Signed in as</label>
            <select id="member" name="member" defaultValue={member.id} className="select">
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>{" "}
            <button type="submit" className="btn btn-sm">Switch</button>
          </form>
          <a href="/admin" className="btn">Admin</a>
        </div>
      </header>

      <p className="t2" style={{ margin: 0 }}>
        <strong style={{ color: "var(--fg)" }}>{member.name}</strong> · reference <code>{member.id}</code>
        {member.wefunder_user_id
          ? <> · links pre-bound to <code>{member.wefunder_user_id}</code></>
          : <> · no Wefunder account on file: the link binds to whichever account first invests through it</>}
      </p>

      {error && (
        <div className="callout callout-warn" role="alert">
          <span><strong>Couldn&apos;t open that deal{failedOffering ? <> (<span className="mono">{failedOffering}</span>)</> : null}.</strong> {describeErrorKey(error)}</span>
        </div>
      )}

      {offerings.length === 0 ? (
        <div className="empty" style={{ padding: 40 }}>
          <strong>No deals configured.</strong><br />
          Set <code>WEFUNDER_OFFERING_IDS</code> to the <code>ofr_…</code> ids of offerings your install can reach.
        </div>
      ) : (
        <div className="deals">
          {offerings.map((o) => (
            <section key={o.id} className="card deal">
              <div className="card-head">
                <div>
                  <h2>{o.label}</h2>
                  <p className="meta"><span className="mono">{o.id}</span></p>
                </div>
              </div>
              <div className="card-body">
                <p className="t3" style={{ marginTop: 0 }}>Opens the deal page on Wefunder with an invitation for {member.name}: private-round access and invited pricing, for the account that invests through it.</p>
                <form action="/api/invest" method="post">
                  <input type="hidden" name="offering" value={o.id} />
                  <button type="submit" className="btn btn-primary">Invest</button>
                </form>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
