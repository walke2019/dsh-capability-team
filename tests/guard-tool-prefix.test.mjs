import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAccess } from '../access.js';
import { checkFileLimits, FILE_LIMITS, predictText } from '../file-limits.js';

const where = { project: '/repo', cwd: '/repo', label: 'R' };
const access = { deny: ['web_*'], editPaths: [], shell: false };
const aliases = name => [name, `brisk_${name}`, `mcp__s__brisk_${name}`];

test('aliases cannot skip restrictive access checks or acquire sandbox exemptions', () => {
  for (const name of aliases('write')) assert.match(checkAccess({ name, arguments: { file_path: 'a.js' } }, access, where), /No file edits are allowed/);
  for (const name of aliases('pwsh')) {
    assert.match(checkAccess({ name }, access, where), /may not execute commands/);
    assert.equal(checkAccess({ name }, access, { ...where, sandboxed: true }), undefined);
  }
  for (const name of aliases('web_fetch')) assert.match(checkAccess({ name }, access, where), /may not use tool/);
  assert.match(checkAccess({ name: 'mcp__third_party__custom_write', arguments: { file_path: 'a.js' } }, access, where), /No file edits are allowed/);
});

test('aliases cannot bypass existing-file, generated-file, size, read or report guards', () => {
  const check = (name, args, text) => checkFileLimits({ name, arguments: args }, FILE_LIMITS, { ...where, read: () => text });
  for (const name of aliases('write')) assert.match(check(name, { file_path: 'a.js', content: 'x' }, 'old'), /already exists/);
  for (const name of aliases('edit')) {
    assert.match(check(name, { file_path: 'a.js', old_string: 'x', new_string: 'y' }, '// @generated\nx'), /generated/);
    assert.equal(predictText({ name, arguments: { old_string: 'x', new_string: 'y' } }, 'x'), 'y');
  }
  for (const name of aliases('read')) assert.match(check(name, { file_path: 'a.js' }, 'x\n'.repeat(401)), /whole-read limit/);
  for (const name of aliases('send_message')) assert.match(check(name, { message: 'x'.repeat(1501) }), /Report has/);
  for (const name of aliases('write')) assert.match(check(name, { file_path: 'a.js', content: 'x\n'.repeat(501) }, undefined), /source file limit/);
});
