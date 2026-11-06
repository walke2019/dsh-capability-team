// GET /api/aiwuk.managed-config.<ext>: same-origin guard (Origin vs Host), values-free payload, registration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MANAGED_CONFIG_EXTENSIONS, handleManagedConfig, managedConfigPath, registerManagedConfigRoute } from '../managed-config-route.js';

const payload = { revision: 7, entries: [{ ref: 'OMNI_SEARCH_API_KEY', locked: true, secret: true, value: 'sk-never-leak' }, { ref: 'SEARXNG_URL', locked: false, secret: false }] };
const ctx = { credentials: { readRecord: async () => ({ kind: 'grant', payload }) } };
const options = { home: '/nonexistent' };
// DSH rebuilds the request on http://dsh.internal, so the real authority is the Host header.
const get = (headers = {}, method = 'GET') => new Request('http://dsh.internal/api/aiwuk.managed-config.search', { method, headers });

test('returns {revision, entries:[{ref,locked,secret}]} and nothing else', async () => {
  const res = await handleManagedConfig(ctx, get({ host: '127.0.0.1:3081', origin: 'http://127.0.0.1:3081', 'sec-fetch-site': 'same-origin' }), options);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['entries', 'revision']);
  assert.equal(body.revision, 7);
  assert.deepEqual(body.entries, [{ ref: 'OMNI_SEARCH_API_KEY', locked: true, secret: true }, { ref: 'SEARXNG_URL', locked: false, secret: false }]);
  assert.ok(!JSON.stringify(body).includes('sk-never-leak'));
});

test('same-origin guard compares Origin with the Host header, not request.url', async () => {
  assert.equal((await handleManagedConfig(ctx, get({ host: 'hub.example.com', origin: 'https://hub.example.com' }), options)).status, 200);
  assert.equal((await handleManagedConfig(ctx, get({ host: '127.0.0.1:3081' }), options)).status, 200, 'desktop requests carry no Origin');
  for (const headers of [{ host: '127.0.0.1:3081', origin: 'http://evil.test' }, { host: '127.0.0.1:3081', 'sec-fetch-site': 'cross-site' }, { host: '127.0.0.1:3081', origin: 'not a url' }, { host: 'hub.example.com', origin: 'http://dsh.internal' }]) {
    const res = await handleManagedConfig(ctx, get(headers), options);
    assert.equal(res.status, 403, JSON.stringify(headers));
    assert.deepEqual(await res.json(), { code: 'FORBIDDEN' });
  }
});

test('only GET is served; an unmanaged instance answers an empty manifest', async () => {
  assert.equal((await handleManagedConfig(ctx, get({ host: 'h' }, 'POST'), options)).status, 405);
  const empty = await (await handleManagedConfig({}, get({ host: 'h' }), options)).json();
  assert.deepEqual(empty, { revision: 0, entries: [] });
});

test('each extension gets its own exact path and registers once through ctx.connection', async () => {
  assert.deepEqual(MANAGED_CONFIG_EXTENSIONS.map(managedConfigPath), ['/api/aiwuk.managed-config.team', '/api/aiwuk.managed-config.memory', '/api/aiwuk.managed-config.search', '/api/aiwuk.managed-config.autocomplete']);
  assert.throws(() => managedConfigPath('../x'), /unknown extension/);
  const routes = [];
  const scoped = { connection: { fetch: { register: route => { routes.push(route); return () => {}; } } }, get: name => (name === 'credentials' ? ctx.credentials : undefined) };
  registerManagedConfigRoute({ inject: (names, fn) => { assert.deepEqual(names, ['connection']); fn(scoped); } }, 'memory', options);
  assert.equal(routes.length, 1);
  assert.deepEqual([routes[0].path, routes[0].methods, routes[0].requestBody], ['/api/aiwuk.managed-config.memory', ['GET'], 'buffered']);
  const res = await routes[0].fetch(get({ host: 'h' }));
  assert.equal((await res.json()).entries.length, 2);
});
