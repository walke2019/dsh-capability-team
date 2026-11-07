// The root team plugin binds the DSH credential service (resolver AND managed manifest reader), so a locked managed
// ref wins over local settings, and a dispose never clears the binding of a later re-apply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.js';
import { refreshCredentials, resolveIntegrations, setCredentialResolver, setManagedReader, setManagedManifest, managedManifestOf } from '../integrations-config.js';

const MANAGED_URL = 'https://managed.example.com';
const service = value => ({
  resolve: async name => (name === 'SEARXNG_URL' ? value : undefined),
  readRecord: async key => (key === 'mothership-connector/managed-config' ? { kind: 'grant', payload: { revision: 3, entries: [{ ref: 'SEARXNG_URL', locked: true, secret: false }] } } : undefined),
});
function mountTeam() {
  const injected = [];
  const host = { agentPresets: { composedPreset: () => 'capability-team' }, effect: f => f(), on: () => {}, systemPrompt: { section: () => () => {} },
    tools: { register: () => () => {}, guard: () => () => {} }, skills: { register: () => () => {} },
    agents: { list: () => [] }, agentTeams: { membership: () => ({ role: 'lead' }), tryMembership: () => undefined }, workingDirectory: {}, userQuestions: {},
    llm: { listProviders: () => [], listModels: async () => [] },
    inject: (names, fn) => { if (names[0] === 'credentials') injected.push(fn); } };
  apply(host, {});
  assert.equal(injected.length, 1, 'the team plugin injects the credentials service exactly once');
  // Bind like the host does: the callback receives a scoped ctx whose effect() collects the disposer.
  const bind = svc => { const disposers = []; injected[0]({ credentials: svc, effect: f => { disposers.push(f()); } }); return () => disposers.forEach(d => d()); };
  return { bind };
}
const sourceOf = () => resolveIntegrations({ root: '/nonexistent', env: process.env }).sources.search.searxngUrl;
const reset = () => { setCredentialResolver(null); setManagedReader(null); setManagedManifest(null); };

test('root plugin: a locked manifest record makes the ref resolve as managed-locked; dispose unbinds', async () => {
  reset();
  try {
    const { bind } = mountTeam();
    const dispose = bind(service(MANAGED_URL));
    await refreshCredentials(resolveIntegrations({ root: '/nonexistent', env: process.env }));
    assert.equal(managedManifestOf()?.entries.get('SEARXNG_URL')?.locked, true);
    assert.equal(sourceOf(), 'managed-locked');
    dispose();
    await refreshCredentials();
    assert.equal(managedManifestOf(), null, 'unbinding drops the manifest');
    assert.notEqual(sourceOf(), 'managed-locked');
  } finally { reset(); }
});

test('root plugin: disposing an earlier binding does not clear the resolver of a later re-apply', async () => {
  reset();
  try {
    const first = mountTeam().bind(service(MANAGED_URL));
    const second = mountTeam().bind(service(MANAGED_URL));
    first(); // the old instance goes away after the new one was bound
    await refreshCredentials(resolveIntegrations({ root: '/nonexistent', env: process.env }));
    assert.equal(sourceOf(), 'managed-locked', 'the later binding still resolves and reads the manifest');
    second();
    await refreshCredentials();
    assert.notEqual(sourceOf(), 'managed-locked');
  } finally { reset(); }
});
