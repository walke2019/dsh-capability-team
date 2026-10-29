// Default matching rules: classify whatever chat models the user's DSH channels expose
// (official APIs, OpenAI-compatible gateways, self-hosted relays) into capability tiers,
// then fill every capability that has no explicit route with a primary and same-tier backups.
//
// Rules key on vendor naming conventions, never on one user's channel names or catalog.
// Naming snapshot: 2026-10 (checked against the OpenRouter public catalog). Vendors rename their
// lines between generations, so each rule lists both the current and the previous scheme.
// "Current" is relative to the user's own catalog: when a newer major version of the same vendor
// is present, older ones count as legacy (one tier lower, ranked last). Unknown ids are reported.

/** Non-chat or non-agent models are never candidates. */
const NON_CHAT = /(image|imagine|video|veo|sora|dall-?e|tts|speech|voice|audio|realtime|transcri|whisper|embed|rerank|moderation|safety|guard|ocr|banana|lyria|auto-review|computer-use|search-preview|-lora\b)/;
/** Free / trial variants are unreliable for routing. */
const FREE = /(^|[-:_/])free($|[-:_])/;

/** Turn any gateway spelling into one comparable id. */
export function normalizeModelId(id) {
  let s = String(id).toLowerCase().trim();
  s = s.replace(/:(free|beta|extended|thinking|online|nitro|floor|batch)$/, '');
  s = s.slice(s.lastIndexOf('/') + 1); // anthropic/…, bai/…, pro/deepseek-ai/…, accounts/x/models/…
  s = s.replace(/^models[-_]/, '');
  s = s.replace(/-(\d{4}-\d{2}-\d{2}|\d{8}|\d{6})(?=$|-)/g, ''); // dated snapshots
  s = s.replace(/-(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?=$|-)/g, ''); // MMDD snapshots
  s = s.replace(/-chat-latest$/, '');
  s = s.replace(/(\d)-(\d)(?=$|-[a-z])/g, '$1.$2'); // claude-opus-4-5 → 4.5
  return s;
}
const strip = s => s.replace(/\b(a)?\d+(\.\d+)?[bkmt]\b/g, ' ').replace(/\d{3,}/g, ' ');
function versionOf(norm) {
  const m = strip(norm.replace(/-\d{3}$/, '')).match(/\d+(?:\.\d+)?/); // drop revision suffixes like -001
  return m ? Number(m[0]) : undefined;
}
/** Total parameters in billions, for open-weight sizing (`-32b`, `-2.4t-a95b`). */
function paramsOf(norm) {
  const m = norm.match(/(?:^|[-_])(\d+(?:\.\d+)?)([bt])(?:$|[-_])/);
  return m ? Number(m[1]) * (m[2] === 't' ? 1000 : 1) : undefined;
}
const bySize = (norm, fallback) => {
  const p = paramsOf(norm);
  return p === undefined ? fallback : p <= 40 ? 'low' : p <= 150 ? 'medium' : 'upper';
};
/** Effort / speed / mode variants of one model share an identity, so they never fill two backup slots. */
const MODES = /-(xhigh|high|medium|low|minimal|max|thinking|reasoning|non-reasoning|nothink|instruct|it|preview|exp|latest|ultraspeed|fast|customtools)$/;

/**
 * Vendor rules, checked in order; the first matching class wins, so line names precede suffixes.
 * `floor`: versions below it are too old for agent work and are excluded.
 * `modes`: vendor-specific suffixes that are a mode of the same model rather than another tier.
 */
export const VENDOR_RULES = Object.freeze([
  // Claude: Opus / Fable flagship, Sonnet main, Haiku light.
  { vendor: 'claude', match: /^claude-/, floor: 4, base: 'upper',
    classes: [[/(opus|fable)/, 'high'], [/sonnet/, 'upper'], [/haiku/, 'low']] },
  // OpenAI GPT-6+: astra flagship, sol main, terra balanced, luna light; "-pro" exists on every
  // line at the same price, so it is a reasoning mode. GPT-5.x: -pro flagship, -mini, -nano.
  { vendor: 'gpt', match: /^(gpt|chatgpt)-(?!oss)/, floor: 5, base: 'upper', modes: /-pro$/,
    classes: [[/-astra/, 'high'], [/-sol/, 'upper'], [/-terra/, 'medium'], [/-luna/, 'low'],
      [/-pro\b/, 'high'], [/-nano\b/, 'low'], [/-(mini|instant|chat)\b/, 'medium']] },
  { vendor: 'gpt-oss', match: /^gpt-oss/, base: 'medium', size: true },
  // Gemini 4 uses codenames (gemini-4-argon) for the flagship; 3.x used -pro. Flash / Flash-Lite below.
  { vendor: 'gemini', match: /^gemini-/, floor: 3, base: 'high',
    classes: [[/(flash-lite|-lite\b|-nano\b)/, 'low'], [/flash/, 'medium'], [/(pro|ultra)/, 'high']] },
  { vendor: 'grok', match: /^grok-/, floor: 4, base: 'upper',
    classes: [[/heavy/, 'high'], [/mini/, 'low'], [/(build|composer|code|non-reasoning)/, 'medium']] },
  // Chinese vendors: "-flash" lines are priced like light models (~0.1/0.5 per M), unlike Gemini Flash.
  { vendor: 'deepseek', match: /^deepseek-/, floor: 3, base: 'upper',
    classes: [[/distill/, 'low'], [/(flash|lite)/, 'low']] },
  { vendor: 'qwen', match: /^(qwen|qwq)/, floor: 3, base: 'upper', size: true,
    classes: [[/(max|prime|coder)/, 'upper'], [/plus/, 'medium'], [/(turbo|flash)/, 'low']] },
  { vendor: 'kimi', match: /^(kimi-|moonshot-)/, floor: 2, base: 'upper', classes: [[/(turbo|mini)/, 'medium']] },
  { vendor: 'glm', match: /^glm-/, floor: 4.5, base: 'upper', classes: [[/flashx/, 'medium'], [/flash/, 'low'], [/air/, 'medium']] },
  { vendor: 'minimax', match: /^minimax-/, floor: 2, base: 'upper', classes: [[/flash/, 'low']] },
  { vendor: 'mimo', match: /^mimo-/, floor: 2, base: 'medium', classes: [[/pro/, 'upper'], [/flash/, 'low']] },
  { vendor: 'doubao', match: /^doubao-/, base: 'upper', classes: [[/lite/, 'low'], [/flash/, 'medium']] },
  { vendor: 'mistral', match: /^(mistral|magistral|codestral|devstral|ministral)/, base: 'medium', size: true,
    classes: [[/large/, 'upper'], [/medium/, 'medium'], [/(small|ministral|tiny)/, 'low']] },
  { vendor: 'llama', match: /^(llama|meta-llama)/, floor: 4, base: 'medium', size: true },
  { vendor: 'gemma', match: /^gemma/, base: 'low', size: true },
]);
export const TIER_ORDER = Object.freeze(['low', 'medium', 'upper', 'high']);
const down = tier => TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(tier) - 1)];

