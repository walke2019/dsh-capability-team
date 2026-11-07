// Preloaded by `npm test` (node --import): every test process gets an empty DSH home, so the managed-config file
// fallback (<DSH home>/aiwuk/managed-config.json) never reads the developer's real ~/.dsh. Works on every platform.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'aiwuk-dsh-home-'));
process.env.DSH_HOME = home;
process.on('exit', () => { try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ } });
