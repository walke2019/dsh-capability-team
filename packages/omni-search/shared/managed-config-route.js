// Managed-config manifest for the browser config panels:
//   GET /api/aiwuk.managed-config.<ext>  →  { revision, entries: [{ ref, locked, secret, value? }] }
// `value` is present only for NON-secret refs (URLs, models, engine lists) so the panel can show what the Mothership
// configured; secret refs never carry a value, only their flags.
// The host rejects a second registration of one exact path, and team / memory / search can be installed together,
// so every package registers its own path (<ext> = team | memory | search | autocomplete). The route sits behind the
// Connection fence (authenticated owner peer, Host and Origin checks); crossSiteRequest() repeats the Origin-vs-Host
// comparison (never request.url, which the host rebuilds on a fixed internal base).
import { crossSiteRequest } from './http-guard.js';
import { managedValues, manifestToWire, readManagedManifest } from './shared/managed-config.js';

export const MANAGED_CONFIG_ROUTE_PREFIX = '/api/aiwuk.managed-config';
export const MANAGED_CONFIG_EXTENSIONS = Object.freeze(['team', 'memory', 'search', 'autocomplete']);
/** The route path of one extension; unknown extension ids are refused instead of building arbitrary paths. */
export function managedConfigPath(extension) {
  if (!MANAGED_CONFIG_EXTENSIONS.includes(extension)) throw new Error(`unknown extension "${extension}"`);
  return `${MANAGED_CONFIG_ROUTE_PREFIX}.${extension}`;
}

/** Wire view plus the non-secret values (`managedValues`); secret entries keep only ref / locked / secret. */
export async function wireWithValues(ctx, manifest) {
  const wire = manifestToWire(manifest);
  const values = await managedValues(ctx?.credentials, manifest);
  for (const entry of wire.entries) if (!entry.secret && Object.hasOwn(values, entry.ref)) entry.value = values[entry.ref];
  return wire;
}

/** Request handler: GET only, same-origin, no-store; secrets never carry a value. */
export async function handleManagedConfig(ctx, request, options) {
  const fail = (status, code) => Response.json({ code }, { status, headers: { 'cache-control': 'no-store' } });
  if (request.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED');
  if (crossSiteRequest(request)) return fail(403, 'FORBIDDEN');
  try {
    return Response.json(await wireWithValues(ctx, await readManagedManifest(ctx, options)), { headers: { 'cache-control': 'no-store' } });
  } catch { return fail(503, 'UNAVAILABLE'); }
}

/**
 * Register the route of `extension` on the plugin context. Needs `connection`; `credentials` is optional (without
 * it the file fallback still answers). `options` is for tests (env / home / read).
 */
export function registerManagedConfigRoute(ctx, extension, options) {
  const path = managedConfigPath(extension);
  ctx.inject?.(['connection'], scoped => scoped.connection.fetch.register({
    path, methods: ['GET'], requestBody: 'buffered', fetch: request => handleManagedConfig(readerOf(ctx, scoped), request, options),
  }));
}
// `credentials` is an optional service: look it up lazily on every request so a late mount is picked up.
const readerOf = (ctx, scoped) => ({ get credentials() { try { return scoped.get?.('credentials') ?? ctx.get?.('credentials'); } catch { return undefined; } } });
