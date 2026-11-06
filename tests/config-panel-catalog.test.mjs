// The field catalog must equal the Mothership catalog snapshot (docs/catalog.snapshot.json, produced by the
// mothership protocol package). Also: every panel ref is a catalog ref, and labels exist in both languages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { CATALOG } from '../shared-ui/catalog.js';
import { PANELS } from '../shared-ui/fields.js';

// The worktree lives at <repo>/.work/wt/<name>; the snapshot sits in the repository-level docs/ directory.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const candidates = [process.env.AIWUK_CATALOG_SNAPSHOT, resolve(here, '../docs/catalog.snapshot.json'), resolve(here, '../../docs/catalog.snapshot.json'), resolve(here, '../../../docs/catalog.snapshot.json'), resolve(here, '../../../../docs/catalog.snapshot.json')].filter(Boolean);
const found = candidates.find(path => existsSync(path));

test('catalog equals the mothership snapshot', { skip: !found && 'docs/catalog.snapshot.json is absent (produced by the mothership repo); skipped' }, () => {
  const snapshot = JSON.parse(readFileSync(found, 'utf8'));
  assert.equal(snapshot.version, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(CATALOG)), snapshot.entries.map(entry => ({ ...entry })));
});

test('every ref is unique and env-style, secrets are flagged, labels are bilingual', () => {
  const refs = CATALOG.map(e => e.ref);
  assert.equal(new Set(refs).size, refs.length);
  for (const e of CATALOG) {
    assert.match(e.ref, /^[A-Z][A-Z0-9_]{2,63}$/);
    assert.ok(e.label.en && e.label.zh, e.ref);
    if (/(_API_KEY|_KEY|_TOKEN|_SECRET|_PASSWORD)$/.test(e.ref)) assert.equal(e.secret, true, `${e.ref} must be secret`);
    assert.equal(e.secret, e.kind === 'secret');
  }
});

test('panel fields with a ref exist in the catalog under the same extension (panels may omit catalog-only refs)', () => {
  for (const panel of Object.values(PANELS)) {
    for (const f of panel.fields.filter(x => x.ref)) {
      const entry = CATALOG.find(e => e.ref === f.ref);
      assert.ok(entry, `${panel.extension}.${f.id}: ${f.ref} is not in the catalog`);
      assert.equal(entry.extension, panel.extension);
      assert.equal(f.kind === 'secret', entry.secret, f.ref);
    }
  }
});
