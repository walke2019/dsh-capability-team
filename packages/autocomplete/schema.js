// Settings for composer autocomplete. No credentials live here: fixed routing names an existing provider and model.
// schemastery is a direct dependency (the version DSH ships), so the settings form appears on every install layout.
// On some layouts (e.g. a pnpm-managed DSH) a peer cannot be resolved from the profile and the form silently vanished.
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
export const FIELD_TEXT = Object.freeze({
  'zh-CN': {
    enabled: '启用输入框补全；采纳建议只填入输入框，绝不自动发送。',
    routeMode: 'session 跟随当前会话模型；fixed 使用下方固定的提供商与模型（两者都要填）。',
    provider: '固定模式使用的已有提供商 ID，不是 API 密钥。',
    model: '固定模式使用的模型 ID。',
    maxSuggestions: '每次预测的候选数（1–5）。',
    typePauseMs: '停止输入多久后请求续写（毫秒）。',
    mobileBar: '在触屏设备上把建议显示在输入框上方的可点击建议栏中。',
    maxOutputTokens: '每次预测最多生成的 token 数。',
    timeoutMs: '单次预测超时（毫秒）。',
    maxMessages: '作为上下文的最近消息条数。',
    maxChars: '每次预测的上下文字符上限。',
  },
  'en-US': {
    enabled: 'Enable composer suggestions; accepting one fills the composer and never sends it.',
    routeMode: 'session follows the active session; fixed uses the provider and model below (both required).',
    provider: 'Existing provider ID for fixed routing. Not an API key.',
    model: 'Model ID for fixed routing.',
    maxSuggestions: 'Suggestion candidates per prediction (1-5).',
    typePauseMs: 'Typing pause before a continuation is requested, in ms.',
    mobileBar: 'On touch devices, show suggestions in a tappable bar above the composer.',
    maxOutputTokens: 'Maximum generated tokens per prediction.',
    timeoutMs: 'Prediction timeout in ms.',
    maxMessages: 'Recent conversation messages used as context.',
    maxChars: 'Maximum context characters per prediction.',
  },
});

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
