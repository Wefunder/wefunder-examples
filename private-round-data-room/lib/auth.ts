// ── STUB LOGIN ──────────────────────────────────────────────────────────────────────────────
// One shared password and a signed cookie naming a fixture user. It exists so the example has a
// login for the Wefunder calls to sit behind; it is not an authentication system. Swap in your
// own (and your own user store, lib/users.ts) before this is reachable by anyone but you.
//
// Pure functions, no Next.js imports, so the tests run them in plain Node.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "data_room_session";
export const SESSION_HOURS = 12;

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// "<user id>.<expires at, ms>.<signature>"
export function signSession(userId: string, secret: string, now: number = Date.now()): string {
  const payload = `${userId}.${now + SESSION_HOURS * 3600_000}`;
  return `${payload}.${sign(payload, secret)}`;
}

// The user id the cookie names, or null when it is missing, altered, or expired.
export function verifySession(value: string | undefined, secret: string, now: number = Date.now()): string | null {
  if (!value || !secret) return null;
  const cut = value.lastIndexOf(".");
  if (cut < 0) return null;
  const payload = value.slice(0, cut);
  if (!same(value.slice(cut + 1), sign(payload, secret))) return null;
  const dot = payload.lastIndexOf(".");
  const expiresAt = Number(payload.slice(dot + 1));
  if (dot < 0 || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return payload.slice(0, dot);
}

// No password configured means nobody signs in: the data room fails closed.
export function passwordMatches(given: string, expected: string | undefined): boolean {
  return Boolean(expected) && same(given, expected as string);
}
