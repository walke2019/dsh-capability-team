import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Client UI must take every colour, radius and font size from the host theme (--dsw-* tokens); the host swaps token values
// for dark mode itself (body[data-ds-dark-theme]). A token missing from the host silently falls back, which is how the
// dark-mode picker once ended up white on white, so every token used here is validated against the real host file.
const root = resolve(import.meta.dirname, '..');
const clientDir = join(root, 'client');
const acDir = join(root, 'packages', 'autocomplete', 'client');
// 00/01 are dictionaries; 08b is the pixel-sprite palette (a documented exception: sprites are fixed art, not UI chrome).
const EXCLUDED = new Set(['00-core-zh.js', '01-i18n-en.js', '08b-stage-sprites.js']);
const sourceFiles = [
  ...readdirSync(clientDir).filter(f => f.endsWith('.js') && !EXCLUDED.has(f)).map(f => join(clientDir, f)),
  ...readdirSync(acDir).filter(f => f.endsWith('.js')).map(f => join(acDir, f)),
];
const read = f => readFileSync(f, 'utf8');
const rel = f => f.slice(root.length + 1);

/** Remove every balanced `var(...)` call: a fallback is allowed only as the 2nd argument of var(). */
function stripVar(text) {
  let out = '', i = 0;
  while (i < text.length) {
    if (text.startsWith('var(', i)) {
      let depth = 0, j = i + 3;
      for (; j < text.length; j++) { if (text[j] === '(') depth++; else if (text[j] === ')' && --depth === 0) break; }
      out += 'VAR'; i = j + 1;
    } else out += text[i++];
  }
  return out;
}

function hostThemeFile() {
  const candidates = [];
  if (process.env.DSH_PACKAGE_DIR) candidates.push(resolve(process.env.DSH_PACKAGE_DIR));
  const npm = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (npm.status === 0 && npm.stdout.trim()) candidates.push(join(npm.stdout.trim(), '@deepseek-ai', 'dsh'));
  for (const dir of candidates) {
    for (const base of [join(dir, 'node_modules', '@deepseek-ai'), join(dir, '..')]) {
      const file = join(base, 'dsh-client-ui-theme', 'lib', 'client.js');
      if (existsSync(file)) return file;
    }
  }
  return null;
}
const hostFile = hostThemeFile();
const hostSkip = hostFile ? false : 'DSH host theme (dsh-client-ui-theme) is not installed; set DSH_PACKAGE_DIR to validate tokens';
const hostTokens = hostFile ? new Set([...read(hostFile).matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map(m => m[1])) : new Set();
const usedTokens = text => [...text.matchAll(/(--dsw-[a-z0-9-]+)/g)].map(m => m[1]);

test('theme sources are non-empty and cover both client trees', () => {
  assert.ok(sourceFiles.length > 20);
  assert.ok(sourceFiles.some(f => f.endsWith('02-styles.js')) && sourceFiles.some(f => f.endsWith('01-overlay.js')));
  assert.ok(!sourceFiles.some(f => f.endsWith('08b-stage-sprites.js')));
});

test('no prefers-color-scheme media query in any client source', () => {
  const hits = sourceFiles.filter(f => /prefers-color-scheme/.test(read(f))).map(rel);
  assert.deepEqual(hits, [], 'dark mode comes from the host token swap, not from a media query');
});

test('no naked hex/rgb/hsl colour outside the 2nd argument of var()', () => {
  const offenders = [];
  for (const f of sourceFiles) {
    const lines = stripVar(read(f)).split('\n');
    lines.forEach((line, i) => { for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/g)) offenders.push(`${rel(f)}:${i + 1} ${m[0]}`); });
  }
  assert.deepEqual(offenders, []);
});

