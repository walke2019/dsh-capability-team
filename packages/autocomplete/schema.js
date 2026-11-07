// Settings for composer autocomplete. No credentials live here: fixed routing names an existing provider and model.
// schemastery is a direct dependency (the version DSH ships), so the settings form appears on every install layout.
// On some layouts (e.g. a pnpm-managed DSH) a peer cannot be resolved from the profile and the form silently vanished.
import { readFileSync } from 'node:fs';
let Schema = null;
try { Schema = (await import('@deepseek-ai/schemastery')).default; } catch { /* still optional: the endpoint works without a form */ }

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  routeMode: 'session',
  provider: '',
  model: '',
  maxSuggestions: 3,
  typePauseMs: 700,
  mobileBar: true,
  maxOutputTokens: 220,
  timeoutMs: 20_000,
  maxMessages: 10,
  maxChars: 8_000,
});

/** Inclusive integer ranges; the predictor rejects values outside them instead of guessing. */
export const LIMITS = Object.freeze({
  maxSuggestions: [1, 5], typePauseMs: [200, 5000], maxOutputTokens: [16, 2048],
  timeoutMs: [1000, 120000], maxMessages: [1, 50], maxChars: [500, 32000],
});

/** Field descriptions per locale; the settings form shows the one matching the DSH language. */
export const FIELD_TEXT = Object.freeze(Object.fromEntries([['en-US', 'en'], ['zh-CN', 'zh']].map(([locale, name]) =>
  [locale, JSON.parse(readFileSync(new URL(`./i18n/schema.${name}.json`, import.meta.url), 'utf8'))])));

/** Every field is volatile, so DSH settings apply without remounting the plugin. */
export function createConfig(z) {
  const en = FIELD_TEXT['en-US'];
  const int = key => z.natural().min(LIMITS[key][0]).max(LIMITS[key][1]).default(DEFAULT_CONFIG[key]).description(en[key]).volatile();
  const schema = z.object({
    enabled: z.boolean().default(true).description(en.enabled).volatile(),
    routeMode: z.union(['session', 'fixed']).default('session').description(en.routeMode).volatile(),
    provider: z.string().default('').description(en.provider).volatile(),
    model: z.string().default('').description(en.model).volatile(),
    maxSuggestions: int('maxSuggestions'),
    typePauseMs: int('typePauseMs'),
    mobileBar: z.boolean().default(true).description(en.mobileBar).volatile(),
    maxOutputTokens: int('maxOutputTokens'),
    timeoutMs: int('timeoutMs'),
    maxMessages: int('maxMessages'),
    maxChars: int('maxChars'),
  });
  return typeof schema.i18n === 'function' ? schema.i18n(FIELD_TEXT) : schema;
}

export const Config = Schema ? createConfig(Schema) : undefined;
