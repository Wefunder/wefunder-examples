// The "companies you edit aren't installed yet" callout is dismissible; the cookie stores WHICH set
// was dismissed so a newly eligible company brings the callout back once.
export const DISMISS_COOKIE = "td_dismissed_uninstalled";
export function dismissKey(ids: string[]): string {
  return [...ids].sort().join(",");
}
