// Values-free managed-config manifest for the autocomplete settings card:
//   GET /api/aiwuk.managed-config.autocomplete  →  { revision, entries: [{ ref, locked, secret, value? }] }
// `value` is present only for non-secret refs, so the card can show the route the Mothership configured.
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

const FORCED_SECRET = /(_API_KEY|_KEY|_TOKEN|_SECRET|_PASSWORD)$/;
/** Non-secret value of one managed ref from the credential store, or undefined. Secret refs are never read. */
async function shownValue(credentials, ref, entry) {
  if (entry.secret || FORCED_SECRET.test(ref) || typeof credentials?.resolve !== 'function') return undefined;
  try { const hit = await credentials.resolve(ref); const value = typeof hit === 'string' ? hit : hit?.value; return typeof value === 'string' && value && value.length <= 512 ? value : undefined; }
  catch { return undefined; }
}
async function wireOf(manifest, credentials) {
  if (!manifest) return { revision: 0, entries: [] };
  const entries = [];
  for (const [ref, e] of manifest.entries) {
    const value = await shownValue(credentials, ref, e);
    entries.push({ ref, locked: e.locked, secret: e.secret, ...(value === undefined ? {} : { value }) });
  }
  return { revision: manifest.revision, entries: entries.sort((a, b) => (a.ref < b.ref ? -1 : 1)) };
}

/** Request handler: GET only, same-origin, no-store; secret entries carry only ref / locked / secret. */
export async function handleManagedConfig(credentials, request, options) {
  const fail = (status, code) => Response.json({ code }, { status, headers: { 'cache-control': 'no-store' } });
  if (request.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED');
  if (crossSiteRequest(request)) return fail(403, 'FORBIDDEN');
  try {
    const store = typeof credentials === 'function' ? credentials() : credentials;
    return Response.json(await wireOf(await managedManifest(store, options), store), { headers: { 'cache-control': 'no-store' } });
  }
  catch { return fail(503, 'UNAVAILABLE'); }
}

/** Register the route through ctx.connection; `getCredentials` is read lazily so a late credential mount is picked up. */
export function registerManagedRoute(ctx, getCredentials, options) {
  ctx.inject?.(['connection'], scoped => scoped?.connection?.fetch?.register({
    path: MANAGED_ROUTE_PATH, methods: ['GET'], requestBody: 'buffered', fetch: request => handleManagedConfig(getCredentials, request, options),
  }));
}
