"use client";
// One investment record as a table row; click to expand a details row underneath with every
// field the API returned, laid out by area, plus the raw JSON. Client-side only for the toggle.
import { useState } from "react";
import type { InvestmentRecord } from "@/lib/store.ts";
import { fmtMoney } from "@/lib/summary.ts";
import { shareCount } from "@/lib/founder_csv.ts";

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

function groupChip(group: string) {
  const g = group.toUpperCase();
  const tone = g === "CONFIRMED" ? "chip-info" : g === "IS READY" ? "chip-success" : g === "PENDING" ? "chip-warn" : g === "NO PAYMENT YET" ? "chip-danger" : "chip-neutral";
  return <span className={`chip ${tone}`}>{g || "—"}</span>;
}

type Investor = { id?: string; name?: string; legal_name?: string; email?: string | null; deactivated?: boolean; via_entity?: boolean; bio?: string | null; address?: { line?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null } };
type Amounts = { committed_cents?: number; investment_size_cents?: number; in_escrow_cents?: number; currency?: string };
type Blocker = { key: string; description?: string | null };
type Contract = { name?: string | null; override_amount_cents?: number | null; early_bird?: boolean };

const yes = (v: unknown) => (v === true ? "Yes" : v === false ? "No" : "—");
const str = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

function Field({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="field">
      <div className="k">{k}</div>
      <div className={`v${mono ? " mono" : ""}`}>{v}</div>
    </div>
  );
}

export default function RecordRow({ r }: { r: InvestmentRecord }) {
  const [open, setOpen] = useState(false);
  const amounts = (r.amounts ?? {}) as Amounts;
  const currency = amounts.currency ?? "usd";
  const investor = (r.investor ?? {}) as Investor;
  const address = investor.address ?? {};
  const blockers = (r.blockers ?? []) as Blocker[];
  const contracts = (r.contracts ?? []) as Contract[];
  const hidden = r.visible === false;
  const pii = investor.name !== undefined || investor.email !== undefined;
  const addressLine = [address.line, address.city, address.state, address.postal_code, address.country].filter(Boolean).join(", ");

  return (
    <>
      <tr className={`rec${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={open ? "Collapse" : "Expand"}>
        <td className="mono t3"><span className={`caret${open ? " down" : ""}`} />{short(String(r.id), 12)}</td>
        <td>
          {investor.name
            ? <span className="truncate" style={{ display: "inline-block", verticalAlign: "bottom" }}>{investor.name}</span>
            : <span className="mono t4">{investor.id ? short(investor.id) : "—"} <span className="t4">(no PII scope)</span></span>}
          {investor.deactivated && <span className="chip chip-neutral" style={{ marginLeft: 6 }}>deactivated</span>}
        </td>
        <td>{groupChip(String(r.group ?? ""))}{hidden && <span className="chip chip-neutral" style={{ marginLeft: 6 }}>hidden</span>}</td>
        <td className="t2">{str(r.status)}</td>
        <td className="num">{amounts.committed_cents !== undefined ? fmtMoney(amounts.committed_cents, currency) : ""}</td>
        <td className="num t2">{shareCount(r.shares as string | null | undefined) || <span className="t4">—</span>}</td>
        <td className="t3" title={String(r.observed_at ?? "")}>{ago(r.observed_at as string | undefined)}</td>
      </tr>
      {open && (
        <tr className="rec-detail">
          <td colSpan={7}>
            <div className="detail">
              <div className="fields">
                <h4>Investment</h4>
                <Field k="Id" v={str(r.id)} mono />
                <Field k="Status" v={str(r.status)} />
                <Field k="Group" v={str(r.group)} />
                <Field k="Visible to company" v={yes(r.visible)} />
                <Field k="Type" v={str(r.investment_type)} />
                <Field k="Offering type" v={str(r.offering_type)} />
                <Field k="Offering" v={str(r.offering)} mono />
                <Field k="Company" v={str(r.company)} mono />
                <Field k="Applied" v={str(r.applied_at)} mono />
                <Field k="Converted to / from" v={`${str(r.converted_to)} / ${str(r.converted_from)}`} mono />
                <Field k="Needs whitelisting" v={yes(r.needs_whitelisting)} />
              </div>
              <div className="fields">
                <h4>Money</h4>
                <Field k="Committed" v={amounts.committed_cents !== undefined ? fmtMoney(amounts.committed_cents, currency) : "—"} />
                <Field k="Investment size" v={amounts.investment_size_cents !== undefined ? fmtMoney(amounts.investment_size_cents, currency) : "—"} />
                <Field k="In escrow" v={amounts.in_escrow_cents !== undefined ? fmtMoney(amounts.in_escrow_cents, currency) : "—"} />
                <Field k="Currency" v={currency.toUpperCase()} />
                <Field k="Shares" v={str(r.shares)} />
                <Field k="Average share price" v={str(r.average_share_price)} />
                <h4>Contracts</h4>
                {contracts.length === 0 ? <Field k="—" v="none" /> : contracts.map((c, i) => (
                  <Field key={i} k={str(c.name)} v={`${c.override_amount_cents != null ? fmtMoney(c.override_amount_cents, currency) : "no override"}${c.early_bird ? " · early bird" : ""}`} />
                ))}
                <h4>Blockers</h4>
                {blockers.length === 0 ? <Field k="—" v="none" /> : blockers.map((b) => <Field key={b.key} k={b.key} v={str(b.description)} />)}
              </div>
              <div className="fields">
                <h4>Investor {pii ? "" : <span className="chip chip-neutral" style={{ marginLeft: 6 }}>no PII scope</span>}</h4>
                <Field k="Id" v={str(investor.id)} mono />
                <Field k="Name" v={str(investor.name)} />
                <Field k="Legal name" v={str(investor.legal_name)} />
                <Field k="Email" v={r.company_email_hidden ? "hidden by investor" : str(investor.email)} />
                <Field k="Via entity" v={yes(investor.via_entity)} />
                <Field k="Deactivated" v={yes(investor.deactivated)} />
                <Field k="Address" v={addressLine || "—"} />
                <Field k="Bio" v={str(investor.bio)} />
                <Field k="Message" v={str(r.message)} />
                <Field k="External username" v={str(r.external_username)} />
                <h4>Delta</h4>
                <Field k="Observed" v={str(r.observed_at)} mono />
                <Field k="Cursor" v={str(r.cursor)} mono />
                <Field k="Reason" v={str(r.reason)} />
              </div>
              <details className="raw">
                <summary>Raw record JSON</summary>
                <pre className="log">{JSON.stringify(r, null, 2)}</pre>
              </details>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
