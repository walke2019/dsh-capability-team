import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { FLEET_KEYS, parseFleetDefaults, withFleetDefaults, loadFleetDefaults } from '../../packages/autocomplete/fleet-defaults.js';
import { DEFAULT_CONFIG } from '../../packages/autocomplete/schema.js';
import { apply } from '../../packages/autocomplete/index.js';

const fleet = { routeMode: 'fixed', provider: 'gateway', model: 'fast-model' };

test('a valid fleet route fills an untouched config', () => {
  assert.deepEqual(parseFleetDefaults({ provider: ' gateway ', model: 'fast-model' }), fleet, 'fixed is implied by provider+model');
  assert.deepEqual(withFleetDefaults({ ...DEFAULT_CONFIG }, fleet), { ...DEFAULT_CONFIG, ...fleet });
});

test('any user route choice wins over the fleet as a whole, never mixed', () => {
  assert.equal(withFleetDefaults({ ...DEFAULT_CONFIG, routeMode: 'fixed', provider: 'mine', model: 'm' }, fleet).provider, 'mine');
  // Only the model typed by the user: the fleet provider must not be grafted onto it.
  const partial = withFleetDefaults({ ...DEFAULT_CONFIG, model: 'my-model' }, fleet);
  assert.deepEqual([partial.routeMode, partial.provider, partial.model], ['session', '', 'my-model']);
});

test('invalid, partial or absent fleet values change nothing', () => {
  for (const raw of [undefined, {}, { provider: 'only' }, { routeMode: 'weird', provider: 'p', model: 'm' }, { provider: 'bad id!', model: 'm' }]) {
    assert.deepEqual(parseFleetDefaults(raw), {}, JSON.stringify(raw));
  }
  assert.deepEqual(withFleetDefaults({ ...DEFAULT_CONFIG }, {}), DEFAULT_CONFIG);
});

test('credentials are read by fixed names and a missing store is harmless', async () => {
  assert.deepEqual(Object.values(FLEET_KEYS), ['AUTOCOMPLETE_ROUTE_MODE', 'AUTOCOMPLETE_PROVIDER', 'AUTOCOMPLETE_MODEL']);
  assert.deepEqual(await loadFleetDefaults(undefined), {});
  const store = { resolve: async name => ({ AUTOCOMPLETE_PROVIDER: { value: 'gateway' }, AUTOCOMPLETE_MODEL: 'fast-model' })[name] };
  assert.deepEqual(await loadFleetDefaults(store), fleet);
  assert.deepEqual(await loadFleetDefaults({ resolve: async () => { throw new Error('locked'); } }), {});
});

test('the endpoint routes through the fleet model unless the user configured one', async () => {
  const routes = [];
  const run = async live => {
    let handler, injected;
    apply({
      connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
      llm: { prepareCall: async route => { routes.push(`${route.provider}/${route.model}`); return { config: {}, stream: async function* () {} }; } },
      sessions: { get: () => ({ requestHeader: () => ({ config: { provider: 'session', model: 'own' } }), deriveMessages: () => [{ role: 'assistant', content: 'hi' }] }) },
      webServer: { register: r => { handler = r.handler; } },
      effect: fn => fn(), on() {},
      inject: (_names, fn) => { injected = fn({ credentials: { resolve: async n => ({ AUTOCOMPLETE_PROVIDER: 'gateway', AUTOCOMPLETE_MODEL: 'fast-model' })[n] }, effect() {} }); },
    }, live);
    await new Promise(resolve => setImmediate(resolve));
    const request = Readable.from([Buffer.from(JSON.stringify({ sessionId: 's' }))]);
    Object.assign(request, { method: 'POST', headers: { host: 'h', 'content-type': 'application/json' } });
    await handler(request, { on() {}, off() {}, writeHead() {}, write() {}, end() {} });
    return injected;
  };
  await run({});
  await run({ routeMode: 'fixed', provider: 'mine', model: 'custom' });
  await run({ routeMode: 'session' });
  assert.deepEqual(routes, ['gateway/fast-model', 'mine/custom', 'gateway/fast-model']);
});
