// The founder's view: every data-room user, and what each did on Wefunder.
//
// Two list calls cover the whole round (one request per page of results), instead of one read
// per user: `GET /offerings/{id}/member_links` and `GET /offerings/{id}/investment_sessions`.
// Rows are matched to your users by the `reference` you minted each link with, and by the email
// each session was addressed to. Wefunder's responses carry its own ids only, never an email
// for a member link.
import Link from "next/link";
import { env } from "@/lib/env.ts";
import { MESSAGES, describe, errorKey } from "@/lib/errors.ts";
import { formatMoney } from "@/lib/raise.ts";
import { requireFounder, wefunder } from "@/lib/server.ts";
import { linkShown, sessionShown } from "@/lib/states.ts";
import { cachedRaise } from "@/lib/status.ts";
import { investors } from "@/lib/users.ts";
import { listCheckoutSessions, listMemberLinks, type CheckoutSessionView, type MemberLinkView } from "@/lib/wefunder.ts";

export const dynamic = "force-dynamic";

export default async function Admin() {
  await requireFounder();

  const totals = await cachedRaise(env.offeringId, wefunder());
  let links: MemberLinkView[] = [];
  let sessions: CheckoutSessionView[] = [];
  let failure: string | null = null;
  try {
    [links, sessions] = await Promise.all([
      listMemberLinks(env.offeringId, wefunder()),
      env.checkoutSessions ? listCheckoutSessions(env.offeringId, wefunder()) : Promise.resolve([]),
    ]);
  } catch (e) {
    console.error(`founder view failed: ${describe(e)}`);
    failure = MESSAGES[errorKey(e, "member_link")];
  }

  // Lists are newest first, so the first match is the user's current link or session.
  const linkFor = (userId: string) => links.find((l) => l.reference === userId);
  const sessionFor = (email: string) => sessions.find((s) => s.email?.toLowerCase() === email.toLowerCase());
  const raise = totals.raise;

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Who has invested</h1>
          <p className="sub">{env.companyName} private round, as Wefunder reports it now.</p>
        </div>
        <div className="right">
          <Link className="btn" href="/">Back to the data room</Link>
        </div>
      </header>

      {failure && <div className="notice notice-danger">{failure}</div>}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Data-room users</h2>
            <p className="meta">A user with no link has not pressed Invest yet.</p>
          </div>
        </div>
        <div className="card-body">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Your id (the link&apos;s reference)</th>
                <th>Round page (member link)</th>
                {env.checkoutSessions && <th>Checkout (investment session)</th>}
                <th>Investment</th>
              </tr>
            </thead>
            <tbody>
              {investors().map((u) => {
                const link = linkFor(u.id);
                const session = sessionFor(u.email);
                const linkChip = linkShown(link?.state);
                const sessionChip = sessionShown(session?.status);
                return (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td><code>{u.id}</code></td>
                    <td><span className={`chip chip-${linkChip.tone}`}>{linkChip.label}</span></td>
                    {env.checkoutSessions && <td><span className={`chip chip-${sessionChip.tone}`}>{sessionChip.label}</span></td>}
                    <td>{link?.investmentId || session?.investmentId ? <code>{link?.investmentId ?? session?.investmentId}</code> : <span className="muted">none</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Totals by status</h2>
            <p className="meta">
              <code>GET /offerings/{"{id}"}/stats</code>: the sums over the investment records your company can list for this round.
            </p>
          </div>
        </div>
        <div className="card-body">
          {raise && raise.byStatus.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th className="num">Investments</th>
                  <th className="num">Committed</th>
                  <th className="num">Raised</th>
                </tr>
              </thead>
              <tbody>
                {raise.byStatus.map((r) => (
                  <tr key={r.status}>
                    <td>{r.status}</td>
                    <td className="num">{r.count}</td>
                    <td className="num">{formatMoney(r.committedCents, raise.currency)}</td>
                    <td className="num">{formatMoney(r.raisedCents, raise.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="notice">{raise ? "No investments yet." : "The round's totals are not available right now."}</div>
          )}
        </div>
      </section>
    </>
  );
}
