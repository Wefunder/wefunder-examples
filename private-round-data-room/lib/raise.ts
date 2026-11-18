// Turn `GET /offerings/{id}/stats` into what the data room shows. Pure, tested in plain Node.
import type { OfferingStats } from "@wefunder/sdk";

export type StatusRow = { status: string; count: number; committedCents: number; raisedCents: number };

export type Raise = {
  currency: string;
  // The round's raised figure: `total.raised_cents`. An investment counts toward it once Wefunder
  // counts it as raised, so a commitment that has not been paid yet is in `committedCents` only.
  raisedCents: number;
  // What investors entered, canceled investments left out.
  committedCents: number;
  // Investments, not people: one investor can hold several. Canceled ones are left out.
  investments: number;
  byStatus: StatusRow[];
};

const ORDER = ["executed", "active", "reserved", "converted", "canceled"];

export function summarize(stats: OfferingStats | null | undefined): Raise {
  const byStatus: StatusRow[] = Object.entries(stats?.by_status ?? {})
    .map(([status, row]) => ({ status, count: row.count ?? 0, committedCents: row.committed_cents ?? 0, raisedCents: row.raised_cents ?? 0 }))
    .sort((a, b) => rank(a.status) - rank(b.status));
  const live = byStatus.filter((r) => r.status !== "canceled");
  return {
    currency: stats?.currency ?? "usd",
    raisedCents: stats?.total?.raised_cents ?? 0,
    committedCents: live.reduce((sum, r) => sum + r.committedCents, 0),
    investments: live.reduce((sum, r) => sum + r.count, 0),
    byStatus,
  };
}

const rank = (status: string) => (ORDER.includes(status) ? ORDER.indexOf(status) : ORDER.length);

// Amounts are integer minor units (cents) plus a currency code. Never a float of dollars.
export function formatMoney(cents: number, currency: string = "usd"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(Math.trunc(cents / 100));
}
