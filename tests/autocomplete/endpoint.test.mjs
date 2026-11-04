import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { apply, ENDPOINT, inject } from '../../packages/autocomplete/index.js';

function mount({ principal = 'owner', rejection, live = {}, sessions = {}, llm } = {}) {
  let handler;
  const effects = [];
  apply({
    connection: { admit: () => (rejection ? { rejection } : { peer: { principal: { kind: principal } } }) },
    llm: llm ?? { prepareCall: async () => ({ config: {}, stream: async function* () { yield { type: 'text-delta', text: 'next idea' }; } }) },
    sessions: { get: id => sessions[id] },
    webServer: { register: route => { assert.equal(route.path, ENDPOINT); handler = route.handler; return () => {}; } },
    effect: fn => effects.push(fn()),
  }, live);
  return { handler, effects };
}
function call(handler, { method = 'POST', headers = {}, body = '{}' } = {}) {
  const request = Readable.from([Buffer.from(body)]);
  Object.assign(request, { method, headers: { host: 'h', 'content-type': 'application/json', ...headers } });
  const out = { status: 0, headers: {}, body: '' };
  const response = {
    destroyed: false, writableEnded: false, on() {}, off() {},
    writeHead(status, h) { out.status = status; out.headers = h; },
    write(chunk) { out.body += chunk; },
    end(chunk = '') { out.body += chunk; this.writableEnded = true; },
  };
  return handler(request, response).then(() => out);
}
const live = { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }), deriveMessages: () => [{ role: 'assistant', content: 'done' }] };

test('declares host services and refuses unauthenticated, non-owner and cross-origin requests', async () => {
  assert.deepEqual(inject, ['connection', 'llm', 'sessions', 'webServer']);
  assert.equal((await call(mount({ rejection: 401 }).handler)).status, 401);
  assert.equal((await call(mount({ principal: 'guest' }).handler)).status, 403);
  const { handler } = mount();
  assert.equal((await call(handler, { method: 'GET' })).status, 405);
  assert.equal(JSON.parse((await call(handler, { headers: { origin: 'https://evil.test' } })).body).reason, 'cross-origin');
  assert.equal(JSON.parse((await call(handler, { headers: { origin: 'not a url' } })).body).reason, 'cross-origin');
  assert.equal((await call(handler, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await call(handler, { headers: { 'content-type': 'text/plain' } })).status, 415);
});

test('validates config, body and live session before streaming', async () => {
  assert.equal((await call(mount({ live: { enabled: false } }).handler)).status, 409);
  assert.equal((await call(mount({ live: { maxSuggestions: 99 } }).handler)).status, 503);
  const { handler } = mount();
  assert.equal(JSON.parse((await call(handler, { body: '{bad' })).body).reason, 'invalid-json');
  assert.equal((await call(handler, { body: JSON.stringify({ sessionId: 'missing' }) })).status, 404);
});

test('streams meta, delta and done events for a live session', async () => {
  const { handler } = mount({ sessions: { s1: live } });
  const out = await call(handler, { body: JSON.stringify({ sessionId: 's1' }) });
  assert.equal(out.status, 200);
  assert.equal(out.headers['content-type'], 'text/event-stream');
  assert.match(out.body, /event: meta/); assert.match(out.body, /event: delta/);
  const done = JSON.parse(out.body.split('event: done\ndata: ')[1]);
  assert.deepEqual(done.suggestions, ['next idea']); assert.equal(done.suggestion, 'next idea');
});

test('reports generation failures inside an open stream', async () => {
  const llm = { prepareCall: async () => ({ config: {}, stream: async function* () { yield { type: 'finish', reason: 'error' }; } }) };
  const out = await call(mount({ sessions: { s1: live }, llm }).handler, { body: JSON.stringify({ sessionId: 's1' }) });
  assert.equal(out.status, 200); assert.match(out.body, /event: error\ndata: \{"reason":"generation-failed"/);
});
