// The portal's own members. In a real portal these are your users; here a fixture of fake people.
// `id` is what we send as the member link's `reference`, so it must be stable and must not be an
// email or anything else that identifies the person outside your system.
import fixture from "../data/members.json";

export type Member = {
  id: string;
  name: string;
  // Set this once you know the member's Wefunder account (an earlier link's wefunder_user_id) to
  // bind their next links to it up front.
  wefunder_user_id: string | null;
};

export const members: Member[] = fixture as Member[];

export const MEMBER_COOKIE = "demo_member";

// The demo has no login: a cookie says which fixture member is "signed in". Unknown or missing
// falls back to the first member.
export function currentMember(cookieValue: string | undefined): Member {
  return members.find((m) => m.id === cookieValue) ?? members[0];
}
