// Settings for composer autocomplete. No credentials live here: fixed routing names an existing provider and model.
let Schema = null;
try { Schema = (await import('@deepseek-ai/schemastery')).default; } catch { /* host without schemastery: no settings form */ }

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  routeMode: 'session',
  provider: '',
  model: '',
  maxSuggestions: 3,
  typePauseMs: 700,
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

/** Every field is volatile, so DSH settings apply without remounting the plugin. */
export function createConfig(z) {
  const int = key => z.natural().min(LIMITS[key][0]).max(LIMITS[key][1]).default(DEFAULT_CONFIG[key]).volatile();
  return z.object({
    enabled: z.boolean().default(true).description('Enable composer suggestions; accepting one never sends it.').volatile(),
    routeMode: z.union(['session', 'fixed']).default('session')
      .description('session follows the active session; fixed requires both provider and model.').volatile(),
    provider: z.string().default('').description('Existing provider ID for fixed routing. Not an API key.').volatile(),
    model: z.string().default('').description('Exact model ID for fixed routing.').volatile(),
    maxSuggestions: int('maxSuggestions').description('Suggestion candidates per prediction (1-5).'),
    typePauseMs: int('typePauseMs').description('Typing pause before a continuation request, in ms.'),
    maxOutputTokens: int('maxOutputTokens').description('Maximum generated tokens per prediction.'),
    timeoutMs: int('timeoutMs').description('Prediction timeout in ms.'),
    maxMessages: int('maxMessages').description('Recent conversation messages used as context.'),
    maxChars: int('maxChars').description('Maximum context characters per prediction.'),
  });
}

export const Config = Schema ? createConfig(Schema) : undefined;
