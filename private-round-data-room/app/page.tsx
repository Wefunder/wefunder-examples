// The data room. Everything here renders only for a signed-in data-room user: `requireUser()`
// runs before any Wefunder call. The raise totals and the two ways to invest come from Wefunder
// with the company's installation token, on the server.
import Link from "next/link";
import { env } from "@/lib/env.ts";
import { MESSAGES, describe, isErrorKey } from "@/lib/errors.ts";
import { formatMoney } from "@/lib/raise.ts";
import { requireUser, wefunder } from "@/lib/server.ts";
import { cachedRaise, userStatus } from "@/lib/status.ts";
import { InvestPanel } from "./invest_panel.tsx";

export const dynamic = "force-dynamic";

// Placeholders: a real data room serves its own files to its own signed-in users.
const DOCUMENTS = ["Investor deck", "Financial model", "Cap table summary", "Form of subscription agreement"];

export default async function DataRoom({ searchParams }: { searchParams: Promise<{ error?: string; checkout?: string }> }) {
  const user = await requireUser();
  const { error, checkout } = await searchParams;

  const [totals, status] = await Promise.all([cachedRaise(env.offeringId, wefunder()), userStatus(env.offeringId, user.id, wefunder())]);
  if (totals.error) console.error(`raise totals failed: ${describe(totals.error)}`);
  if (status.error) console.error(`status refresh for ${user.id} failed: ${describe(status.error)}`);
  const raise = totals.raise;

  return (
    <>
      <header className="topbar">
        <div>
          <h1>{env.companyName} data room</h1>
          <p className="sub">Private round. For invited investors only.</p>
        </div>
        <div className="right">
          <span className="muted">{user.name}</span>
          {user.role === "founder" && <Link className="btn" href="/admin">Who has invested</Link>}
          <form className="inline" method="post" action="/api/logout">
            <button className="btn btn-ghost" type="submit">Sign out</button>
          </form>
        </div>
      </header>

      {isErrorKey(error) && <div className="notice notice-danger">{MESSAGES[error]}</div>}
      {checkout === "success" && <div className="notice notice-success">Welcome back. Checking with Wefunder; the status below updates when your checkout is recorded.</div>}
      {checkout === "cancel" && <div className="notice">You left checkout before finishing. You can pick it up again below.</div>}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>The round so far</h2>
            <p className="meta">From Wefunder, refreshed about once a minute.{totals.stale && raise ? " Showing the last figures read." : ""}</p>
          </div>
        </div>
        <div className="card-body">
          {raise ? (
            <div className="stats">
              <div className="stat lead">
                <div className="label">Raised</div>
                <div className="value">{formatMoney(raise.raisedCents, raise.currency)}</div>
              </div>
              <div className="stat">
                <div className="label">Investments</div>
                <div className="value">{raise.investments}</div>
              </div>
            </div>
          ) : (
            <div className="notice notice-warn">The round&apos;s totals are not available right now.</div>
          )}
        </div>
      </section>

      {user.role === "investor" && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Invest</h2>
              <p className="meta">Investing happens on Wefunder, which handles your account, identity checks, documents and payment.</p>
            </div>
          </div>
          <div className="card-body">
            <InvestPanel
              initial={{ link: status.record.linkState ?? null, session: status.record.sessionStatus ?? null, watching: status.watching, stale: Boolean(status.error) }}
              justReturned={checkout === "success" || checkout === "cancel"}
              sessionsEnabled={env.checkoutSessions}
              email={user.email}
            />
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Documents</h2>
            <p className="meta">Placeholders. Your data room serves its own files here.</p>
          </div>
        </div>
        <div className="card-body">
          <ul className="docs">
            {DOCUMENTS.map((name) => (
              <li key={name}>
                <span>{name}</span>
                <span className="muted">placeholder</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
