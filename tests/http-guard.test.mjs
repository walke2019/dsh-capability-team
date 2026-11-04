// DSH hands plugin routes a Request rebuilt on http://dsh.internal; the same-origin check must use the Host header.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crossSiteRequest } from '../http-guard.js';

const bridged = headers => new Request('http://dsh.internal/api/capability-team.dispatch-confirm', { method: 'POST', headers });

for (const [name, check] of [['http-guard', crossSiteRequest]]) {
  test(`${name}: same-origin browser POST through the DSH bridge is allowed`, () => {
    assert.equal(check(bridged({ host: '127.0.0.1:3081', origin: 'http://127.0.0.1:3081', 'sec-fetch-site': 'same-origin' })), false);
    assert.equal(check(bridged({ host: 'hub.example.com', origin: 'https://hub.example.com' })), false);
  });
  test(`${name}: other origins and cross-site markers are refused`, () => {
    assert.equal(check(bridged({ host: '127.0.0.1:3081', origin: 'http://evil.test' })), true);
    assert.equal(check(bridged({ host: '127.0.0.1:3081', 'sec-fetch-site': 'cross-site' })), true);
    assert.equal(check(bridged({ host: '127.0.0.1:3081', origin: 'not a url' })), true);
  });
  test(`${name}: desktop requests without Origin pass`, () => {
    assert.equal(check(bridged({ host: '127.0.0.1:3081' })), false);
  });
}
