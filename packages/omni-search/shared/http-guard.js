// Browser-mutation check for the plugin's POST routes, matching DSH's own /api fence. The Connection layer
// already enforces Host, Origin and an authenticated peer before a route runs. The desktop app forwards
// renderer requests from dsh-app://app and strips Origin and Sec-Fetch-Site on the way, so a missing Origin
// is normal there; only a present Origin of another site, or an explicit cross-site marker, is refused.
/** True when a request carries markers of another site and must be rejected. */
export function crossSiteRequest(request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return true;
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  // DSH rebuilds the request URL on a fixed internal base (http://dsh.internal), so the real authority is the Host
  // header the Connection fence already accepted; compare against it and use the URL only when Host is absent.
  const host = request.headers.get('host') ?? new URL(request.url).host;
  try { return new URL(origin).host !== host; } catch { return true; }
}
