import { EPHEMERAL, load, type CompanyState } from "@/lib/store.ts";
import { summarize, fmtMoney } from "@/lib/summary.ts";
import RecordRow from "./record_row.tsx";
import { SessionExpired, eligibleCompanies } from "@/lib/installs.ts";
import { env, PII_SCOPE } from "@/lib/env.ts";
import { cookies } from "next/headers";
import { DISMISS_COOKIE, dismissKey } from "@/lib/dismiss.ts";

export const dynamic = "force-dynamic";

// "2m ago", "3h ago", "yesterday", else a date. Server-rendered, so "now" is request time.
function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 172800) return "yesterday";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const short = (id: string, keep = 10) => (id.length > keep + 1 ? `${id.slice(0, keep)}…` : id);

function Stat({ label, cents, currency, lead, note }: { label: string; cents: number; currency: string; lead?: boolean; note?: string }) {
  return (
    <div className={`stat${lead ? " lead" : ""}`}>
      <div className="label">{label}</div>
      <div className={`value${cents ? "" : " dim"}`}>{fmtMoney(cents, currency)}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

function CompanyCard({ c }: { c: CompanyState }) {
  const records = Object.values(c.records);
  const t = summarize(records);
  const shown = [...records].sort((a, b) => String(b.observed_at ?? "").localeCompare(String(a.observed_at ?? ""))).slice(0, 50);
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{c.name}</h2>
          <p className="meta">
            <span className="mono">{c.id}</span>
            <span>·</span>
            <span className="mono">{c.installation_id}</span>
            <span>·</span>
            <span>installed as {c.tier}</span>
            <span>·</span>
            <span>{c.token ? "company token held" : "no token yet"}</span>
            {!c.identity && <><span>·</span><span className="chip chip-warn" title={`The install does not carry ${PII_SCOPE}; records have no names or emails. Add the scope to the app, then revoke and install again.`}>no identity access</span></>}
            {c.disconnected && <><span>·</span><span className="chip chip-danger" title={c.disconnected.reason}>disconnected {ago(c.disconnected.at)}</span></>}
            <span>·</span>
            <span title={c.sync.last_synced_at ?? ""}>synced {ago(c.sync.last_synced_at)}</span>
          </p>
        </div>
        <div className="actions">
          {c.disconnected
            ? <form className="inline" action={`/api/companies/${c.id}/reconnect`} method="post"><button type="submit" className="btn btn-sm" title="Only after speaking with the founder: clears the flag so Install / Discover may act again">Reconnect</button></form>
            : <form className="inline" action={`/api/companies/${c.id}/sync`} method="post"><button type="submit" className="btn btn-sm">Sync now</button></form>}
          <a href={`/api/companies/${c.id}/csv`} className="btn btn-sm">Download CSV</a>
          <form className="inline" action={`/api/companies/${c.id}/revoke`} method="post"><button type="submit" className="btn btn-sm btn-ghost btn-danger">Revoke</button></form>
        </div>
      </div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {records.length === 0 ? (
          <div className="empty"><strong>No records yet.</strong> Sync to pull this company's investments.</div>
        ) : (
          <>
            <div className="stats">
              <Stat label="Commitments" cents={t.committed_cents} currency={t.currency} lead note={`${t.investors} investors · ${t.investments} investments`} />
              <Stat label="Raised (public)" cents={t.raised_cents} currency={t.currency} note="Σ raised_cents · the deal page figure" />
              <Stat label="Ready" cents={t.ready_cents} currency={t.currency} />
              <Stat label="Pending" cents={t.pending_cents} currency={t.currency} />
              <Stat label="No payment yet" cents={t.no_payment_cents} currency={t.currency} />
              {t.confirmed_cents > 0 && <Stat label="Confirmed" cents={t.confirmed_cents} currency={t.currency} />}
              {t.wefunder_cash_cents > 0 && <Stat label="Wefunder cash" cents={t.wefunder_cash_cents} currency={t.currency} note="reservations" />}
            </div>
            <details className="fold">
              <summary>Investments<span className="count">{records.length}{records.length > shown.length ? ` · showing ${shown.length}` : ""} · click a row for every field</span></summary>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Investment</th><th>Investor</th><th>Group</th><th>Status</th><th className="num">Committed</th><th className="num">Shares</th><th>Observed</th></tr></thead>
                  <tbody>{shown.map((r) => <RecordRow key={r.id} r={r} />)}</tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </div>
      <div className="card-foot">
        cursor <span className="mono">{c.sync.cursor ? `${c.sync.cursor.slice(0, 14)}…` : "none"}</span> · published through {c.sync.published_through ?? "—"} · bootstraps {c.sync.bootstraps} · scopes <span className="mono">{c.scopes.join(" ")}</span>
      </div>
    </section>
  );
}

export default async function Home() {
  const s = await load();
  let targets: Awaited<ReturnType<typeof eligibleCompanies>> = [];
  let eligibleError: string | null = null;
  let sessionExpired = false;
  if (s.user) {
    try { targets = await eligibleCompanies(s); }
    catch (e) { if (e instanceof SessionExpired) sessionExpired = true; else eligibleError = (e as Error).message; }
  }
  const disconnectedIds = new Set(Object.values(s.companies).filter((c) => c.disconnected).map((c) => c.id));
  const companies = Object.values(s.companies).sort((a, b) => a.name.localeCompare(b.name));
  // A company its founder disconnected shows up here with installed:false immediately (removing
  // the app does not remove our staff from the team). It is NOT a company to install on.
  const uninstalled = targets.filter((t) => !t.installed && !disconnectedIds.has(t.id ?? ""));
  const uninstalledKey = dismissKey(uninstalled.map((t) => t.id ?? ""));
  const dismissed = uninstalled.length > 0 && (await cookies()).get(DISMISS_COOKIE)?.value === uninstalledKey;
  const expires = s.user?.tokens.expiresAt ? new Date(s.user.tokens.expiresAt) : null;
  const pendingLines = s.notifications.filter((n) => !n.delivered_at).length;

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Investment sync</h1>
          <p className="sub">Reference Wefunder integration on <code>@wefunder/sdk</code> · one company-owned token per installed company, mirrored from the Investment Delta API, nudged by webhooks.</p>
        </div>
        <div className="right">
          {s.user
            ? <span className={`chip ${sessionExpired ? "chip-warn" : "chip-success"}`}><span className="dot" />{s.user.name ?? "Wefunder user"} · {sessionExpired ? "session expired" : "connected"}</span>
            : <span className="chip chip-neutral"><span className="dot" />not connected</span>}
          {s.user && <form className="inline" action="/api/installs/discover" method="post"><button type="submit" className="btn" title="Adopt installs made by hand or through a founder link: mint their company tokens and sync">Discover installs</button></form>}
          {s.user
            ? <form className="inline" action="/api/sync" method="post"><button type="submit" className="btn btn-primary" disabled={companies.length === 0}>Sync all</button></form>
            : <a href="/api/wefunder/oauth/start" className="btn btn-primary">Connect Wefunder</a>}
        </div>
      </header>

      {EPHEMERAL && (
        <div className="callout callout-warn">Running on Vercel without a store: state lives in /tmp and resets between invocations. Attach Upstash (KV_REST_API_URL) or Redis (REDIS_URL) from the Vercel Marketplace to keep tokens, the cursor and records.</div>
      )}

      {!s.user && (
        <div className="empty" style={{ padding: 40 }}>
          <strong>Connect your Wefunder account to begin.</strong><br />
          Authorization Code + PKCE. That token only lists the companies you edit and installs, mints and revokes; it never reads investments.
          <div style={{ marginTop: 14 }}><a href="/api/wefunder/oauth/start" className="btn btn-primary">Connect Wefunder</a></div>
        </div>
      )}

      {s.user && uninstalled.length > 0 && !dismissed && (
        <div className="callout callout-info" style={{ alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span>
            <strong>{uninstalled.length === 1 ? "One company" : `${uninstalled.length} companies`} you edit {uninstalled.length === 1 ? "isn't" : "aren't"} installed yet.</strong>{" "}
            Install any of them from <em>Connection</em> below; installing asks for <code>{env.installScopes.join(" ")}</code> and the card shows what was granted.
          </span>
          <form className="inline" action="/api/ui/dismiss-installs" method="post">
            <input type="hidden" name="key" value={uninstalledKey} />
            <button type="submit" className="btn btn-sm btn-ghost" title="Hide until a new eligible company appears">Dismiss</button>
          </form>
        </div>
      )}

      {s.user && eligibleError && <div className="callout callout-warn">Could not list eligible companies: {eligibleError}</div>}

      {s.user && companies.length === 0 && targets.length === 0 && !eligibleError && (
        <div className="empty"><strong>You don't edit any company on Wefunder.</strong> Ask a founder to add you with the Editor toggle, or send them the install link from the developer portal.</div>
      )}

      {companies.map((c) => <CompanyCard key={c.id} c={c} />)}

      <details className="plumb">
        <summary>Money feed<span className="count">{s.notifications.length}{pendingLines ? ` · ${pendingLines} pending` : ""}{env.slackWebhookUrl ? " · posting to Slack" : " · dashboard only (set SLACK_WEBHOOK_URL)"}</span></summary>
        <div className="inner">
          {s.notifications.length === 0
            ? <p className="t3" style={{ margin: 0 }}>Nothing yet. Lines appear when a sync finds a new investment, a group or status change, an amount change, or a removal; compared against the copy held before, never from the webhook alone.</p>
            : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Line</th><th>Company</th><th>When</th><th>Delivered</th></tr></thead>
                  <tbody>{s.notifications.slice(0, 30).map((n) => (
                    <tr key={n.id}><td>{n.line}</td><td className="t2">{s.companies[n.company]?.name ?? n.company}</td><td className="t3">{ago(n.created_at)}</td><td className="t3">{n.delivered_at ? ago(n.delivered_at) : `pending (${n.attempts} attempts)`}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
        </div>
      </details>

      {s.pending_installs.length > 0 && (
        <div className="callout callout-warn">Founder-link installs waiting for a token: <span className="mono">{s.pending_installs.map((p) => p.installation_id).join(", ")}</span>. Connect a user who can edit those companies.</div>
      )}

      <details className="plumb">
        <summary>Connection<span className="count">{s.user ? `scope ${s.user.tokens.scope ?? ""}` : "not connected"}</span></summary>
        <div className="inner">
          {s.user ? (
            <p className="t2" style={{ margin: 0 }}>
              <strong style={{ color: "var(--fg)" }}>{s.user.name ?? "A Wefunder user"}</strong> · scope <code>{s.user.tokens.scope ?? ""}</code> · access token expires {expires ? expires.toLocaleString() : "unknown"} (the SDK refreshes it) · <a href="/api/wefunder/oauth/start">reconnect</a>
            </p>
          ) : <p className="t2" style={{ margin: 0 }}>Not connected.</p>}
          <p className="t3" style={{ margin: 0, fontSize: 12 }}>Editors grant read scopes only. An install carries <code>{PII_SCOPE}</code> only when the installer manages the app&apos;s organization or Wefunder has approved the app for investor PII; the server drops it silently otherwise, so each card shows what was actually granted. Client id {process.env.WEFUNDER_CLIENT_ID ? "set" : "missing"}.</p>
          {targets.length > 0 && (
            <div className="list">
              {targets.map((t) => (
                <div key={t.id} className="row">
                  <div><strong>{t.name}</strong> <span className="t3">· {t.tier}</span> <span className="mono t3">{t.id}</span></div>
                  {disconnectedIds.has(t.id ?? "") ? <span className="chip chip-danger" title="The founder removed the app. Reconnect from its card only after speaking with them.">disconnected by founder</span>
                    : t.installed ? <span className="chip chip-success">Installed</span>
                    : <form className="inline" action="/api/installs" method="post"><input type="hidden" name="company" value={t.id} /><button type="submit" className="btn btn-sm">Install</button></form>}
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

      <details className="plumb">
        <summary>Webhook events<span className="count">{s.events.length}</span></summary>
        <div className="inner">
          {s.events.length === 0
            ? <p className="t3" style={{ margin: 0 }}>None yet. Register <code>/api/wefunder/webhooks</code> in the portal and subscribe to <code>investment.changed</code>.</p>
            : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Event</th><th>Id</th><th>Mode</th><th>Created</th><th>Received</th></tr></thead>
                  <tbody>{s.events.slice(0, 20).map((e) => (
                    <tr key={e.id}><td className="mono">{e.event}</td><td className="mono t3">{e.id}</td><td className="t2">{e.mode}</td><td className="t3">{ago(e.created_at)}</td><td className="t3">{ago(e.received_at)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
        </div>
      </details>

      <details className="plumb">
        <summary>Log<span className="count">{s.log.length} lines</span></summary>
        <div className="inner"><pre className="log">{s.log.join("\n") || "—"}</pre></div>
      </details>
    </>
  );
}
