import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installArgs, installDsh, retryableFailure } from '../scripts/install-dsh-compat.mjs';
const failed = (code, status = 1) => ({ status, stderr: `npm error code ${code}\n` });
function mock(results) {
  const calls = [], waits = [], logs = [];
  return { calls, waits, logs, options: { run: async args => { calls.push(args); return results.shift(); }, wait: async ms => { waits.push(ms); }, log: text => logs.push(text) } };
}
test('Resolved exact version is unchanged and metadata always prefers online', async () => {
  const m = mock([{ status: 0 }]);
  assert.equal((await installDsh('0.2.2-rc.2', m.options)).status, 0);
  assert.deepEqual(m.calls, [['install', '--global', '--no-audit', '--no-fund', '--prefer-online', '@deepseek-ai/dsh@0.2.2-rc.2']]);
  assert.deepEqual(m.waits, []);
  for (const version of ['next', 'latest', '^0.2.2', '', '0.2.2;echo unsafe', '0.2.2\n']) assert.throws(() => installArgs(version), /exact resolved/);
});
test('ETARGET retries at most three times with bounded 5 and 10 second delays', async () => {
  const last = failed('ETARGET', 17), m = mock([failed('ETARGET'), failed('ETARGET'), last]);
  assert.equal(await installDsh('0.2.2-rc.2', m.options), last);
  assert.equal(m.calls.length, 3); assert.deepEqual(m.waits, [5000, 10000]);
  assert.ok(m.calls.every(args => args.at(-1) === '@deepseek-ai/dsh@0.2.2-rc.2'));
  assert.equal(m.logs.length, 2);
});
test('Transient network and registry failures can recover without masking success', async () => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'E429', 'E503']) {
    const success = { status: 0 }, m = mock([failed(code), success]);
    assert.equal(await installDsh('0.2.2', m.options), success);
    assert.equal(m.calls.length, 2); assert.deepEqual(m.waits, [5000]);
  }
  assert.equal(retryableFailure({ status: 1, stderr: 'npm ERR! code ETARGET\n' }), true);
  assert.equal(retryableFailure({ status: 1, stderr: 'npm error code ETARGET\r\n' }), true);
  assert.equal(retryableFailure({ status: 1, stderr: 'npm ERR! code ETARGET\r\nnpm ERR! code E401\r\n' }), false);
});
test('Permanent, lifecycle, unknown and mixed errors fail immediately with original exit status', async () => {
  for (const code of ['E401', 'E403', 'E404', 'ELIFECYCLE', 'ENOENT', 'EACCES', 'ENOSPC', 'ERESOLVE', 'EINTEGRITY', '1', 'UNKNOWN']) {
    const result = failed(code, 42), m = mock([result]);
    assert.equal(await installDsh('0.2.2', m.options), result);
    assert.equal(m.calls.length, 1); assert.deepEqual(m.waits, []);
    assert.equal(retryableFailure({ ...result, stderr: `${result.stderr}npm error code ETARGET\n` }), false, code);
  }
});
test('Only canonical npm code lines qualify; process errors and signals never retry', async () => {
  for (const result of [
    { status: 7, stderr: 'some package printed ETARGET' },
    { status: 7, stderr: 'prefix npm error code ETARGET\n' },
    { status: null, signal: 'SIGTERM', stderr: 'npm error code ETARGET\n' },
    { status: null, error: { code: 'ENOENT' }, stderr: 'npm error code ETARGET\n' },
  ]) {
    const m = mock([result]); assert.equal(await installDsh('0.2.2', m.options), result); assert.equal(m.calls.length, 1); assert.deepEqual(m.waits, []);
  }
});
test('Workflow installs exact matrix version and retains separate mount and smoke steps', async () => {
  const workflow = await readFile(new URL('../.github/workflows/dsh-compat.yml', import.meta.url), 'utf8');
  assert.match(workflow, /DSH_COMPAT_VERSION: \$\{\{ matrix\.version \}\}/);
  assert.match(workflow, /node scripts\/install-dsh-compat\.mjs "\$DSH_COMPAT_VERSION"/);
  assert.doesNotMatch(workflow, /prefer-offline|continue-on-error/);
  assert.match(workflow, /run: node --test tests\/team-mount\.test\.mjs/);
  assert.match(workflow, /run: node scripts\/ci-dsh-smoke\.mjs/);
});
