import { t, roleText, m as modelText } from './i18n.js';
// Team configuration is data: the seed below is only the initial default.
// Every project may override tiers, capabilities and roles through the
// conversational save tool; nothing here is consulted by name.
import { validateFileLimits } from './file-limits.js';
import { validateRotation } from './session-rotation.js';
import { validateSkillsPolicy } from './teammate-context.js';
import { validateTokenRules } from './token-discipline.js';
import { unroutableReason } from './defaults.js';
import { DEFAULT_ROLES, rosterBase, legacyRoleId } from './roster-defaults.js';
import { patchSingleModel, effectiveRoute, singleModelChanges } from './single-model.js';
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const LINE_CONTROL = /[\x00-\x1f\x7f]/;
const TEXT_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const SECTIONS = ['tiers', 'capabilities', 'roles'];
const CAPABILITY_KEYS = ['job', 'whenToUse', 'provider', 'model', 'tier', 'search', 'fallbacks', 'prefer', 'access', 'maxTokens', 'longContext', 'planFirst', 'skills'];
const ACCESS_KEYS = ['deny', 'editPaths', 'shell', 'preset'];
const FAILOVER_KEYS = ['retries', 'initialDelayMs', 'maxDelayMs', 'cooldownMs', 'retryCodes', 'failoverCodes', 'failoverStatuses'];
const MAX_FALLBACKS = 3;
const ROLE_KEYS = ['displayName', 'capability', 'description'];
const WORKFLOW_KEYS = ['mode', 'analysisBudget', 'directBudget', 'freeTools', 'freeModels', 'analysisTools', 'coordinationTools', 'fileLimits', 'confirmDispatch', 'rotation', 'enforceWriteScopes', 'tokens'];
const FREE_TOOL_LEVELS = ['none', 'read', 'write'];
const WORKFLOW_MODES = ['enforce', 'remind', 'off'];
export const CONFIRM_MODES = ['always', 'on-change', 'never'];
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}
export const seed = deepFreeze({
  name: t('config.050'),
  // Same-route retries first (DSH provider retry policy, then `retries` more), then same-tier backups.
  failover: {
    retries: 2, initialDelayMs: 1000, maxDelayMs: 15000, cooldownMs: 60000,
    retryCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE', 'UNKNOWN'],
    failoverCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE', 'UNKNOWN', 'QUOTA', 'ACCOUNT_QUOTA', 'AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL', 'NO_ADAPTER'],
    failoverStatuses: [401, 403, 404, 408, 429, 500, 502, 503, 504],
  },
  // Lead dispatch workflow: every new user request is analysed and assigned before execution.
  // Tools not listed in either list count as execution (shell, file writes, search, generic subagents).
  workflow: {
    mode: 'enforce',
    analysisBudget: 6, // read-only steps allowed before a dispatch plan exists
    directBudget: 3, // execution steps allowed when the Lead decides to handle a request alone
    // Tools of the free OpenCode model: none (text only) / read (read+search project) / write (also
    // create and edit project files). Never shell, web or outside paths. Project files reach the free
    // model's cloud from `read` up, so the default is none.
    freeTools: 'none',
    // Show the user each assigned role's model and fallbacks before a delegate plan takes effect:
    // always / on-change (the first plan of a session, then only when a route changes) / never.
    confirmDispatch: 'on-change',
    // Edits outside the write scopes of the board tasks a teammate holds are refused (DSH itself only warns).
    enforceWriteScopes: true,
    // Optional order of free models; empty = every free model in OpenCode's catalog, newest first.
    // Entries are re-checked against the catalog at run time, so a paid model can never be listed in.
    freeModels: [],
    // Read-only lookups, including session history, so the Lead can orient itself before planning.
    analysisTools: ['read', 'glob', 'grep', 'read_image', 'session_search', 'session_event_search', 'session_event_read'],
    coordinationTools: ['spawn_teammate', 'send_message', 'wait_agent', 'list_agents', 'interrupt_agent',
      'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update', 'ask_user_question',
      'capability_team_read', 'capability_model_catalog', 'capability_team_save', 'capability_team_export', 'capability_team_import',
      'skill', 'todo_write', 'get_goal', 'create_goal', 'update_goal', 'exit_plan_mode', 'present',
      'job_list', 'job_output', 'job_kill', 'working_directory'],
  },
  // No channel or model is fixed here: tiers and routes are matched from each user's DSH catalog
  // at runtime (defaults.js). `prefer` only orders vendors inside the matched tier.
  tiers: { high: [], upper: [], medium: [], low: [] },
  capabilities: {
    // whenToUse tells the Lead when to pick a capability; job says what it does.
    orchestrator: { job: roleText('config.051'), tier: 'high', search: true, prefer: ['claude', 'gpt', 'gemini'] },
    'technical-director': { job: roleText('config.052'), whenToUse: roleText('config.053'), tier: 'upper', search: false, prefer: ['gpt', 'claude', 'gemini'] },
    backend: { job: roleText('config.054'), whenToUse: roleText('config.055'), tier: 'upper', search: false, prefer: ['gpt', 'claude', 'deepseek', 'qwen', 'kimi', 'glm'] },
    frontend: { job: roleText('config.056'), whenToUse: roleText('config.057'), tier: 'medium', search: false, prefer: ['gemini', 'claude', 'gpt'] },
    // access: tools a role may not use, whether it may run commands, and the project paths it may edit.
    research: { job: roleText('config.058'), whenToUse: roleText('config.059'), tier: 'medium', search: true, prefer: ['gemini', 'gpt', 'grok'],
      // read-only is DSH's own sandbox preset: once it is in effect the session may run read-only commands.
      access: { editPaths: [], shell: false, preset: 'read-only' } },
    writer: { job: roleText('config.060'), whenToUse: roleText('config.061'), tier: 'low', search: false, prefer: ['gpt', 'claude', 'gemini', 'deepseek', 'qwen'],
      access: { editPaths: ['**/*.md', '**/*.mdx', '**/*.txt', 'docs/**'], shell: false } },
    qa: { job: roleText('config.062'), whenToUse: roleText('config.063'), tier: 'upper', search: false, prefer: ['gpt', 'claude', 'gemini'] },
  },
  roles: structuredClone(DEFAULT_ROLES), // roster-defaults.js; the hero roster is the optional three-kingdoms theme
});
function text(value, max, label, multiline = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || (multiline ? TEXT_CONTROL : LINE_CONTROL).test(value)) {
    throw new Error(modelText('config.064', { 0: label, 1: max }));
  }
  return value.trim();
}
function entries(map, label) {
  if (!isMap(map)) throw new Error(modelText('config.065', { 0: label }));
  for (const id of Object.keys(map)) if (!ID.test(id)) throw new Error(modelText('config.066', { 0: label, 1: id }));
  return Object.entries(map);
}
function onlyKeys(value, allowed, label) {
  if (!isMap(value)) throw new Error(modelText('config.067', { 0: label }));
  const extra = Object.keys(value).filter(k => !allowed.includes(k));
  if (extra.length) throw new Error(modelText('config.068', { 0: label, 1: extra.join(', ') }));
}
/** Validate one complete effective configuration and return a normalized copy. */
export function validateConfig(config, { trustedRoutes } = {}) {
  const name = text(config.name ?? seed.name, 80, modelText('config.069'));
  const tierDrift = [];
  const tiers = {};
  for (const [id, models] of entries(config.tiers, modelText('config.070'))) {
    if (!Array.isArray(models) || models.length > 200) throw new Error(modelText('config.071', { 0: id }));
    const list = models.map(m => text(m, 200, modelText('config.072', { 0: id })));
    if (new Set(list).size !== list.length) throw new Error(modelText('config.073', { 0: id }));
    tiers[id] = list;
  }
  const capabilities = {};
  for (const [id, c] of entries(config.capabilities, modelText('config.074'))) {
    onlyKeys(c, CAPABILITY_KEYS, modelText('config.075', { 0: id }));
    if (!Object.hasOwn(tiers, c.tier)) throw new Error(modelText('config.076', { 0: id, 1: c.tier }));
    if (c.search !== undefined && typeof c.search !== 'boolean') throw new Error(modelText('config.077', { 0: id }));
    if (c.planFirst !== undefined && c.planFirst !== null && typeof c.planFirst !== 'boolean') throw new Error(modelText('config.078', { 0: id }));
    if (c.prefer !== undefined && (!Array.isArray(c.prefer) || c.prefer.length > 20)) throw new Error(modelText('config.079', { 0: id }));
    const common = { job: text(c.job, 2000, modelText('config.080', { 0: id }), true),
      ...(c.whenToUse === undefined || c.whenToUse === null ? {} : { whenToUse: text(c.whenToUse, 500, modelText('config.081', { 0: id })) }), tier: c.tier, search: c.search === true, prefer: (c.prefer ?? []).map(v => text(v, 40, modelText('config.082', { 0: id }))),
      ...(c.access === undefined || c.access === null ? {} : { access: validateAccess(c.access, modelText('config.083', { 0: id })) }),
      ...(c.planFirst === true ? { planFirst: true } : {}),
      // How much of DSH's skill catalog a teammate with this capability sees (teammate-context.js); compact by default.
      ...(c.skills === undefined || c.skills === null ? {} : { skills: validateSkillsPolicy(c.skills, modelText('config.084', { 0: id })) }),
      // Per-session budget of billable tokens (uncached input + cache write + output) for each member with this capability.
      ...(c.maxTokens === undefined || c.maxTokens === null ? {} : { maxTokens: count(c.maxTokens, 1000, 1e10, modelText('config.085', { 0: id })) }) };
    if (c.provider === undefined && c.model === undefined) {
      if (c.fallbacks?.length) throw new Error(modelText('config.086', { 0: id }));
      if (c.longContext) throw new Error(modelText('config.087', { 0: id }));
      capabilities[id] = { ...common, fallbacks: [] };
      continue;
    }
    const model = text(c.model, 200, modelText('config.088', { 0: id }));
    const trust = { trusted: trustedRoutes?.get(id), capability: id, drift: tierDrift };
    adoptIntoTier(tiers, c.tier, model, modelText('config.089', { 0: id }), trust);
    const provider = text(c.provider, 200, modelText('config.090', { 0: id }));
    capabilities[id] = { ...common, provider, model,
      fallbacks: validateFallbacks(c.fallbacks ?? [], { provider, model }, tiers, c.tier, modelText('config.091', { 0: id }), trust),
      ...(c.longContext === undefined || c.longContext === null ? {} : { longContext: validateLongContext(c.longContext, { provider, model }, tiers, c.tier, modelText('config.092', { 0: id }), trust) }) };
  }
  if (!capabilities.orchestrator) throw new Error(modelText('config.093'));
  const roles = {}; const names = new Set();
  for (const [id, r] of entries(config.roles, modelText('config.094'))) {
    onlyKeys(r, ROLE_KEYS, modelText('config.095', { 0: id }));
    if (!Object.hasOwn(capabilities, r.capability)) throw new Error(modelText('config.096', { 0: id, 1: r.capability }));
    if ((id === 'lead') !== (r.capability === 'orchestrator')) throw new Error(modelText('config.097'));
    const displayName = text(r.displayName, 40, modelText('config.098', { 0: id }));
    if (names.has(displayName)) throw new Error(modelText('config.099', { 0: displayName }));
    names.add(displayName);
    roles[id] = { displayName, capability: r.capability, ...(r.description === undefined ? {} : { description: text(r.description, 2000, modelText('config.100', { 0: id }), true) }) };
  }
  if (!roles.lead) throw new Error(modelText('config.101'));
  return { name, failover: validateFailover(config.failover ?? seed.failover), workflow: validateWorkflow(config.workflow ?? seed.workflow), tiers, capabilities, roles, ...(tierDrift.length ? { tierDrift } : {}), ...patchSingleModel(undefined, config.singleModel ?? null) };
}
/**
 * An explicitly chosen model may not sit in another tier (no cross-tier routes), but a model the automatic
 * classifier left ungraded is accepted and recorded in the chosen tier: the user's choice is its grading.
 * Besides that, only models no team member can use (unroutableReason), disabled routes and the live catalog
 * check limit what can be chosen; a project can still enable such a model by listing it in `tiers` itself.
 * A route already stored for this capability (trust.trusted) was valid when saved, while grading is recomputed
 * from a catalog that keeps changing: it stays usable and is reported in `tierDrift`, never a load failure.
 */
