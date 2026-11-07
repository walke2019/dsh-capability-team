// GET /api/aiwuk.managed-config.autocomplete: the route the settings card fetches, registered by the package itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apply } from '../../packages/autocomplete/index.js';
import { MANAGED_ROUTE_PATH, handleManagedConfig } from '../../packages/autocomplete/managed-route.js';
import { managedConfigPath } from '../../managed-config-route.js';

const payload = { revision: 4, entries: [{ ref: 'AUTOCOMPLETE_MODEL', locked: true, secret: false, value: 'leak-me' }, { ref: 'AUTOCOMPLETE_PROVIDER', locked: false, secret: false }] };
const credentials = { readRecord: async () => ({ kind: 'grant', payload }) };
const options = { home: '/nonexistent' };
const get = (headers = {}, method = 'GET') => new Request('http://dsh.internal/api/aiwuk.managed-config.autocomplete', { method, headers });

test('the path equals the one the panel fetches and the root route table', () => {
  assert.equal(MANAGED_ROUTE_PATH, managedConfigPath('autocomplete'));
});

test('GET returns the values-free wire manifest', async () => {
  const res = await handleManagedConfig(credentials, get({ host: '127.0.0.1:3081', origin: 'http://127.0.0.1:3081' }), options);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['entries', 'revision']);
  assert.deepEqual(body.entries, [{ ref: 'AUTOCOMPLETE_MODEL', locked: true, secret: false }, { ref: 'AUTOCOMPLETE_PROVIDER', locked: false, secret: false }]);
  assert.ok(!JSON.stringify(body).includes('leak-me'));
  assert.deepEqual(await (await handleManagedConfig(undefined, get({ host: 'h' }), options)).json(), { revision: 0, entries: [] }, 'unmanaged answers empty');
});

test('cross-site requests are refused by comparing Origin with Host, never request.url', async () => {
  for (const headers of [{ host: '127.0.0.1:3081', origin: 'http://evil.test' }, { host: '127.0.0.1:3081', 'sec-fetch-site': 'cross-site' }, { host: '127.0.0.1:3081', origin: 'not a url' }, { host: 'hub.example.com', origin: 'http://dsh.internal' }]) {
    const res = await handleManagedConfig(credentials, get(headers), options);
    assert.equal(res.status, 403, JSON.stringify(headers));
    assert.deepEqual(await res.json(), { code: 'FORBIDDEN' });
  }
  assert.equal((await handleManagedConfig(credentials, get({ host: 'hub.example.com', origin: 'https://hub.example.com' }), options)).status, 200);
});

test('non-GET is 405', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await handleManagedConfig(credentials, get({ host: 'h' }, method), options)).status, 405, method);
});

test('apply() registers the route once through connection.fetch, reading credentials lazily', async () => {
  const routes = [];
  let creds = null;
  const injects = {};
  const ctx = { connection: { admit: () => ({}) }, effect: fn => fn(), on() {}, webServer: { register: () => () => {} },
    inject: (names, fn) => { injects[names[0]] = fn; } };
  apply(ctx, {});
  assert.deepEqual(Object.keys(injects).sort(), ['connection', 'credentials']);
  injects.connection({ connection: { fetch: { register: route => { routes.push(route); return () => {}; } } } });
  injects.credentials({ credentials: (creds = { resolve: async () => undefined, ...credentials }), effect() {} });
  assert.equal(routes.length, 1);
  assert.deepEqual([routes[0].path, routes[0].methods, routes[0].requestBody], [MANAGED_ROUTE_PATH, ['GET'], 'buffered']);
  const res = await routes[0].fetch(get({ host: 'h' }));
  assert.equal((await res.json()).entries.length, 2, 'credentials mounted after registration are still used');
});

test('the new file is published and the package-level route registrations stay unique per extension', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../packages/autocomplete/package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.files.includes('managed-route.js'));
  const registered = { team: ['ui.js'], memory: ['packages/global-memory/index.js'], search: ['packages/omni-search/index.js'] };
  for (const [extension, files] of Object.entries(registered)) {
    for (const file of files) {
      const hits = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').match(/registerManagedConfigRoute\(ctx, '[a-z]+'\)/g) ?? [];
      assert.deepEqual(hits, [`registerManagedConfigRoute(ctx, '${extension}')`], file);
    }
  }
  const own = readFileSync(new URL('../../packages/autocomplete/index.js', import.meta.url), 'utf8');
  assert.equal((own.match(/registerManagedRoute\(/g) ?? []).length, 1);
});