test('no colour is hardcoded to white or black', () => {
  const offenders = sourceFiles.filter(f => /(?:color|background)\s*:\s*(?:white|black)\b/i.test(stripVar(read(f)))).map(rel);
  assert.deepEqual(offenders, []);
  const css = read(join(clientDir, '02-styles.js'));
  assert.deepEqual(css.match(/var\(--dsw-[a-z0-9-]+,\s*#(?:fff|ffffff)\b/gi) ?? [], [], 'a token must not fall back to white');
});

test('no literal border radius (pills 50%/999px excepted) and no literal 11-16px font size in the stylesheets', () => {
  for (const name of ['02-styles.js', '02b-stage-styles.js']) {
    const text = stripVar(read(join(clientDir, name)));
    assert.deepEqual(text.match(/border-radius:\s*\d+(?:\.\d+)?px/g)?.filter(m => !/999px/.test(m)) ?? [], [], `${name} radii`);
    assert.deepEqual(text.match(/font-size:\s*(?:1[1-6])(?:\.\d+)?px/g) ?? [], [], `${name} font sizes`);
  }
});

test('z-index literals are local custom properties defined once', () => {
  const css = read(join(clientDir, '02-styles.js'));
  assert.equal((css.match(/--aw-z-popover:\d+/g) ?? []).length, 1);
  assert.equal((css.match(/--aw-z-modal:\d+/g) ?? []).length, 1);
  assert.deepEqual(css.match(/z-index:\s*1[01]\d\d\b/g) ?? [], []);
  assert.doesNotMatch(read(join(clientDir, '10b-onboarding.js')), /zIndex:\s*\d{3,}/);
});

test('no localStorage locale toggle in the client', () => {
  const offenders = sourceFiles.filter(f => /localStorage[^;\n]*locale|locale[^;\n]*localStorage|dsh-capability-team-locale/i.test(read(f))).map(rel);
  assert.deepEqual(offenders, []);
});

test('stage palette has no own colours: aliases derive from host tokens', () => {
  const stage = read(join(clientDir, '02b-stage-styles.js'));
  for (const alias of ['--aw-bg:var(--dsw-alias-bg-layer-1)', '--aw-fg:var(--dsw-alias-label-primary)', '--aw-muted:var(--dsw-alias-label-secondary)', '--aw-line:var(--dsw-alias-border-l2)']) assert.ok(stage.includes(alias), alias);
  for (const name of ['floor-a', 'floor-b', 'grout', 'wall', 'desk', 'desk-top', 'plate']) assert.match(stage, new RegExp(`--ctm-stage-${name}:var\\(--dsw-`));
});

test('every --dsw-* token used by the client exists in the host theme', { skip: hostSkip }, () => {
  const missing = new Set();
  for (const f of sourceFiles) for (const t of usedTokens(read(f))) if (!hostTokens.has(t)) missing.add(`${t} (${rel(f)})`);
  assert.deepEqual([...missing], []);
  assert.ok(hostTokens.size > 300, 'host token list should be read from the real theme file');
});

test('the built client.js only uses tokens that exist in the host theme', { skip: hostSkip }, () => {
  const built = read(join(root, 'client.js'));
  const missing = [...new Set(usedTokens(built))].filter(t => !hostTokens.has(t));
  assert.deepEqual(missing, []);
});

test('dropdown is opaque and uses the theme text colour; dialog surfaces take all colours from the theme', () => {
  const source = read(join(clientDir, '02-styles.js'));
  const pop = /\.ctm-mp-pop\{([^}]*)\}/.exec(source)[1];
  assert.match(pop, /background-color:var\(--dsw-alias-bg-base\)/);
  assert.match(pop, /color:var\(--dsw-alias-label-primary\)/);
  const rules = [...source.matchAll(/\.ctm-(?:mp|dc|tc|int)[\w-]*[^{}]*\{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(rules.length > 20);
  assert.deepEqual(rules.filter(r => /#(?:fff|ffffff|000|000000)\b|:\s*(?:white|black)\b/i.test(r)), []);
});

// ---- canvas colour resolver (client/08c-stage-colors.js) ----
const colorsSource = read(join(clientDir, '08c-stage-colors.js'));
const resolver = new Function(`${colorsSource}; return { STAGE_COLOR_TOKENS, stageNormalizeColor, stageResolveColors };`)();

/** A fake probe + getComputedStyle: `var(--x, fb)` resolves from `tokens`, color-mix style values come back as color(srgb ...). */
function fakeDom(tokens) {
  const probe = { style: { color: '' } };
  const getStyle = p => {
    const m = /^var\((--[a-z0-9-]+),\s*(.+)\)$/.exec(p.style.color);
    return { color: m ? (tokens[m[1]] ?? m[2]) : '' };
  };
  return { probe, getStyle };
}

test('canvas resolver reads concrete colours through a probe element, never var()/color-mix strings', () => {
  const tokens = {
    '--ctm-stage-floor-a': 'rgb(28, 29, 38)', '--ctm-stage-floor-b': 'color(srgb 0.5 0.25 1)',
    '--ctm-stage-grout': 'color(srgb 0 0 0 / 0.24)', '--ctm-stage-wall': 'rgb(42, 43, 58)',
    '--ctm-stage-desk': 'rgb(59, 47, 38)', '--ctm-stage-desk-top': 'rgb(90, 69, 53)', '--ctm-stage-select': 'rgb(245, 158, 11)',
  };
  const { probe, getStyle } = fakeDom(tokens);
  const out = resolver.stageResolveColors(probe, getStyle);
  assert.equal(out.floorA, 'rgb(28, 29, 38)');
  assert.equal(out.floorB, 'rgba(128, 64, 255, 1)');
  assert.equal(out.grout, 'rgba(0, 0, 0, 0.24)');
  assert.equal(out.select, 'rgb(245, 158, 11)');
  for (const v of Object.values(out)) assert.doesNotMatch(v, /var\(|color-mix|color\(/);
  assert.deepEqual(Object.keys(out).sort(), ['deskTop', 'desk', 'floorA', 'floorB', 'grout', 'select', 'wall'].sort());
});

test('canvas resolver re-resolves after a theme swap and falls back when a token is missing', () => {
  const light = { '--ctm-stage-floor-a': 'rgb(217, 215, 230)' }, dark = { '--ctm-stage-floor-a': 'rgb(28, 29, 38)' };
  let active = light;
  const { probe } = fakeDom({});
  const getStyle = p => fakeDom(active).getStyle(p);
  assert.equal(resolver.stageResolveColors(probe, getStyle).floorA, 'rgb(217, 215, 230)');
  active = dark;
  assert.equal(resolver.stageResolveColors(probe, getStyle).floorA, 'rgb(28, 29, 38)');
  active = {};
  assert.equal(resolver.stageResolveColors(probe, getStyle).floorA, resolver.STAGE_COLOR_TOKENS.floorA[1], 'missing token → system-colour fallback');
  assert.match(probe.style.color, /^var\(--ctm-stage-select, /, 'the probe colour is always a var() with a fallback');
});

test('normalizer handles percent channels, clamps, and leaves other values alone', () => {
  assert.equal(resolver.stageNormalizeColor('color(srgb 100% 50% 0%)'), 'rgba(255, 128, 0, 1)');
  assert.equal(resolver.stageNormalizeColor('color(srgb 2 -1 0.2 / 50%)'), 'rgba(255, 0, 51, 0.5)');
  assert.equal(resolver.stageNormalizeColor('  rgb(1, 2, 3) '), 'rgb(1, 2, 3)');
  assert.equal(resolver.stageNormalizeColor(undefined), '');
});

test('the scene draws from resolved colours and re-resolves on theme changes', () => {
  const scene = read(join(clientDir, '08c-stage-scene.js'));
  assert.doesNotMatch(scene, /getPropertyValue\('--ctm-stage/);
  assert.match(scene, /stageResolveColors\(this\.probe, getComputedStyle\)/);
  assert.match(scene, /stageWatchTheme\(/);
  assert.match(colorsSource, /data-ds-dark-theme/);
  assert.match(colorsSource, /MutationObserver/);
  assert.match(colorsSource, /'theme\/change'/);
});
