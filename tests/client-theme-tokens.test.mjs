import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Theme tokens checked against DSH's own theme (light `body` and dark `body[data-ds-dark-theme]`, DSH 0.2.1-rc.5).
// A token missing from DSH silently falls back, which is how the dark-mode picker ended up white on white.
// Add to this list only after confirming the token exists in DSH's theme.
const DSH_TOKENS = new Set([
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-border-l1', '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary', '--dsw-alias-button-primary-dimmed', '--dsw-alias-button-primary-fill', '--dsw-alias-button-primary-hover',
  '--dsw-alias-interactive-bg-active', '--dsw-alias-interactive-bg-hover', '--dsw-alias-label-caption', '--dsw-alias-label-primary',
  '--dsw-alias-label-primary-inverted', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-link',
  '--dsw-alias-state-business-primary', '--dsw-alias-state-error-primary', '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary',
  '--dsw-elevation-prominent', '--dsw-focus-ring-color', '--dsw-focus-ring-width', '--dsw-font-markdown-code-font-family', '--dsw-radius-lg',
  '--dsw-specific-menu',
]);
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

test('客户端只使用 DSH 主题里真实存在的 token', () => {
  const used = [...new Set([...source.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map(m => m[1]))];
  assert.deepEqual(used.filter(t => !DSH_TOKENS.has(t)), []);
});

test('颜色不写死成只适合浅色主题的值', () => {
  assert.deepEqual(source.match(/var\(--dsw-[a-z0-9-]+,\s*#(?:fff|ffffff)\b/gi) ?? [], [], 'token 不能以白色作兜底');
  // Surfaces of the dispatch card, picker, task control and integrations page must take every color from the theme
  // (white text on the accent color elsewhere is fine in both themes).
  const rules = [...source.matchAll(/\.ctm-(?:mp|dc|tc|int)[\w-]*[^{}]*\{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(rules.length > 20);
  assert.deepEqual(rules.filter(r => /#(?:fff|ffffff|000|000000)\b|:\s*(?:white|black)\b/i.test(r)), []);
});

test('下拉框不透明，并使用主题文字色', () => {
  const pop = /\.ctm-mp-pop\{([^}]*)\}/.exec(source)[1];
  assert.match(pop, /background-color:var\(--dsw-alias-bg-base\)/);
  assert.match(pop, /color:var\(--dsw-alias-label-primary\)/);
});
