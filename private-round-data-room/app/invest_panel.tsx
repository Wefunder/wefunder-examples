"use client";

// The two ways to invest, side by side, with each one's current state. This is the only Client
// Component in the app. It keeps the states current by asking THIS app's /api/status; it never
// calls Wefunder and never sees the installation token. The buttons are plain form posts to the
// routes under /api/invest/, which mint on the server and redirect the browser to Wefunder.
import { useEffect, useState } from "react";
import { linkButton, linkShown, sessionButton, sessionShown, type Shown } from "@/lib/states.ts";
import type { LinkState, SessionStatus } from "@/lib/wefunder.ts";

export type Status = { link: LinkState | null; session: SessionStatus | null; watching: boolean; stale: boolean };

const POLL_MS = 15_000;
// Stop after half an hour on one page view. Reloading the page starts again.
const GIVE_UP_MS = 30 * 60_000;

function Chip({ shown, stale }: { shown: Shown; stale: boolean }) {
  return (
    <span className="state" aria-live="polite">
      <span className={`chip chip-${shown.tone}`}>
        <span className="dot" />
        {shown.label}
      </span>
      {stale && <span className="muted">last known</span>}
    </span>
  );
}

export function InvestPanel(props: { initial: Status; justReturned: boolean; sessionsEnabled: boolean; email: string }) {
  const status = useStatus(props.initial, props.justReturned);

  return (
    <div className="flavors">
      <section className="flavor">
        <h3>See the round on Wefunder</h3>
        <p>Opens the round&apos;s page on Wefunder with your access to this private round already in place. Read the terms there and invest with any Wefunder account.</p>
        <Chip shown={linkShown(status.link)} stale={status.stale} />
        <form method="post" action="/api/invest/link">
          <button className="btn btn-primary" type="submit">{linkButton(status.link)}</button>
        </form>
      </section>

      {props.sessionsEnabled && (
        <section className="flavor">
          <h3>
            Go straight to checkout <span className="chip chip-info">beta</span>
          </h3>
          <p>
            Skips the round&apos;s page and opens Wefunder&apos;s checkout for <strong>{props.email}</strong>, then brings you back here.
          </p>
          <Chip shown={sessionShown(status.session)} stale={status.stale} />
          <form method="post" action="/api/invest/session">
            <button className="btn" type="submit">{sessionButton(status.session)}</button>
          </form>
        </section>
      )}
    </div>
  );
}

function useStatus(initial: Status, justReturned: boolean): Status {
  const [status, setStatus] = useState<Status>(initial);

  useEffect(() => {
    const startedAt = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watching = initial.watching;

    const ask = async (fresh: boolean) => {
      try {
        const res = await fetch(`/api/status${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
        if (res.status === 401) return window.location.assign("/login");
        if (!res.ok || stopped) return;
        const next = (await res.json()) as Status;
        watching = next.watching;
        setStatus(next);
      } catch {
        // Offline, or the server restarted: keep what is shown and try again on the next tick.
      }
    };

    const tick = async () => {
      if (stopped) return;
      const expired = Date.now() - startedAt > GIVE_UP_MS;
      // A hidden tab asks nothing; it picks up again on the first tick after it is shown.
      if (watching && !expired && document.visibilityState === "visible") await ask(false);
      if (!stopped && watching && !expired) timer = setTimeout(tick, POLL_MS);
    };

    // Back from checkout: ask now rather than waiting for the first tick.
    void (justReturned ? ask(true) : Promise.resolve()).then(() => {
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    });

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // Mount once per page view: the props are only the server-rendered starting point.
  }, []);

  return status;
}
