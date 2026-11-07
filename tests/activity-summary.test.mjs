import test from 'node:test';
import assert from 'node:assert/strict';
import { safeTarget, summarizeActivity } from '../activity-summary.js';
test('summary never copies commands, descriptions, queries or oversized/broken arguments', () => {
  const secret = 'sk-SECRET-BAIT';
  for (const [tool, args] of [['bash', JSON.stringify({ command: secret, description: secret })], ['grep', JSON.stringify({ pattern: secret })], ['read', '{broken'], ['read', JSON.stringify({ file_path: secret.repeat(2000) })]]) assert.ok(!JSON.stringify(summarizeActivity(tool, args, '/project')).includes(secret));
  assert.equal(summarizeActivity('read', '{"file_path":"src/a.js"}', '/project').target, 'src/a.js');
});
test('path fences and sensitive names', () => {
  for (const p of ['../escape', '/outside/a', 'https://evil/a', 'a?secret=x', 'a\nkey', 'a\u0000']) assert.equal(safeTarget(p, '/project'), null);
  for (const p of ['.env', '.env.local', '.ssh/id_rsa', 'secrets.json', 'cert.pem']) assert.equal(safeTarget(p, '/project'), '[Sensitive path]');
});
