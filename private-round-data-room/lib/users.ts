// ── STUB USER DIRECTORY ─────────────────────────────────────────────────────────────────────
// A real data room has a users table and decides who gets an account. This file stands in for
// both. Replace it with your own before anyone but you signs in.
//
// `id` is what this app sends to Wefunder as a member link's `reference`, so it must be stable
// and unique per person, and it should be opaque: your own user id, never an email address.
// `email` is used only for the investment-session flavor, which is addressed to an email.
export type Role = "investor" | "founder";

export type DataRoomUser = { id: string; name: string; email: string; role: Role };

export const USERS: DataRoomUser[] = [
  { id: "dr_user_1001", name: "Ada Example", email: "ada@example.com", role: "investor" },
  { id: "dr_user_1002", name: "Grace Example", email: "grace@example.com", role: "investor" },
  { id: "dr_user_1003", name: "Linus Example", email: "linus@example.com", role: "investor" },
  { id: "dr_founder_1", name: "Founder (you)", email: "founder@example.com", role: "founder" },
];

export const findUser = (id: string | null | undefined): DataRoomUser | null => USERS.find((u) => u.id === id) ?? null;

export const investors = (): DataRoomUser[] => USERS.filter((u) => u.role === "investor");
