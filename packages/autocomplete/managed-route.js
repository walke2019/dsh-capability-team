// Values-free managed-config manifest for the autocomplete settings card:
//   GET /api/aiwuk.managed-config.autocomplete  →  { revision, entries: [{ ref, locked, secret }] }
// Same wire shape as the root managed-config-route.js; this package ships no shared/ closure, so the manifest reader
// is the one in fleet-defaults.js. The route sits behind the Connection fence (authenticated owner peer, Host and
// Origin checks); crossSiteRequest() repeats the Origin-vs-Host comparison (never request.url, which the host
// rebuilds on a fixed internal base).
import { managedManifest } from './fleet-defaults.js';

export const MANAGED_ROUTE_PATH = '/api/aiwuk.managed-config.autocomplete';

/** Browser same-origin check: Sec-Fetch-Site, then Origin against the Host header (request.url only if Host is absent). */
export function crossSiteRequest(request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return true;
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  const host = request.headers.get('host') ?? new URL(request.url).host;
  try { return new URL(origin).host !== host; } catch { return true; }
}

const wireOf = manifest => (manifest
  ? { revision: manifest.revision, entries: [...manifest.entries].map(([ref, e]) => ({ ref, locked: e.locked, secret: e.secret })).sort((a, b) => (a.ref < b.ref ? -1 : 1)) }
  : { revision: 0, entries: [] });

/** Request handler: GET only, same-origin, no-store, and nothing but ref / locked / secret per entry. */
export async function handleManagedConfig(credentials, request, options) {
  const fail = (status, code) => Response.json({ code }, { status, headers: { 'cache-control': 'no-store' } });
  if (request.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED');
  if (crossSiteRequest(request)) return fail(403, 'FORBIDDEN');
  try { return Response.json(wireOf(await managedManifest(typeof credentials === 'function' ? credentials() : credentials, options)), { headers: { 'cache-control': 'no-store' } }); }
  catch { return fail(503, 'UNAVAILABLE'); }
}

/** Register the route through ctx.connection; `getCredentials` is read lazily so a late credential mount is picked up. */
export function registerManagedRoute(ctx, getCredentials, options) {
  ctx.inject?.(['connection'], scoped => scoped?.connection?.fetch?.register({
    path: MANAGED_ROUTE_PATH, methods: ['GET'], requestBody: 'buffered', fetch: request => handleManagedConfig(getCredentials, request, options),
  }));
}
