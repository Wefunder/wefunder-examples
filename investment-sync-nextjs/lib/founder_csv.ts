// The founder Investor CSV, rebuilt from API records so a tester can download this and the one from
// wefunder.com (Manage Investments → Download CSV, non-admin) and diff them. Mirrors
// Company::InvestmentService#investments_csv exactly: UTF-8 BOM, a "Campaign Scope" row, a blank
// row, the 24 founder columns followed by the 3 contract columns, newest first.
//
// Known, intentional differences: "Effective share count" / "Current price per share" hold the
// record's per-investment `shares` / `average_share_price` (what THIS commitment buys), whereas the
// site fills them from the investor's post-funding PortfolioPosition (per investor, all rounds), so on
// an open round the site prints a prior round's holdings or nothing. And only the company's TRACKED
// raises are present (open, or closed within 90 days) — the site's CSV covers every campaign.
import type { InvestmentRecord } from "./store.ts";

export const COLUMNS = [
  "Investment External ID", "Investor Legal Name", "User", "Email", "Via Entity", "Investment Group", "Date (UTC)",
  "Investment Amount", "Effective share count", "Current price per share", "Amount in Escrow", "Needs Whitelisting",
  "Investment Type", "Offering Type", "Postal Code", "Country", "State", "City", "Address", "Bio", "Message",
  "Blockers", "Blocker Descriptions", "External Username",
  "Early Bird", "Contract Name", "Contract Override Amount",
] as const;

type Investor = { name?: string; legal_name?: string; email?: string | null; via_entity?: boolean; bio?: string | null; address?: { line?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null } };
type Contract = { name?: string | null; override_amount_cents?: number | null; early_bird?: boolean };
type Blocker = { key: string; description?: string | null };

// BigDecimal#to_s as Ruby's CSV writes it: "1000.0", "1000.5", "1000.25".
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  if (frac === 0) return `${sign}${whole}.0`;
  const two = String(frac).padStart(2, "0");
  return `${sign}${whole}.${two.endsWith("0") ? two[0] : two}`;
}

// format_share_count: BigDecimal(shares).truncate(2).to_s("F") with trailing zeros (and a bare
// point) stripped: "1479.29", "333.33", "295".
export function shareCount(shares: string | null | undefined): string {
  if (!shares) return "";
  const m = /^(-?\d+)(?:\.(\d+))?$/.exec(shares);
  if (!m) return shares;
  const frac = (m[2] ?? "").slice(0, 2).replace(/0+$/, "");
  return frac ? `${m[1]}.${frac}` : m[1];
}

// Time#strftime("%Y-%m-%d %H:%M:%S") in UTC.
export function dateUtc(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// contracts2columns: per-column values of every contract joined with "\n"; booleans as Yes/No;
// a nil value contributes "" (nil.to_s).
function joinContracts(contracts: Contract[], pick: (c: Contract) => string): string {
  return contracts.map(pick).join("\n");
}

export function row(r: InvestmentRecord): string[] {
  const investor = (r.investor ?? {}) as Investor;
  const address = investor.address ?? {};
  const amounts = (r.amounts ?? {}) as { committed_cents?: number; in_escrow_cents?: number };
  const blockers = (r.blockers ?? []) as Blocker[];
  const contracts = (r.contracts ?? []) as Contract[];
  const email = r.company_email_hidden ? "" : (investor.email ?? "");
  return [
    String(r.id),
    investor.legal_name ?? investor.name ?? "",
    investor.name ?? "",
    email,
    investor.via_entity ? "Yes" : "No",
    String(r.group ?? ""),
    dateUtc(r.applied_at as string | undefined),
    money(amounts.committed_cents ?? 0),
    shareCount(r.shares as string | null | undefined),
    (r.average_share_price as string | null | undefined) ?? "",
    money(amounts.in_escrow_cents),
    r.needs_whitelisting ? "Yes" : "",
    String(r.investment_type ?? ""),
    String(r.offering_type ?? ""),
    address.postal_code ?? "",
    address.country ?? "",
    address.state ?? "",
    address.city ?? "",
    address.line ?? "",
    investor.bio ?? "",
    (r.message as string | null | undefined) ?? "",
    blockers.map((b) => b.key).join("\n"),
    blockers.map((b) => b.description ?? "").join("\n"),
    (r.external_username as string | null | undefined) ?? "",
    joinContracts(contracts, (c) => (c.early_bird ? "Yes" : "No")),
    joinContracts(contracts, (c) => c.name ?? ""),
    joinContracts(contracts, (c) => money(c.override_amount_cents)),
  ];
}

// RFC 4180 as Ruby's CSV writes it: quote only when needed (comma, quote, CR/LF), double the quotes.
function cell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function founderCsv(records: InvestmentRecord[], scopeLabel = "All Campaigns"): string {
  const sorted = [...records].sort((a, b) => String(b.applied_at ?? "").localeCompare(String(a.applied_at ?? "")));
  const lines = [
    [`Campaign Scope: ${scopeLabel}`],
    [],
    [...COLUMNS],
    ...sorted.map(row),
  ];
  return "﻿" + lines.map((l) => l.map(cell).join(",")).join("\n") + "\n";
}
