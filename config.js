// Team configuration is data: the seed below is only the initial default.
// Every project may override tiers, capabilities and roles through the
// conversational save tool; nothing here is consulted by name.
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const LINE_CONTROL = /[\x00-\x1f\x7f]/;
const TEXT_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const SECTIONS = ['tiers', 'capabilities', 'roles'];
const CAPABILITY_KEYS = ['job', 'provider', 'model', 'tier', 'search', 'fallbacks', 'prefer'];
const FAILOVER_KEYS = ['retries', 'initialDelayMs', 'maxDelayMs', 'cooldownMs', 'retryCodes', 'failoverCodes', 'failoverStatuses'];
const MAX_FALLBACKS = 8;
const ROLE_KEYS = ['displayName', 'capability', 'description'];
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}
export const seed = deepFreeze({
  name: '默认配置',
  // Same-route retries first (DSH provider retry policy, then `retries` more), then same-tier backups.
  failover: {
    retries: 2, initialDelayMs: 1000, maxDelayMs: 15000, cooldownMs: 60000,
    retryCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE', 'UNKNOWN'],
    failoverCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE', 'UNKNOWN', 'QUOTA', 'ACCOUNT_QUOTA', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL', 'NO_ADAPTER'],
    failoverStatuses: [401, 403, 404, 408, 429, 500, 502, 503, 504],
  },
  // No channel or model is fixed here: tiers and routes are matched from each user's DSH catalog
  // at runtime (defaults.js). `prefer` only orders vendors inside the matched tier.
  tiers: { high: [], upper: [], medium: [], low: [] },
  capabilities: {
    orchestrator: { job: '意图分析、任务分派、决策与最终交付', tier: 'high', search: true, prefer: ['claude', 'gpt', 'gemini'] },
    'technical-director': { job: '技术方案、任务拆解、接口契约与技术验收', tier: 'upper', search: false, prefer: ['gpt', 'claude', 'gemini'] },
    backend: { job: '服务端、数据库、接口与后端测试', tier: 'upper', search: false, prefer: ['gpt', 'claude', 'deepseek', 'qwen', 'kimi', 'glm'] },
    frontend: { job: '页面、组件、交互与前端测试', tier: 'medium', search: false, prefer: ['gemini', 'claude', 'gpt'] },
    research: { job: '调用检索工具、核实来源与交叉验证', tier: 'medium', search: true, prefer: ['gemini', 'gpt', 'grok'] },
    writer: { job: '文档与交付说明', tier: 'low', search: false, prefer: ['gpt', 'claude', 'gemini', 'deepseek', 'qwen'] },
    qa: { job: '测试计划、回归测试、接口与界面验收、失败复现及证据；区分实测、模拟与未验证，不默认修改业务实现', tier: 'upper', search: false, prefer: ['gpt', 'claude', 'gemini'] },
  },
  roles: {
    lead: { displayName: '孙权', capability: 'orchestrator' },
    'zhuge-liang': { displayName: '诸葛亮', capability: 'technical-director' },
    'lv-bu': { displayName: '吕布', capability: 'backend' },
    'diao-chan': { displayName: '貂蝉', capability: 'frontend' },
    'zhao-yun': { displayName: '赵云', capability: 'research' },
    'chen-lin': { displayName: '陈琳', capability: 'writer' },
    'zhou-yu': { displayName: '周瑜', capability: 'qa' },
  },
});
function text(value, max, label, multiline = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || (multiline ? TEXT_CONTROL : LINE_CONTROL).test(value)) {
    throw new Error(`${label}须为1–${max}字符且不含控制字符`);
  }
  return value.trim();
}
function entries(map, label) {
  if (!isMap(map)) throw new Error(`${label}必须为对象`);
  for (const id of Object.keys(map)) if (!ID.test(id)) throw new Error(`${label}标识 ${id} 须为小写短横线格式`);
  return Object.entries(map);
}
function onlyKeys(value, allowed, label) {
  if (!isMap(value)) throw new Error(`${label}必须为对象`);
  const extra = Object.keys(value).filter(k => !allowed.includes(k));
  if (extra.length) throw new Error(`${label}含未知字段 ${extra.join(', ')}`);
}
/** Validate one complete effective configuration and return a normalized copy. */
export function validateConfig(config) {
  const name = text(config.name ?? seed.name, 80, '配置名称');
  const tiers = {};
  for (const [id, models] of entries(config.tiers, '档位')) {
    if (!Array.isArray(models) || models.length > 200) throw new Error(`档位 ${id} 须为不超过200项的模型ID数组`);
    const list = models.map(m => text(m, 200, `档位 ${id} 的模型ID`));
    if (new Set(list).size !== list.length) throw new Error(`档位 ${id} 含重复模型`);
    tiers[id] = list;
  }
  const capabilities = {};
  for (const [id, c] of entries(config.capabilities, '能力')) {
    onlyKeys(c, CAPABILITY_KEYS, `能力 ${id}`);
    if (!Object.hasOwn(tiers, c.tier)) throw new Error(`能力 ${id} 的档位 ${c.tier} 未配置`);
    if (c.search !== undefined && typeof c.search !== 'boolean') throw new Error(`能力 ${id} 的 search 必须为布尔值`);
    if (c.prefer !== undefined && (!Array.isArray(c.prefer) || c.prefer.length > 20)) throw new Error(`能力 ${id} 的 prefer 须为厂商标识数组`);
    const common = { job: text(c.job, 2000, `能力 ${id} 的职责`, true), tier: c.tier, search: c.search === true, prefer: (c.prefer ?? []).map(v => text(v, 40, `能力 ${id} 的厂商偏好`)) };
    // A capability may stay unassigned when the user's catalog has nothing usable; its role then keeps the session model.
    if (c.provider === undefined && c.model === undefined) {
      if (c.fallbacks?.length) throw new Error(`能力 ${id} 未指定主模型，不能只配置备选`);
      capabilities[id] = { ...common, fallbacks: [] };
      continue;
    }
    const model = text(c.model, 200, `能力 ${id} 的模型ID`);
    if (!tiers[c.tier].includes(model)) throw new Error(`能力 ${id} 的模型 ${model} 不在档位 ${c.tier} 中；先经用户确认把该模型加入档位，不按名称猜测`);
    const provider = text(c.provider, 200, `能力 ${id} 的渠道`);
    capabilities[id] = { ...common, provider, model,
      fallbacks: validateFallbacks(c.fallbacks ?? [], { provider, model }, tiers[c.tier], `能力 ${id}`) };
  }
  if (!capabilities.orchestrator) throw new Error('必须保留 orchestrator 能力');
  const roles = {}; const names = new Set();
  for (const [id, r] of entries(config.roles, '角色')) {
    onlyKeys(r, ROLE_KEYS, `角色 ${id}`);
    if (!Object.hasOwn(capabilities, r.capability)) throw new Error(`角色 ${id} 绑定了未知能力 ${r.capability}`);
    if ((id === 'lead') !== (r.capability === 'orchestrator')) throw new Error('lead 必须且只有 lead 可以绑定 orchestrator 能力');
    const displayName = text(r.displayName, 40, `角色 ${id} 的显示名`);
    if (names.has(displayName)) throw new Error(`显示名 ${displayName} 重复`);
    names.add(displayName);
    roles[id] = { displayName, capability: r.capability, ...(r.description === undefined ? {} : { description: text(r.description, 2000, `角色 ${id} 的职责描述`, true) }) };
  }
  if (!roles.lead) throw new Error('必须保留 lead 角色');
  return { name, failover: validateFailover(config.failover ?? seed.failover), tiers, capabilities, roles };
}
/** Ordered same-tier backups: never another tier, never the primary twice. */
function validateFallbacks(list, primary, tierModels, label) {
  if (!Array.isArray(list) || list.length > MAX_FALLBACKS) throw new Error(`${label} 的备选须为不超过${MAX_FALLBACKS}项的数组`);
  const seen = new Set([`${primary.provider}\u0000${primary.model}`]);
  return list.map((f, i) => {
    onlyKeys(f, ['provider', 'model'], `${label} 的第${i + 1}个备选`);
    const route = { provider: text(f.provider, 200, `${label} 备选渠道`), model: text(f.model, 200, `${label} 备选模型ID`) };
    if (!tierModels.includes(route.model)) throw new Error(`${label} 的备选 ${route.provider}/${route.model} 不在同一档位中；不允许跨档或自动降档`);
    const key = `${route.provider}\u0000${route.model}`;
    if (seen.has(key)) throw new Error(`${label} 的备选 ${route.provider}/${route.model} 与主模型或其他备选重复`);
    seen.add(key);
    return route;
  });
}
function count(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label}须为${min}–${max}的整数`);
  return value;
}
function codes(list, label) {
  if (!Array.isArray(list) || list.length > 50) throw new Error(`${label}须为数组`);
  return list.map(c => text(c, 64, label));
}
function validateFailover(f) {
  onlyKeys(f, FAILOVER_KEYS, '容灾策略');
  const merged = { ...seed.failover, ...f };
  const out = {
    retries: count(merged.retries, 0, 10, '同一模型的追加重试次数'),
    initialDelayMs: count(merged.initialDelayMs, 100, 60000, '首次重试等待毫秒数'),
    maxDelayMs: count(merged.maxDelayMs, 100, 120000, '最长重试等待毫秒数'),
    cooldownMs: count(merged.cooldownMs, 5000, 600000, '故障模型冷却毫秒数'),
    retryCodes: codes(merged.retryCodes, '可重试错误码'),
    failoverCodes: codes(merged.failoverCodes, '可切换错误码'),
    failoverStatuses: merged.failoverStatuses.map(s => count(s, 400, 599, 'HTTP状态码')),
  };
  if (out.initialDelayMs > out.maxDelayMs) throw new Error('首次重试等待不能大于最长等待');
  return out;
}
// null in a stored override removes the entry; objects merge field by field.
function layer(base = {}, over = {}) {
  const out = { ...base };
  for (const [id, value] of Object.entries(over ?? {})) {
    if (value === null) delete out[id];
    else out[id] = isMap(value) && isMap(base[id]) ? { ...base[id], ...value } : value;
  }
  return out;
}
/** Merge project overrides onto the base configuration and validate the result. */
export function effectiveConfig(overrides = {}, base = seed) {
  return validateConfig({
    name: overrides.name ?? base.name,
    failover: { ...base.failover, ...(overrides.failover ?? {}) },
    tiers: layer(base.tiers, overrides.tiers),
    capabilities: layer(base.capabilities, overrides.capabilities),
    roles: layer(base.roles, overrides.roles),
  });
}
/** Base configuration from preset config: bindings may rename or add seed roles. */
export function baseConfig(config = {}) {
  if (config.bindings === undefined) return seed;
  if (!isMap(config.bindings)) throw new Error('bindings 必须为对象');
  const roles = Object.fromEntries(Object.entries(config.bindings).map(([id, b]) => [id, isMap(b) ? { ...b } : b]));
  return deepFreeze(validateConfig({ ...seed, roles }));
}
/**
 * Layer one automatic catalog match (defaults.js autoMatch) onto a base: detected tiers are added,
 * and only capabilities without an explicit route in the base receive the detected primary and backups.
 */
export function withAutoRoutes(base, match) {
  const tiers = { ...base.tiers };
  for (const [tier, models] of Object.entries(match.tiers)) tiers[tier] = [...new Set([...(tiers[tier] ?? []), ...models])];
  const capabilities = {};
  for (const [id, c] of Object.entries(base.capabilities)) {
    const route = match.routes[id];
    capabilities[id] = c.provider === undefined && route ? { ...c, ...route } : c;
  }
  return deepFreeze(validateConfig({ ...base, tiers, capabilities }));
}
/** Upgrade the earlier names/descriptions/routes file format in memory. */
export function migrateProject(raw) {
  if (!isMap(raw)) throw new Error('项目团队配置文件格式无效');
  const { revision = 0, name, failover, names = {}, descriptions = {}, routes = {}, tiers = {}, capabilities = {}, roles = {} } = raw;
  const legacyRoles = {};
  for (const id of new Set([...Object.keys(names), ...Object.keys(descriptions)])) {
    legacyRoles[id] = { ...(names[id] === undefined ? {} : { displayName: names[id] }), ...(descriptions[id] === undefined ? {} : { description: descriptions[id] }) };
  }
  return { revision, ...(name === undefined ? {} : { name }), ...(failover === undefined ? {} : { failover }), tiers: { ...tiers }, capabilities: { ...routes, ...capabilities }, roles: { ...legacyRoles, ...roles } };
}
/**
 * Apply one conversational patch to stored overrides.
 * Per entry: an object merges fields, null reverts to the default, false removes the entry.
 */
export function applyPatch(overrides, patch) {
  const next = { revision: overrides.revision ?? 0, name: overrides.name };
  if (patch.name !== undefined) next.name = text(patch.name, 80, '配置名称');
  if (next.name === undefined) delete next.name;
  // failover is one object: fields merge, null restores the preset policy.
  const failover = patch.failover === null ? undefined : patch.failover === undefined ? overrides.failover : { ...(overrides.failover ?? {}), ...patch.failover };
  if (patch.failover !== undefined && patch.failover !== null) onlyKeys(patch.failover, FAILOVER_KEYS, '容灾策略');
  if (failover !== undefined) next.failover = failover;
  for (const section of SECTIONS) {
    next[section] = { ...(overrides[section] ?? {}) };
    if (patch[section] === undefined) continue;
    for (const [id, value] of entries(patch[section], section)) {
      if (value === null) delete next[section][id];
      else if (value === false) next[section][id] = null;
      else next[section][id] = isMap(value) && isMap(next[section][id]) ? { ...next[section][id], ...value } : value;
    }
  }
  return next;
}
/** One model-facing row per role, with the route its capability resolves to. */
export function roleView(effective) {
  return Object.entries(effective.roles).map(([id, r]) => {
    const c = effective.capabilities[r.capability];
    return { id, displayName: r.displayName, capability: r.capability, description: r.description ?? c.job, provider: c.provider, model: c.model, tier: c.tier, search: c.search, fallbacks: c.fallbacks };
  });
}
const SECTION_LABEL = { tiers: '档位', capabilities: '能力', roles: '角色' };
/** Human-readable list of every field that differs between two effective configurations. */
export function describeChanges(before, after) {
  const lines = before.name === after.name ? [] : [`配置名称：${before.name} → ${after.name}`];
  const fa = JSON.stringify(before.failover); const fb = JSON.stringify(after.failover);
  if (fa !== fb) lines.push(`容灾策略：${fa} → ${fb}`);
  for (const section of SECTIONS) {
    for (const id of new Set([...Object.keys(before[section]), ...Object.keys(after[section])])) {
      const a = JSON.stringify(before[section][id]); const b = JSON.stringify(after[section][id]);
      if (a !== b) lines.push(`${SECTION_LABEL[section]} ${id}：${a ?? '（新增）'} → ${b ?? '（删除）'}`);
    }
  }
  return lines;
}
/** Resolve the native Team identity to one configured role; unknown members fail with guidance. */
export function resolveRole(membership, effective) {
  const id = !membership || membership.role === 'lead' ? 'lead' : membership.name;
  const role = Object.hasOwn(effective.roles, id) ? effective.roles[id] : undefined;
  if (!role) throw new Error(`队友 ${id} 未在当前项目的团队配置中登记，无法确定模型。主控请加载 project-role-theme 技能，经用户确认后用 capability_team_save 登记该角色及能力；不按名称猜测模型。`);
  const c = effective.capabilities[role.capability];
  return { id, displayName: role.displayName, capability: role.capability, description: role.description ?? c.job, provider: c.provider, model: c.model, tier: c.tier, search: c.search, fallbacks: c.fallbacks, failover: effective.failover, ...(c.provider === undefined ? { unassigned: true } : {}) };
}
