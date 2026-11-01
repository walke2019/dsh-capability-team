// Browser-mutation check for the plugin's POST routes, matching DSH's own /api fence. The Connection layer
// already enforces Host, Origin and an authenticated peer before a route runs. The desktop app forwards
// renderer requests from dsh-app://app and strips Origin and Sec-Fetch-Site on the way, so a missing Origin
// is normal there; only a present Origin of another site, or an explicit cross-site marker, is refused.
/** True when a request carries markers of another site and must be rejected. */
export function crossSiteRequest(request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return true;
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  try { return new URL(origin).host !== new URL(request.url).host; } catch { return true; }
}
