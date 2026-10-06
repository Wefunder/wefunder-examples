// The directory header's numbers (wefunder.com/<company>/directory), rebuilt from the mirrored
// records: investors, total commitments, and the split by founder dashboard group. Mirrors
// Company::InvestmentService.compute_investment_metrics: sums amount_or_total_share_price
// (`amounts.investment_size_cents`) per bucket; "Wefunder cash" is IS READY on a reservation
// (testing-the-waters) round, which by definition cannot be disbursed.
//
// Known differences: the site counts soft-confirmed investments only and drops already-disbursed
// rows from "ready"; the record carries neither flag. And the mirror only holds tracked raises
// (open, or closed within 90 days), so long-closed rounds are absent here.
import type { InvestmentRecord } from "./store.ts";

export type Summary = {
  currency: string;
  investors: number;
  investments: number;
  committed_cents: number;      // every visible record
  raised_cents: number;         // Σ amounts.raised_cents: the public raised figure (0 on records published before it existed)
  ready_cents: number;          // IS READY, non-reservation
  wefunder_cash_cents: number;  // IS READY on a reservation round
  pending_cents: number;        // PENDING
  no_payment_cents: number;     // NO PAYMENT YET
  confirmed_cents: number;      // CONFIRMED (closed / executed)
  other_cents: number;          // any other group label
};

function size(r: InvestmentRecord): number {
  const a = (r.amounts ?? {}) as { investment_size_cents?: number; committed_cents?: number };
  return a.investment_size_cents ?? a.committed_cents ?? 0;
}
function raised(r: InvestmentRecord): number {
  return ((r.amounts ?? {}) as { raised_cents?: number }).raised_cents ?? 0;
}

export function summarize(all: InvestmentRecord[]): Summary {
  const records = all.filter((r) => r.visible !== false);
  const s: Summary = { currency: "usd", investors: 0, investments: records.length, committed_cents: 0, raised_cents: 0, ready_cents: 0, wefunder_cash_cents: 0, pending_cents: 0, no_payment_cents: 0, confirmed_cents: 0, other_cents: 0 };
  const investors = new Set<string>();
  for (const r of records) {
    const cents = size(r);
    const group = String(r.group ?? "").toUpperCase();
    const investor = (r.investor ?? {}) as { id?: string };
    if (investor.id) investors.add(investor.id);
    const currency = ((r.amounts ?? {}) as { currency?: string }).currency;
    if (currency) s.currency = currency;
    s.committed_cents += cents;
    s.raised_cents += raised(r);
    if (group === "IS READY") { if (r.status === "reserved") s.wefunder_cash_cents += cents; else s.ready_cents += cents; }
    else if (group === "PENDING") s.pending_cents += cents;
    else if (group === "NO PAYMENT YET") s.no_payment_cents += cents;
    else if (group === "CONFIRMED") s.confirmed_cents += cents;
    else s.other_cents += cents;
  }
  s.investors = investors.size;
  return s;
}

// "$661,712" — whole units like the directory header; "$5,000.50" only when there are cents.
export function fmtMoney(cents: number, currency = "usd"): string {
  const units = cents / 100;
  const opts: Intl.NumberFormatOptions = { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: Number.isInteger(units) ? 0 : 2, maximumFractionDigits: 2 };
  return new Intl.NumberFormat("en-US", opts).format(units);
}
