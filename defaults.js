// Default matching rules: classify whatever chat models the user's DSH channels expose
// (official APIs, OpenAI-compatible gateways, self-hosted relays) into capability tiers,
// then fill every capability that has no explicit route with a primary and same-tier backups.
//
// Rules key on vendor naming conventions, never on one user's channel names or catalog.
// They are a dated snapshot (2026-10); unknown models are reported, not guessed.

/** Non-chat or non-agent models are never candidates. */
const NON_CHAT = /(image|imagine|video|veo|sora|dall-?e|tts|speech|voice|audio|realtime|transcri|whisper|embed|rerank|moderation|safety|guard|ocr|banana|lyria|auto-review|computer-use|search-preview|-lora\b)/;
/** Free / trial variants are unreliable for routing. */
const FREE = /(^|[-:_/])free($|[-:_])/;

/** Turn any gateway spelling into one comparable id. */
export function normalizeModelId(id) {
  let s = String(id).toLowerCase().trim();
  s = s.replace(/:(free|beta|extended|thinking|online|nitro|floor)$/, '');
  s = s.slice(s.lastIndexOf('/') + 1); // anthropic/…, bai/…, pro/deepseek-ai/…, accounts/x/models/…
  s = s.replace(/^models[-_]/, '');
  s = s.replace(/-(\d{4}-\d{2}-\d{2}|\d{8}|\d{6})(?=$|-)/g, ''); // dated snapshots
  s = s.replace(/-(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?=$|-)/g, ''); // MMDD snapshots
  s = s.replace(/-(latest|preview|exp|experimental|instruct|it|chat-latest)(?=$|-)/g, m => (m === '-chat-latest' ? '' : m));
  s = s.replace(/(\d)-(\d)(?=$|-[a-z])/g, '$1.$2'); // claude-opus-4-5 → 4.5
  return s;
}
const strip = s => s.replace(/\b(a)?\d+(\.\d+)?[bkm]\b/g, ' ').replace(/\d{3,}/g, ' ');
function versionOf(norm) {
  const m = strip(norm.replace(/-\d{3}$/, '')).match(/\d+(?:\.\d+)?/); // drop revision suffixes like -001
  return m ? Number(m[0]) : undefined;
}
/** Total parameters in billions, for open-weight sizing. */
function paramsOf(norm) {
  const m = norm.match(/(?:^|[-_])(\d+(?:\.\d+)?)b(?:$|[-_])/);
  return m ? Number(m[1]) : undefined;
}
const bySize = (norm, fallback) => {
  const p = paramsOf(norm);
  return p === undefined ? fallback : p <= 35 ? 'low' : p <= 150 ? 'medium' : 'upper';
};

/**
 * Vendor rules, checked in order. `classes` maps a name keyword to a tier; `base` applies to an
 * unrecognized variant of a known vendor; `minVersion` drops generations too old for agent work.
 */
