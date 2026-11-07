import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FLEET_KEYS, parseFleetDefaults, withFleetDefaults, loadFleetDefaults, lockedRefs } from '../../packages/autocomplete/fleet-defaults.js';
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

test('the endpoint routes through the fleet model unless the user configured one', async t => {
  const home = await mkdtemp(join(tmpdir(), 'ac-home-')); const previous = process.env.DSH_HOME; process.env.DSH_HOME = home;
  t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; return rm(home, { recursive: true, force: true }); });
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
    await new Promise(resolve => setTimeout(resolve, 50)); // the load also reads the managed manifest file fallback
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

test('a locked fleet route beats the local route; unlocked stays a default', async () => {
  const manifest = locked => ({ readRecord: async () => ({ kind: 'grant', payload: { revision: 2, updatedAt: 'x', entries: ['AUTOCOMPLETE_ROUTE_MODE', 'AUTOCOMPLETE_PROVIDER', 'AUTOCOMPLETE_MODEL'].map(ref => ({ ref, locked, secret: false })) } }),
    resolve: async name => ({ AUTOCOMPLETE_PROVIDER: { value: 'gateway', source: 'file' }, AUTOCOMPLETE_MODEL: { value: 'fast-model', source: 'file' } })[name] });
  const own = { ...DEFAULT_CONFIG, routeMode: 'fixed', provider: 'mine', model: 'm' };
  const lockedRoute = await loadFleetDefaults(manifest(true));
  assert.deepEqual(lockedRoute.locked, { provider: 'gateway', model: 'fast-model' }, 'a locked ref without a managed value contributes nothing');
  const won = withFleetDefaults(own, lockedRoute);
  assert.deepEqual([won.routeMode, won.provider, won.model], ['fixed', 'gateway', 'fast-model']);
  assert.equal(Object.hasOwn(won, 'locked'), false, 'the lock flag never leaks into the config');
  const unlocked = await loadFleetDefaults(manifest(false));
  assert.equal(unlocked.locked, undefined);
  assert.equal(withFleetDefaults(own, unlocked).provider, 'mine');
});

test('a locked ref ignores an environment-sourced value; the manifest file is the fallback', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ac-lock-'));
  try {
    await mkdir(join(home, 'aiwuk'));
    await writeFile(join(home, 'aiwuk', 'managed-config.json'), JSON.stringify({ revision: 1, entries: [{ ref: 'AUTOCOMPLETE_PROVIDER', locked: true, secret: false }, { ref: 'bad ref', locked: true }] }));
    assert.deepEqual([...await lockedRefs(undefined, { home })], ['AUTOCOMPLETE_PROVIDER']);
    const store = { resolve: async name => ({ AUTOCOMPLETE_PROVIDER: { value: 'from-env', source: 'env' }, AUTOCOMPLETE_MODEL: { value: 'm', source: 'file' } })[name] };
    assert.deepEqual(await loadFleetDefaults(store, { home }), {}, 'locked provider from the environment is not trusted, so the route is incomplete');
  } finally { await rm(home, { recursive: true, force: true }); }
});

// Per-field locks: every locked field overrides its own local field; unlocked values keep the one-unit default rule.
const store = (lockedRefs, values) => ({
  readRecord: async () => ({ kind: 'grant', payload: { revision: 2, entries: lockedRefs.map(ref => ({ ref, locked: true, secret: false })) } }),
  resolve: async name => (values[name] === undefined ? undefined : { value: values[name], source: 'file' }),
});
const effective = async (local, lockedRefs, values) => {
  const { routeMode, provider, model } = withFleetDefaults({ ...DEFAULT_CONFIG, ...local }, await loadFleetDefaults(store(lockedRefs, values), { home: '/nonexistent' }));
  return [routeMode, provider, model];
};

test('only the model is locked: it overrides the local model, provider and mode stay local', async () => {
  assert.deepEqual(await effective({ routeMode: 'fixed', provider: 'mine', model: 'mine-model' }, ['AUTOCOMPLETE_MODEL'], { AUTOCOMPLETE_MODEL: 'managed-model' }), ['fixed', 'mine', 'managed-model']);
});

test('only the route mode is locked to session: it wins over a local fixed route', async () => {
  assert.deepEqual(await effective({ routeMode: 'fixed', provider: 'mine', model: 'mine-model' }, ['AUTOCOMPLETE_ROUTE_MODE'], { AUTOCOMPLETE_ROUTE_MODE: 'session' }), ['session', 'mine', 'mine-model']);
});

test('a locked provider combines with the local model; a locked provider without any model fails safe to session', async () => {
  assert.deepEqual(await effective({ routeMode: 'fixed', provider: 'mine', model: 'mine-model' }, ['AUTOCOMPLETE_PROVIDER'], { AUTOCOMPLETE_PROVIDER: 'managed-gw' }), ['fixed', 'managed-gw', 'mine-model']);
  assert.deepEqual(await effective({ routeMode: 'fixed', provider: 'mine' }, ['AUTOCOMPLETE_PROVIDER'], { AUTOCOMPLETE_PROVIDER: 'managed-gw' }), ['session', 'managed-gw', ''], 'incomplete fixed route is never used');
});

test('a locked fixed mode with an incomplete route fails safe to session', async () => {
  assert.deepEqual(await effective({}, ['AUTOCOMPLETE_ROUTE_MODE'], { AUTOCOMPLETE_ROUTE_MODE: 'fixed' }), ['session', '', '']);
  assert.deepEqual(await effective({ model: 'mine-model' }, ['AUTOCOMPLETE_ROUTE_MODE'], { AUTOCOMPLETE_ROUTE_MODE: 'fixed' }), ['session', '', 'mine-model']);
  assert.deepEqual(await effective({ provider: 'p', model: 'm' }, ['AUTOCOMPLETE_ROUTE_MODE'], { AUTOCOMPLETE_ROUTE_MODE: 'fixed' }), ['fixed', 'p', 'm'], 'a complete route stays fixed');
});

test('locked fields combine with an unlocked default route; an invalid locked value is ignored', async () => {
  // Unlocked mode fills an untouched config; the locked model still overrides its own field.
  assert.deepEqual(await effective({}, ['AUTOCOMPLETE_MODEL'], { AUTOCOMPLETE_ROUTE_MODE: 'session', AUTOCOMPLETE_MODEL: 'locked-model' }), ['session', '', 'locked-model']);
  // An unlocked provider alone is an incomplete fleet route (dropped); the locked model never completes it by itself.
  assert.deepEqual(await effective({}, ['AUTOCOMPLETE_MODEL'], { AUTOCOMPLETE_PROVIDER: 'gateway', AUTOCOMPLETE_MODEL: 'locked-model' }), ['session', '', 'locked-model']);
  assert.deepEqual(await effective({ routeMode: 'fixed', provider: 'p', model: 'm' }, ['AUTOCOMPLETE_MODEL'], { AUTOCOMPLETE_MODEL: 'bad id!' }), ['fixed', 'p', 'm']);
  const loaded = await loadFleetDefaults(store(['AUTOCOMPLETE_MODEL'], { AUTOCOMPLETE_MODEL: 'x-model' }), { home: '/nonexistent' });
  assert.deepEqual(loaded, { locked: { model: 'x-model' } });
  assert.equal(Object.hasOwn(withFleetDefaults({ ...DEFAULT_CONFIG }, loaded), 'locked'), false);
});
