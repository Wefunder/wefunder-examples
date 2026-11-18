// STUB LOGIN PAGE. Pick a fixture user and type the shared DEMO_PASSWORD. This is the one page
// that renders without a signed-in user, and it shows nothing about the round.
import { redirect } from "next/navigation";
import { env } from "@/lib/env.ts";
import { currentUser } from "@/lib/server.ts";
import { USERS } from "@/lib/users.ts";

export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ failed?: string }> }) {
  if (await currentUser()) redirect("/");
  const { failed } = await searchParams;

  return (
    <div className="card narrow">
      <div className="card-head">
        <div>
          <h2>{env.companyName} data room</h2>
          <p className="meta">Sign in to continue.</p>
        </div>
      </div>
      <div className="card-body stack">
        <div className="stub">
          Stub login for the example: fixture users from <code>lib/users.ts</code> and one shared password. Replace it with your own
          authentication before anyone else uses this.
        </div>
        {!env.demoPassword && <div className="notice notice-warn">Set <code>DEMO_PASSWORD</code> in <code>.env.local</code>. Nobody can sign in until it is set.</div>}
        {failed && <div className="notice notice-danger">That password did not match.</div>}
        <form method="post" action="/api/login" className="stack">
          <label>
            Sign in as
            <select name="user_id" defaultValue={USERS[0]?.id}>
              {USERS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
          </label>
          <label>
            Password
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          <button className="btn btn-primary" type="submit">Sign in</button>
        </form>
      </div>
    </div>
  );
}