export const VENDOR_RULES = Object.freeze([
  { vendor: 'claude', match: /^claude-/, minVersion: 4, base: 'upper',
    classes: [[/opus/, 'high'], [/sonnet/, 'upper'], [/haiku/, 'low']] },
  { vendor: 'openai-o', match: /^o\d/, minVersion: 3, base: 'upper',
    classes: [[/-pro\b/, 'high'], [/-mini\b/, 'medium']] },
  { vendor: 'gpt-oss', match: /^gpt-oss/, base: 'medium', size: true },
  { vendor: 'gpt', match: /^(gpt|chatgpt)-/, minVersion: 5, base: 'upper',
    classes: [[/-(pro|astra)\b/, 'high'], [/-(nano|luna)\b/, 'low'], [/-(mini|terra|instant|chat|codex-mini|spark)\b/, 'medium']] },
  { vendor: 'gemini', match: /^gemini-/, minVersion: 3, base: 'upper',
    classes: [[/flash-lite|-lite\b|nano/, 'low'], [/flash/, 'medium'], [/(pro|ultra)/, 'high']] },
  { vendor: 'grok', match: /^grok-/, minVersion: 4, base: 'upper',
    classes: [[/heavy/, 'high'], [/mini/, 'low'], [/(fast|composer|non-reasoning|code)/, 'medium']] },
  { vendor: 'deepseek', match: /^deepseek-/, minVersion: 3, base: 'upper',
    classes: [[/distill/, 'low'], [/(flash|lite)/, 'medium']] },
  { vendor: 'qwen', match: /^(qwen|qwq)/, minVersion: 3, base: 'upper', size: true,
    classes: [[/(max|plus|coder)/, 'upper'], [/(turbo|flash)/, 'medium']] },
  { vendor: 'kimi', match: /^(kimi-|moonshot-)/, minVersion: 2, base: 'upper', classes: [[/(turbo|mini)/, 'medium']] },
  { vendor: 'glm', match: /^glm-/, minVersion: 4.5, base: 'upper', classes: [[/flash/, 'low'], [/air/, 'medium']] },
  { vendor: 'minimax', match: /^minimax-/, minVersion: 2, base: 'upper', classes: [[/flash/, 'low']] },
  { vendor: 'doubao', match: /^doubao-/, base: 'upper', classes: [[/lite/, 'low'], [/flash/, 'medium']] },
  { vendor: 'mimo', match: /^mimo-/, base: 'medium', classes: [[/pro/, 'upper'], [/flash/, 'low']] },
  { vendor: 'mistral', match: /^(mistral|magistral|codestral|devstral|ministral)/, base: 'medium', size: true,
    classes: [[/large/, 'upper'], [/(small|ministral|tiny)/, 'low']] },
  { vendor: 'llama', match: /^(llama|meta-llama)/, minVersion: 4, base: 'medium', size: true },
  { vendor: 'gemma', match: /^gemma/, base: 'low', size: true },
]);
export const TIER_ORDER = Object.freeze(['low', 'medium', 'upper', 'high']);

/** Classify one catalog id; undefined means it is not an auto-routing candidate. */
export function classify(modelId, { rules = VENDOR_RULES, allowFree = false } = {}) {
  const raw = String(modelId).toLowerCase();
  if (!allowFree && FREE.test(raw)) return undefined;
  const norm = normalizeModelId(modelId);
  if (NON_CHAT.test(norm)) return undefined;
  const rule = rules.find(r => r.match.test(norm));
  if (!rule) return undefined;
  const version = versionOf(norm);
  // Two or more generations behind the vendor's current line: not worth routing to.
  if (rule.minVersion !== undefined && version !== undefined && version < rule.minVersion - 1) return undefined;
  const hit = (rule.classes ?? []).find(([re]) => re.test(norm));
  let tier = hit ? hit[1] : rule.size ? bySize(norm, rule.base) : rule.base;
  // An older generation of a known vendor sits one tier lower than its current counterpart.
  const legacy = rule.minVersion !== undefined && version !== undefined && version < rule.minVersion;
  if (legacy) tier = TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(tier) - 1)];
  // Effort/mode suffixes name the same underlying model: one identity for de-duplicating backups.
  const family = norm.replace(/-(xhigh|high|medium|low|minimal|max|thinking|reasoning|non-reasoning|nothink|instruct)$/, '');
  return { norm, family, vendor: rule.vendor, tier, version, ...(legacy ? { legacy: true } : {}) };
}