/** Classify one id on its own; generation (legacy) is decided against the whole catalog in autoMatch. */
export function classify(modelId, { rules = VENDOR_RULES, allowFree = false } = {}) {
  const raw = String(modelId).toLowerCase();
  if (!allowFree && FREE.test(raw)) return undefined;
  const norm = normalizeModelId(modelId);
  if (NON_CHAT.test(norm)) return undefined;
  const rule = rules.find(r => r.match.test(norm));
  if (!rule) return undefined;
  const version = versionOf(norm);
  if (rule.floor !== undefined && version !== undefined && version < rule.floor) return undefined;
  const hit = (rule.classes ?? []).find(([re]) => re.test(norm));
  const tier = hit ? hit[1] : rule.size ? bySize(norm, rule.base) : rule.base;
  let family = norm;
  for (let prev; prev !== family;) { prev = family; family = family.replace(MODES, ''); if (rule.modes) family = family.replace(rule.modes, ''); }
  return { norm, family, vendor: rule.vendor, tier, version };
}

/**
 * A model is legacy only when the same vendor line (same vendor, same tier) has a newer major in
 * this catalog: gemini-3.1-pro is legacy next to gemini-4-argon, but gemini-3.8-flash is not, because
 * no Gemini 4 Flash exists. Legacy models drop one tier and rank last.
 */
function markGenerations(candidates) {
  const newest = {};
  const line = c => `${c.vendor}\u0000${c.tier}`;
  for (const c of candidates) if (c.version !== undefined) newest[line(c)] = Math.max(newest[line(c)] ?? 0, Math.floor(c.version));
  for (const c of candidates) {
    if (c.version !== undefined && Math.floor(c.version) < newest[line(c)]) { c.legacy = true; c.tier = down(c.tier); }
  }
  return candidates;
}

/** Pick an order inside one tier: current generation, preferred vendor, newer version, provider order. */
function ranker(prefer, providerOrder) {
  const pref = v => { const i = prefer.indexOf(v); return i < 0 ? prefer.length : i; };
  const prov = p => { const i = providerOrder.indexOf(p); return i < 0 ? providerOrder.length : i; };
  // A bare id beats its mode variants (gpt-6.1-sol before gpt-6.1-sol-pro) as the default primary.
  const variant = c => Number(c.norm !== c.family);
  // Versionless aliases (gpt-astra-latest) point at a moving target: use pinned versions first.
  const alias = c => Number(c.version === undefined);
  return (a, b) => Number(!!a.legacy) - Number(!!b.legacy) || alias(a) - alias(b) || pref(a.vendor) - pref(b.vendor) || (b.version ?? 0) - (a.version ?? 0)
    || variant(a) - variant(b) || prov(a.provider) - prov(b.provider) || a.model.localeCompare(b.model);
}
export const MAX_AUTO_FALLBACKS = 3;
/** Same-tier backups: the primary's own model on another channel first, then other vendors, then the rest. */
export function pickFallbacks(pool, primary, limit = MAX_AUTO_FALLBACKS) {
  const rest = pool.filter(c => !(c.provider === primary.provider && c.model === primary.model));
  // Same model on another channel first: identical behavior, only the route differs.
  const same = rest.filter(c => c.norm === primary.norm && c.provider !== primary.provider).slice(0, 1);
  const seen = new Set([primary.family]); const distinct = [];
  for (const c of rest) if (!seen.has(c.family)) { seen.add(c.family); distinct.push(c); }
  const current = distinct.filter(c => !c.legacy && c.version !== undefined);
  const others = current.filter(c => c.vendor !== primary.vendor);
  // One model per other vendor first, so a single vendor outage cannot take out every backup.
  const vendors = new Set(); const spread = [];
  for (const c of others) if (!vendors.has(c.vendor)) { vendors.add(c.vendor); spread.push(c); }
  const order = [...same, ...spread, ...others.filter(c => !spread.includes(c)), ...current.filter(c => c.vendor === primary.vendor),
    ...distinct.filter(c => !current.includes(c))];
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
  markGenerations(candidates);
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