function adoptIntoTier(tiers, tier, model, label, trust) {
  if (tiers[tier].includes(model)) return;
  const trusted = trust?.trusted?.has(model);
  const elsewhere = Object.keys(tiers).find(t => t !== tier && tiers[t].includes(model));
  if (elsewhere) {
    if (!trusted) throw new Error(modelText('config.102', { 0: label, 1: model, 2: elsewhere, 3: tier }));
    trust.drift.push({ capability: trust.capability, model, tier, gradedAs: elsewhere });
    return;
  }
  const refused = trusted ? undefined : unroutableReason(model);
  if (refused) throw new Error(modelText('config.103', { 0: label, 1: model, 2: refused, 3: tier }));
  tiers[tier].push(model);
}
/** Same-tier route taken once a session's next prompt reaches thresholdTokens; never another tier. */
function validateLongContext(lc, primary, tiers, tier, label, trust) {
  onlyKeys(lc, ['thresholdTokens', 'provider', 'model'], label);
  const route = { provider: text(lc.provider, 200, modelText('config.104', { 0: label })), model: text(lc.model, 200, modelText('config.105', { 0: label })) };
  adoptIntoTier(tiers, tier, route.model, label, trust);
  if (route.provider === primary.provider && route.model === primary.model) throw new Error(modelText('config.106', { 0: label }));
  return { thresholdTokens: count(lc.thresholdTokens, 8000, 10000000, modelText('config.107', { 0: label })), ...route };
}
/** Access policy: denied tool names (or prefix*), shell on/off, and project-relative globs that may be edited (absent = any). */
function validateAccess(a, label) {
  onlyKeys(a, ACCESS_KEYS, label);
  if (a.shell !== undefined && typeof a.shell !== 'boolean') throw new Error(modelText('config.108', { 0: label }));
  const deny = toolNames(a.deny ?? [], modelText('config.109', { 0: label }));
  for (const name of deny) if (!/^[A-Za-z0-9_.:-]+\*?$/.test(name)) throw new Error(modelText('config.110', { 0: label, 1: name }));
  let editPaths = null;
  if (a.editPaths !== undefined && a.editPaths !== null) {
    if (!Array.isArray(a.editPaths) || a.editPaths.length > 50) throw new Error(modelText('config.111', { 0: label }));
    editPaths = [...new Set(a.editPaths.map(v => text(v, 200, modelText('config.112', { 0: label })).split('\\').join('/').replace(/^\.\//, '')))];
    for (const v of editPaths) {
      if (v.startsWith('/') || /^[A-Za-z]:/.test(v) || v.startsWith('~') || v.split('/').includes('..')) throw new Error(modelText('config.113', { 0: label, 1: v }));
    }
  }
  let preset;
  if (a.preset !== undefined && a.preset !== null) {
    preset = text(a.preset, 64, modelText('config.114', { 0: label }));
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(preset) || ['custom', 'auto'].includes(preset)) throw new Error(modelText('config.115', { 0: label }));
  }
  return { deny, editPaths, shell: a.shell !== false, ...(preset ? { preset } : {}) };
}
function toolNames(list, label) {
  if (!Array.isArray(list) || list.length > 100) throw new Error(modelText('config.116', { 0: label }));
  return [...new Set(list.map(n => text(n, 80, label)))];
}
function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(modelText('config.117', { 0: label, 1: allowed.join(' / ') }));
  return value;
}
function validateWorkflow(w) {
  onlyKeys(w, WORKFLOW_KEYS, modelText('config.118'));
  const merged = { ...seed.workflow, ...w };
  if (!WORKFLOW_MODES.includes(merged.mode)) throw new Error(modelText('config.119', { 0: WORKFLOW_MODES.join(' / ') }));
  const out = {
    mode: merged.mode,
    analysisBudget: count(merged.analysisBudget, 0, 50, modelText('config.120')),
    directBudget: count(merged.directBudget, 0, 50, modelText('config.121')),
    freeTools: oneOf(merged.freeTools, FREE_TOOL_LEVELS, modelText('config.122')),
    freeModels: toolNames(merged.freeModels, modelText('config.123')),
    analysisTools: toolNames(merged.analysisTools, modelText('config.124')),
    coordinationTools: toolNames(merged.coordinationTools, modelText('config.125')),
    fileLimits: validateFileLimits(merged.fileLimits),
    confirmDispatch: oneOf(merged.confirmDispatch, CONFIRM_MODES, modelText('config.126')),
    rotation: validateRotation(merged.rotation),
    tokens: validateTokenRules(merged.tokens),
    enforceWriteScopes: (() => { if (typeof merged.enforceWriteScopes !== 'boolean') throw new Error(modelText('config.127')); return merged.enforceWriteScopes; })(),
  };
  const both = out.analysisTools.filter(n => out.coordinationTools.includes(n));
  if (both.length) throw new Error(modelText('config.128', { 0: both.join(', ') }));
  return out;
}
/** Ordered same-tier backups: never another tier, never the primary twice. */
function validateFallbacks(list, primary, tiers, tier, label, trust) {
  if (!Array.isArray(list) || list.length > MAX_FALLBACKS) throw new Error(modelText('config.129', { 0: label, 1: MAX_FALLBACKS }));
  const seen = new Set([`${primary.provider}\u0000${primary.model}`]);
  return list.map((f, i) => {
    onlyKeys(f, ['provider', 'model'], modelText('config.130', { 0: label, 1: i + 1 }));
    const route = { provider: text(f.provider, 200, modelText('config.131', { 0: label })), model: text(f.model, 200, modelText('config.132', { 0: label })) };
    adoptIntoTier(tiers, tier, route.model, modelText('config.133', { 0: label }), trust);
    const key = `${route.provider}\u0000${route.model}`;
    if (seen.has(key)) throw new Error(modelText('config.134', { 0: label, 1: route.provider, 2: route.model }));
    seen.add(key);
    return route;
  });
}
function count(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(modelText('config.135', { 0: label, 1: min, 2: max }));
  return value;
}
function codes(list, label) {
  if (!Array.isArray(list) || list.length > 50) throw new Error(modelText('config.136', { 0: label }));
  return list.map(c => text(c, 64, label));
}
function validateFailover(f) {
  onlyKeys(f, FAILOVER_KEYS, modelText('config.137'));
  const merged = { ...seed.failover, ...f };
  const out = {
    retries: count(merged.retries, 0, 10, modelText('config.138')),
    initialDelayMs: count(merged.initialDelayMs, 100, 60000, modelText('config.139')),
    maxDelayMs: count(merged.maxDelayMs, 100, 120000, modelText('config.140')),
    cooldownMs: count(merged.cooldownMs, 5000, 600000, modelText('config.141')),
    retryCodes: codes(merged.retryCodes, modelText('config.142')),
    failoverCodes: codes(merged.failoverCodes, modelText('config.143')),
    failoverStatuses: merged.failoverStatuses.map(s => count(s, 400, 599, modelText('config.144'))),
  };
  if (out.initialDelayMs > out.maxDelayMs) throw new Error(modelText('config.145'));
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
/** Capability id → models its stored override routes to. Only these may outlive a change in catalog grading. */
function storedRoutes(overrides) {
  return new Map(Object.entries(overrides?.capabilities ?? {}).filter(([, c]) => isMap(c)).map(([id, c]) => [id, new Set([
    c.model, ...(Array.isArray(c.fallbacks) ? c.fallbacks.map(f => f?.model) : []), c.longContext?.model,
  ].filter(m => typeof m === 'string'))]));
}
/**
 * A stored primary without its own fallbacks inherits the automatic ones, which are recomputed from the catalog.
 * Drop those the override makes invalid (the primary itself, or a model of another tier) instead of failing.
 */
function withoutStaleInherited(capabilities, overrides, tiers) {
  const out = { ...capabilities };
  for (const [id, over] of Object.entries(overrides ?? {})) {
    const c = out[id];
    if (!isMap(over) || !isMap(c) || over.fallbacks !== undefined || typeof over.model !== 'string' || !Array.isArray(c.fallbacks)) continue;
    const inTier = Array.isArray(tiers[c.tier]) ? tiers[c.tier] : [];
    out[id] = { ...c, fallbacks: c.fallbacks.filter(f => !(f?.model === c.model && f?.provider === c.provider) && inTier.includes(f?.model)) };
  }
  return out;
}
/**
 * Merge project overrides onto the base configuration and validate the result.
 * `trustedFrom` names the overrides whose stored routes are tolerated when the catalog has regraded them: loading
 * passes the file itself and saving passes the previous file, so a new or changed route is still checked strictly.
 */
export function effectiveConfig(overrides = {}, base = seed, { trustedFrom } = {}) {
  const tiers = layer(base.tiers, overrides.tiers);
  return validateConfig({
    name: overrides.name ?? base.name, singleModel: overrides.singleModel,
    failover: { ...base.failover, ...(overrides.failover ?? {}) },
    workflow: { ...(base.workflow ?? seed.workflow), ...(overrides.workflow ?? {}) },
    tiers,
    capabilities: withoutStaleInherited(layer(base.capabilities, overrides.capabilities), overrides.capabilities, tiers),
    roles: layer(rosterBase(base.roles, overrides), overrides.roles), // pre-4.0 saves keep the hero roster
  }, trustedFrom ? { trustedRoutes: storedRoutes(trustedFrom) } : {});
}
/** Base configuration from preset config: bindings may rename or add seed roles. */
export function baseConfig(config = {}) {
  if (config.bindings === undefined) return seed;
  if (!isMap(config.bindings)) throw new Error(modelText('config.146'));
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
  if (!isMap(raw)) throw new Error(modelText('config.147'));
  const { revision = 0, name, failover, workflow, roster, singleModel, names = {}, descriptions = {}, routes = {}, tiers = {}, capabilities = {}, roles = {} } = raw;
  const legacyRoles = {};
  for (const id of new Set([...Object.keys(names), ...Object.keys(descriptions)])) {
    legacyRoles[id] = { ...(names[id] === undefined ? {} : { displayName: names[id] }), ...(descriptions[id] === undefined ? {} : { description: descriptions[id] }) };
  }
  return { revision, ...(roster === undefined ? {} : { roster }), ...(singleModel == null ? {} : { singleModel }), ...(name === undefined ? {} : { name }), ...(failover === undefined ? {} : { failover }), ...(workflow === undefined ? {} : { workflow }), tiers: { ...tiers }, capabilities: { ...routes, ...capabilities }, roles: { ...legacyRoles, ...roles } };
}
/**
 * Apply one conversational patch to stored overrides.
 * Per entry: an object merges fields, null reverts to the default, false removes the entry.
 */
export function applyPatch(overrides, patch) {
  const next = { revision: overrides.revision ?? 0, name: overrides.name, ...(overrides.roster === undefined ? {} : { roster: overrides.roster }), ...patchSingleModel(overrides.singleModel, patch.singleModel) };
  if (patch.name !== undefined) next.name = text(patch.name, 80, modelText('config.148'));
  if (next.name === undefined) delete next.name;
  // failover is one object: fields merge, null restores the preset policy.
  const failover = patch.failover === null ? undefined : patch.failover === undefined ? overrides.failover : { ...(overrides.failover ?? {}), ...patch.failover };
  if (patch.failover !== undefined && patch.failover !== null) onlyKeys(patch.failover, FAILOVER_KEYS, modelText('config.149'));
  if (failover !== undefined) next.failover = failover;
  // workflow follows the same rule: fields merge, null restores the preset policy.
  const workflow = patch.workflow === null ? undefined : patch.workflow === undefined ? overrides.workflow : { ...(overrides.workflow ?? {}), ...patch.workflow };
  if (patch.workflow !== undefined && patch.workflow !== null) onlyKeys(patch.workflow, WORKFLOW_KEYS, modelText('config.150'));
  if (workflow !== undefined) next.workflow = workflow;
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
/** Optional capability policies a role carries: present only when its capability sets them. */
const rolePolicies = c => ({ ...(c.access ? { access: c.access } : {}), ...(c.maxTokens ? { maxTokens: c.maxTokens } : {}),
  ...(c.longContext ? { longContext: c.longContext } : {}), ...(c.planFirst ? { planFirst: true } : {}) });
/** One model-facing row per role, with the route its capability resolves to. */
export function roleView(effective) {
  return Object.entries(effective.roles).map(([id, r]) => {
    const c = effective.capabilities[r.capability]; const route = effectiveRoute(c, effective.singleModel);
    return { id, displayName: r.displayName, capability: r.capability, description: r.description ?? c.job, ...(c.whenToUse ? { whenToUse: c.whenToUse } : {}), provider: route.provider, model: route.model, tier: c.tier, search: c.search, fallbacks: route.fallbacks, ...rolePolicies(c), ...(route.singleModel ? { singleModel: true } : {}) };
  });
}
const SECTION_LABEL = { tiers: t('config.151'), capabilities: t('config.152'), roles: t('config.153') };
/** Human-readable list of every field that differs between two effective configurations. */
export function describeChanges(before, after) {
  const lines = [...(before.name === after.name ? [] : [t('config.154', { 0: before.name, 1: after.name })]), ...singleModelChanges(before.singleModel, after.singleModel)];
  const fa = JSON.stringify(before.failover); const fb = JSON.stringify(after.failover);
  if (fa !== fb) lines.push(t('config.155', { 0: fa, 1: fb }));
  const wa = JSON.stringify(before.workflow); const wb = JSON.stringify(after.workflow);
  if (wa !== wb) lines.push(t('config.156', { 0: wa, 1: wb }));
  for (const section of SECTIONS) {
    for (const id of new Set([...Object.keys(before[section]), ...Object.keys(after[section])])) {
      const a = JSON.stringify(before[section][id]); const b = JSON.stringify(after[section][id]);
      if (a !== b) lines.push(`${SECTION_LABEL[section]} ${id}：${a ?? t('config.157')} → ${b ?? t('config.158')}`);
    }
  }
  return lines;
}
/** Resolve the native Team identity to one configured role; unknown members fail with guidance. */
export function resolveRole(membership, effective) {
  const name = !membership || membership.role === 'lead' ? 'lead' : membership.name;
  // A rotation successor `<role>-r<N>` keeps its role's model, access and budget.
  const base = name.replace(/-r\d+$/, '');
  const own = Object.hasOwn(effective.roles, name) || !Object.hasOwn(effective.roles, base) ? name : base;
  const id = legacyRoleId(own, effective.roles) ?? legacyRoleId(base, effective.roles) ?? own; // `lv-bu(-rN)` routes as backend
  const role = Object.hasOwn(effective.roles, id) ? effective.roles[id] : undefined;
  if (!role) throw new Error(modelText('config.159', { 0: id }));
  const c = effective.capabilities[role.capability]; const r = effectiveRoute(c, effective.singleModel);
  return { id, displayName: role.displayName, capability: role.capability, description: role.description ?? c.job, provider: r.provider, model: r.model, tier: c.tier, search: c.search, fallbacks: r.fallbacks, failover: effective.failover, ...rolePolicies(c), ...(r.unassigned ? { unassigned: true } : {}), ...(r.singleModel ? { singleModel: true } : {}) };
}