/** Pick an order inside one tier: preferred vendor, newer version, provider registration order. */
function ranker(prefer, providerOrder) {
  const pref = v => { const i = prefer.indexOf(v); return i < 0 ? prefer.length : i; };
  const prov = p => { const i = providerOrder.indexOf(p); return i < 0 ? providerOrder.length : i; };
  return (a, b) => Number(!!a.legacy) - Number(!!b.legacy) || pref(a.vendor) - pref(b.vendor) || (b.version ?? 0) - (a.version ?? 0) || prov(a.provider) - prov(b.provider) || a.model.localeCompare(b.model);
}
export const MAX_AUTO_FALLBACKS = 3;
/** Same-tier backups: the primary's own model on another channel first, then other vendors, then the rest. */
export function pickFallbacks(pool, primary, limit = MAX_AUTO_FALLBACKS) {
  const rest = pool.filter(c => !(c.provider === primary.provider && c.model === primary.model));
  // Same model on another channel first: identical behavior, only the route differs.
  const same = rest.filter(c => c.norm === primary.norm && c.provider !== primary.provider).slice(0, 1);
  const seen = new Set([primary.family]); const distinct = [];
  for (const c of rest) if (!seen.has(c.family)) { seen.add(c.family); distinct.push(c); }
  const current = distinct.filter(c => !c.legacy); const legacy = distinct.filter(c => c.legacy);
  const order = [...same, ...current.filter(c => c.vendor !== primary.vendor), ...current.filter(c => c.vendor === primary.vendor), ...legacy];
  return order.slice(0, limit).map(({ provider, model }) => ({ provider, model }));
}

/**
 * Match the live catalog to capabilities.
 * @param entries [{provider, model}] in DSH provider registration order
 * @param capabilities {id: {tier, prefer?}} the required tier per capability
 * Never downgrades: an empty tier moves the capability up to the nearest non-empty higher tier.
 */
export function autoMatch(entries, capabilities, options = {}) {
  const candidates = [];
  const unknown = []; const seen = new Set();
  for (const e of entries) {
    const id = `${e.provider}\u0000${e.model}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const c = classify(e.model, options);
    if (c) candidates.push({ provider: e.provider, model: e.model, ...c });
    else unknown.push(`${e.provider}/${e.model}`);
  }
  const providerOrder = [...new Set(entries.map(e => e.provider))];
  const tiers = Object.fromEntries(TIER_ORDER.map(t => [t, [...new Set(candidates.filter(c => c.tier === t).map(c => c.model))]]));
  const routes = {}; const report = [];
  for (const [id, cap] of Object.entries(capabilities)) {
    const start = TIER_ORDER.indexOf(cap.tier);
    if (start < 0) { report.push({ capability: id, status: 'unassigned', reason: `档位 ${cap.tier} 不是标准档位，需手动指定模型` }); continue; }
    const has = t => candidates.some(c => c.tier === t);
    // Prefer the required tier, then higher; only when nothing qualifies take the strongest lower tier and say so.
    const tier = TIER_ORDER.slice(start).find(has) ?? TIER_ORDER.slice(0, start).reverse().find(has);
    if (!tier) { report.push({ capability: id, status: 'unassigned', reason: 'DSH目录中没有可识别的对话模型，需手动指定' }); continue; }
    const pool = candidates.filter(c => c.tier === tier).sort(ranker(cap.prefer ?? [], providerOrder));
    const [primary] = pool;
    const fallbacks = pickFallbacks(pool, primary);
    const delta = TIER_ORDER.indexOf(tier) - start;
    const status = delta === 0 ? 'matched' : delta > 0 ? 'upgraded' : 'below-tier';
    const reason = { matched: undefined, upgraded: `${cap.tier} 档无可用模型，改用更高的 ${tier} 档`, 'below-tier': `目录中没有 ${cap.tier} 档或更高档模型，暂用最强的 ${tier} 档，建议补充渠道` }[status];
    routes[id] = { provider: primary.provider, model: primary.model, tier, fallbacks };
    report.push({ capability: id, status, tier, primary: `${primary.provider}/${primary.model}`, fallbacks: fallbacks.map(f => `${f.provider}/${f.model}`), ...(reason ? { reason } : {}) });
  }
  return { tiers, routes, pools: candidates, report, unknown };
}
