// Dispatch confirmation: before a delegate plan takes effect, the user sees every assigned role with its
// primary model and up to three fallbacks, and may change them for this task or save them as the project
// default. The Web card answers over api/capability-team.dispatch-confirm; hosts without the card fall back
// to DSH's native question box. Confirmed per-task routes live in memory per Lead and are applied by
// team.resolve before the global model policy, so disabled models stay disabled.
import { crossSiteRequest } from './http-guard.js';
import { createHash } from 'node:crypto';
import { modelCatalog, verifyRoutes } from './allocation.js';
import { routeKey, routeMatcher } from './model-policy.js';
import { saveProject } from './theme.js';
import { applyPreferences, unhealthyRoutes } from './model-prefs.js';
export const DISPATCH_CONFIRM_PATH = '/api/capability-team.dispatch-confirm';
export { CONFIRM_MODES } from './config.js';
export const MAX_ROUTE_FALLBACKS = 3;
const CARD_GRACE_MS = 8000; // no card asked for the request in this time → the host has no card; use the question box
const HEARTBEAT_MS = 15000; // a card that stopped polling this long ago is gone (tab closed, page left); use the question box
const CONFIRM_TIMEOUT_MS = 10 * 60 * 1000; // nobody answers at all → fail instead of hanging the Lead's turn forever
const leads = new Map(); // lead id → { pending: Map(callId → request), routes: Map(role → route), confirmed: Map(role → key) }
let routeStore; // optional persistence for per-task routes (dispatch-routes-store.js), set by the plugin
/** Persist confirmed per-task routes so they survive a DSH restart; `undefined` keeps them in memory only. */
export function setRouteStore(store) { routeStore = store; }
const stateOf = id => {
  if (!leads.has(id)) {
    const saved = routeStore?.load(id);
    leads.set(id, { pending: new Map(), routes: new Map(saved?.routes ?? []), confirmed: new Map(saved?.confirmed ?? []) });
  }
  return leads.get(id);
};
const sameRoute = (a, b) => a?.provider === b?.provider && a?.model === b?.model;
const keyOf = r => JSON.stringify([r.primary ? routeKey(r.primary) : null, r.fallbacks.map(routeKey)]);
export const parseRoute = text => {
  const s = String(text ?? '').trim(); const i = s.indexOf('/');
  return i > 0 && i < s.length - 1 && !/\s/.test(s) ? { provider: s.slice(0, i), model: s.slice(i + 1) } : undefined;
};
/** Per-task route the user confirmed for a member of this Lead, if any. */
export function confirmedRoute(leadId, role) { return (leads.has(leadId) || routeStore ? stateOf(leadId) : undefined)?.routes.get(role); }
/** Apply a confirmed per-task route to a resolved role (before the model policy). */
export function withConfirmedRoute(role, route) {
  if (!route?.primary) return role;
  return { ...role, provider: route.primary.provider, model: route.primary.model, fallbacks: route.fallbacks, confirmedByUser: true };
}
export function forgetLead(leadId) { leads.delete(leadId); }
/** The roles of a delegate plan with their effective routes and same-tier candidates. */
export function planRoutes(plan, effective, disabledRoutes, catalog) {
  const disabled = routeMatcher(disabledRoutes);
  return plan.assignments.map(a => {
    const c = effective.capabilities[a.capability];
    const tierModels = effective.tiers[c.tier] ?? [];
    const candidates = catalog.entries.filter(e => !disabled(routeKey(e)))
      .map(e => ({ provider: e.provider, model: e.model, sameTier: tierModels.includes(e.model) }))
      .sort((a, b) => Number(b.sameTier) - Number(a.sameTier));
    const allowed = [...(c.provider ? [{ provider: c.provider, model: c.model }] : []), ...(c.fallbacks ?? [])].filter(r => !disabled(routeKey(r)));
    return { role: a.role, displayName: a.displayName, capability: a.capability, tier: c.tier, task: a.task,
      primary: allowed[0] ?? null, fallbacks: allowed.slice(1, 1 + MAX_ROUTE_FALLBACKS), candidates };
  });
}
/** Validate the user's answer against the offered candidates; returns normalized routes or throws. */
export function validateAnswer(offered, answer) {
  if (!answer || typeof answer !== 'object') throw new Error('无效的确认结果');
  if (answer.decision === 'cancel') return { decision: 'cancel' };
  if (answer.decision !== 'confirm') throw new Error('decision 须为 confirm 或 cancel');
  const scope = answer.scope ?? 'task';
  if (!['task', 'project'].includes(scope)) throw new Error('scope 须为 task 或 project');
  const given = new Map((Array.isArray(answer.routes) ? answer.routes : []).map(r => [r?.role, r]));
  const routes = offered.map(o => {
    const r = given.get(o.role);
    const chosen = r ?? { primary: o.primary, fallbacks: o.fallbacks };
    const allowed = route => o.candidates.some(c => sameRoute(c, route));
    const primary = typeof chosen.primary === 'string' ? parseRoute(chosen.primary) : chosen.primary;
    if (!primary?.provider || !primary?.model || !allowed(primary)) throw new Error(`${o.displayName ?? o.role} 的主模型 ${primary ? routeKey(primary) : String(chosen.primary)} 不在目录可用模型中`);
    const list = (Array.isArray(chosen.fallbacks) ? chosen.fallbacks : []).map(f => (typeof f === 'string' ? parseRoute(f) : f));
    if (list.length > MAX_ROUTE_FALLBACKS) throw new Error(`${o.displayName ?? o.role} 的回退模型最多 ${MAX_ROUTE_FALLBACKS} 个`);
    const seen = new Set([routeKey(primary)]);
    for (const f of list) {
      if (!f?.provider || !f?.model || !allowed(f)) throw new Error(`${o.displayName ?? o.role} 的回退模型 ${f ? routeKey(f) : '?'} 不在目录可用模型中`);
      if (seen.has(routeKey(f))) throw new Error(`${o.displayName ?? o.role} 的回退模型 ${routeKey(f)} 与主模型或其他回退重复`);
      seen.add(routeKey(f));
    }
    if (scope === 'project' && [primary, ...list].some(route => o.candidates.find(c => sameRoute(c, route))?.sameTier === false))
      throw new Error('跨档选择仅本次生效，不能保存为项目默认；请选择仅本次任务');
    // Compared with the configured route, so a preselected habit still counts as a change when saved as default.
    const ref = o.base ?? o;
    const changed = !sameRoute(primary, ref.primary) || keyOf({ primary, fallbacks: list }) !== keyOf(ref);
    return { role: o.role, capability: o.capability, primary, fallbacks: list, changed };
  });
  if (scope === 'project') {
    const byCap = new Map();
    for (const r of routes.filter(x => x.changed)) {
      const prior = byCap.get(r.capability);
      if (prior && keyOf(prior) !== keyOf(r)) throw new Error(`能力 ${r.capability} 被多个角色设成不同模型，无法保存为项目默认；请改为仅本次任务`);
      byCap.set(r.capability, r);
    }
  }
  return { decision: 'confirm', scope, routes };
}
/** Public view of a pending request for the card; without a callId, the Lead's latest one (for the composer dock). */
export function pendingView(leadId, callId) {
  const pending = leads.get(leadId)?.pending;
  if (!callId && pending?.size) callId = [...pending.keys()].at(-1);
  const request = pending?.get(callId);
  if (!request) return { schemaVersion: 1, status: 'none' };
  request.lastSeenAt = Date.now(); // heartbeat: the card keeps polling while it is on screen
  // The native question box is already open for this request: the card only points there, so one question has one place to answer.
  const native = request.nativeAsked === true && request.nativeFailed !== true;
  if (request.kind === 'direct') return { schemaVersion: 1, status: 'pending', kind: 'direct', callId, native, analysis: request.plan.analysis, reason: request.plan.reason };
  return { schemaVersion: 1, status: 'pending', callId, native, catalogVersion: request.catalogVersion, maxFallbacks: MAX_ROUTE_FALLBACKS, routes: request.offered };
}
/** Resolve a pending request with the card's answer; throws (with status) when it cannot. */
export function answerPending(leadId, callId, answer) {
  const request = leads.get(leadId)?.pending.get(callId);
  if (!request) throw Object.assign(new Error('没有等待确认的分派'), { status: 404, code: 'NOT_FOUND' });
  if (answer?.catalogVersion !== undefined && answer.catalogVersion !== request.catalogVersion) throw Object.assign(new Error('可用模型已变化，请刷新后重新确认'), { status: 409, code: 'CONFLICT' });
  let result;
  try { result = request.validate(answer); } catch (error) { throw Object.assign(error, { status: 422, code: 'INVALID' }); }
  request.resolve(result);
  return { schemaVersion: 1, status: 'resolved', decision: result.decision };
}
const fallbackText = r => r.fallbacks.length ? r.fallbacks.map(routeKey).join('、') : '无';
const routeLine = r => `${r.displayName ?? r.role}（${r.capability}）：主 ${r.primary ? routeKey(r.primary) : '未分配'}；回退 ${fallbackText(r)}`;
/** Native question box: confirm as offered, or type changes as "角色: 主模型, 回退1, 回退2". */
async function askNative(userQuestions, exec, offered, signal) {
  const answer = await userQuestions.ask({ agent: exec.agent, signal, questions: [{
    id: 'dispatch', header: '确认分派',
    question: '按以下角色和模型分派？要调整就选“仅本次调整”或“保存为项目默认”，并在输入框逐行填写“角色id: 主模型, 回退1, 回退2”（回退最多 3 个）。',
    detail: offered.map(routeLine).join('\n'),
    options: [{ label: '确认分派' }, { label: '仅本次调整' }, { label: '保存为项目默认' }, { label: '取消' }],
  }] });
  const item = answer.answers.find(a => a.id === 'dispatch');
  const choice = item?.selected?.[0];
  if (!choice || choice === '取消') return { decision: 'cancel', note: item?.custom };
  if (choice === '确认分派') return { decision: 'confirm', scope: 'task', routes: [] };
  const routes = String(item.custom ?? '').split(/\n|；|;/).map(line => line.trim()).filter(Boolean).map(line => {
    const [role, rest = ''] = line.split(/[:：]/);
    const [primary, ...fallbacks] = rest.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
    return { role: role.trim(), primary, fallbacks };
  });
  return { decision: 'confirm', scope: choice === '保存为项目默认' ? 'project' : 'task', routes };
}
/** The Lead's request to work without its step limit has one question: allow or refuse. */
export function validateDirectAnswer(answer) {
  if (answer?.decision !== 'confirm' && answer?.decision !== 'cancel') throw new Error('decision 须为 confirm 或 cancel');
  return { decision: answer.decision };
}
async function askDirectNative(userQuestions, exec, plan, signal) {
  const answer = await userQuestions.ask({ agent: exec.agent, signal, questions: [{
    id: 'direct', header: '主控亲自完成',
    question: '允许主控亲自完成这项工作吗？允许后本轮不限执行步数，你发下一条消息时恢复限制；文件规则和权限不变。',
    detail: `需求分析：${plan.analysis}\n理由：${plan.reason}`,
    options: [{ label: '允许' }, { label: '不允许' }],
  }] });
  return { decision: answer.answers.find(a => a.id === 'direct')?.selected?.[0] === '允许' ? 'confirm' : 'cancel' };
}
const minutesOf = ms => Number((ms / 60000).toFixed(1));
/**
 * Register a pending request and wait for its answer from the card or the native question box. Every exit
 * (answer, cancel, timeout, abort) clears the abort listener, both timers and the pending entry, and aborts an
 * open native question box so no stale dialog is left behind.
 */
function waitForAnswer(ctx, state, exec, callId, spec, { graceMs, heartbeatMs, timeoutMs }) {
  const startedAt = Date.now();
  const native = new AbortController(); // ends the native question box when the request ends any other way
  let settled = false, deadline, check, onAbort, nativeError;
  const request = { ...spec, lastSeenAt: undefined, nativeAsked: false };
  const cleanup = () => {
    clearTimeout(deadline); clearInterval(check);
    if (onAbort) exec.signal?.removeEventListener?.('abort', onAbort);
    if (state.pending.get(callId) === request) state.pending.delete(callId);
    native.abort();
  };
  return new Promise((resolve, reject) => {
    const finish = (fn, value) => { if (settled) return; settled = true; cleanup(); fn(value); };
    request.resolve = value => finish(resolve, value);
    const fail = error => finish(reject, error);
    if (exec.signal?.aborted) { fail(new Error(`${spec.subject}已中止`)); return; }
    state.pending.set(callId, request);
    onAbort = () => fail(new Error(`${spec.subject}已中止`));
    exec.signal?.addEventListener?.('abort', onAbort, { once: true });
    deadline = setTimeout(() => fail(new Error(`${spec.subject}超时（${minutesOf(timeoutMs)} 分钟无人确认），${spec.consequence}。`
      + `${nativeError ? `原生问答框也不可用（${nativeError.code ?? nativeError.message}）。` : ''}${spec.retry}`)), timeoutMs);
    deadline.unref?.();
    // Only a card that never showed up within graceMs means the host has no card: then ask once in the native
    // question box. A card that was seen keeps the request even when its heartbeat stalls (background tabs throttle
    // timers), so the user never gets the same question twice; the overall timeout still ends an abandoned wait.
    // heartbeatMs stays accepted for callers but no longer triggers the fallback.
    void heartbeatMs;
    const cardGone = () => request.lastSeenAt === undefined && Date.now() - startedAt >= graceMs;
    check = setInterval(() => {
      if (settled || request.nativeAsked || !ctx.userQuestions?.ask || !cardGone()) return;
      request.nativeAsked = true; // asked at most once: a second dialog for the same plan would only confuse
      clearInterval(check);
      spec.ask(native.signal).then(answer => {
        if (settled) return;
        try { request.resolve(spec.validate(answer)); } catch (error) { fail(error); }
      }, error => {
        // The question box failed (e.g. NO_PROVIDER when no client is attached, or it was dismissed by the host).
        // That is not the user's answer: the card can still answer while the request is pending (the user may
        // reopen the conversation), so keep waiting; the overall timeout still ends the wait with a clear error.
        if (!settled) { nativeError = error; request.nativeFailed = true; }
      });
    }, Math.max(5, Math.min(1000, graceMs, heartbeatMs)));
    check.unref?.();
  });
}
export function createDispatchConfirm(ctx, team, { graceMs = CARD_GRACE_MS, heartbeatMs = HEARTBEAT_MS, timeoutMs = CONFIRM_TIMEOUT_MS, prefs, health = () => ({}) } = {}) {
  async function saveDefaults(exec, routes) {
    const changed = routes.filter(r => r.changed);
    if (!changed.length) return null;
    const project = await team.pin(exec.agent);
    const { revision } = await team.load(exec.agent);
    const capabilities = Object.fromEntries(changed.map(r => [r.capability, { provider: r.primary.provider, model: r.primary.model, fallbacks: r.fallbacks }]));
    const result = await saveProject(project, { capabilities }, revision, { base: team.base, root: team.root,
      async check(_before, after) { verifyRoutes(changed.flatMap(r => [r.primary, ...r.fallbacks].map(x => ({ ...x, capability: r.capability }))), await modelCatalog(ctx.llm, after.tiers)); } });
    return result.revision;
  }
  return {
    /** Ask the user whether the Lead may finish this turn without its step limit; throws unless they allow it. */
    async confirmDirect(exec, plan) {
      const callId = exec.callId ?? `direct-${Date.now()}`;
      const result = await waitForAnswer(ctx, stateOf(exec.agent.id), exec, callId, { kind: 'direct', plan, subject: '主控亲自完成确认', consequence: '执行限制没有放开', retry: '请询问用户是否重新确认。',
        validate: validateDirectAnswer, ask: signal => askDirectNative(ctx.userQuestions, exec, plan, signal) }, { graceMs, heartbeatMs, timeoutMs });
      if (result.decision === 'cancel') throw new Error('用户没有放开主控的执行限制，本次计划未生效。请询问用户要如何调整，或重新制定计划。');
      return true;
    },
    /**
     * Ask the user to confirm a delegate plan. Resolves with the confirmed routes (applied to this Lead),
     * or throws when the user cancels. `mode` is workflow.confirmDispatch.
     */
    async confirm(exec, plan, effective, policy, mode = 'on-change') {
      const leadId = exec.agent.id;
      const state = stateOf(leadId);
      const catalog = await modelCatalog(ctx.llm, effective.tiers);
      // Learned habits and recent failures shape what the card preselects; a route the user already confirmed in
      // this session wins over both. `base` keeps the configured route, which "save as default" compares against.
      const project = prefs ? await team.pin(exec.agent) : undefined;
      const habits = project ? await prefs.habits(project).catch(() => ({})) : {};
      const unhealthy = unhealthyRoutes(health());
      const offered = planRoutes(plan, effective, policy.disabledRoutes, catalog).map(r => {
        const base = { primary: r.primary, fallbacks: r.fallbacks };
        const prior = state.routes.get(r.role);
        const shaped = prior ? { ...r, primary: prior.primary, fallbacks: prior.fallbacks, learned: { unhealthy: {} } } : applyPreferences(r, habits[r.capability], unhealthy);
        return { ...shaped, base };
      });
      const unchanged = offered.every(r => state.confirmed.get(r.role) === keyOf(r));
      if (mode === 'never' || (mode === 'on-change' && unchanged)) return { asked: false, routes: offered };
      const catalogVersion = createHash('sha256').update(JSON.stringify(offered.map(r => r.candidates))).digest('hex').slice(0, 16);
      const callId = exec.callId ?? `dispatch-${Date.now()}`;
      const result = await waitForAnswer(ctx, state, exec, callId, { offered, catalogVersion, subject: '分派确认', consequence: '未创建或通知任何队友', retry: '请询问用户是否重新分派。',
        validate: answer => validateAnswer(offered, answer), ask: signal => askNative(ctx.userQuestions, exec, offered, signal) }, { graceMs, heartbeatMs, timeoutMs });
      if (result.decision === 'cancel') throw new Error('用户取消了这次分派，未创建或通知任何队友。请询问用户要如何调整。');
      if (result.scope === 'project') await saveDefaults(exec, result.routes);
      if (project) void prefs.record(project, result.routes).catch(() => {});
      for (const r of result.routes) {
        if (result.scope === 'task' && r.changed) state.routes.set(r.role, { primary: r.primary, fallbacks: r.fallbacks });
        if (result.scope === 'project') state.routes.delete(r.role);
        state.confirmed.set(r.role, keyOf(r));
      }
      routeStore?.save(leadId, state.routes, state.confirmed);
      return { asked: true, scope: result.scope, routes: result.routes.map(r => ({ ...offered.find(o => o.role === r.role), primary: r.primary, fallbacks: r.fallbacks, changed: r.changed })) };
    },
  };
}
/** GET ?sessionId=[&callId=] → pending view (latest one without callId); POST {sessionId, callId, decision, scope, routes, catalogVersion}. */
import { ownsCapabilityTeam } from './preset-guard.js';
export async function handleDispatchConfirm(ctx, request) {
  const fail = (status, code, message) => Response.json({ code, message }, { status });
  try {
    const url = new URL(request.url);
    const lead = id => {
      const agent = typeof id === 'string' && /^[\w.:-]{1,256}$/.test(id) ? ctx.get('agents')?.get(id) : undefined;
      return ownsCapabilityTeam(ctx, agent) && ctx.get('agentTeams')?.tryMembership(agent)?.role === 'lead' ? agent : undefined;
    };
    if (request.method === 'GET') {
      const agent = lead(url.searchParams.get('sessionId'));
      if (!agent) return fail(404, 'NOT_FOUND', 'Lead unavailable');
      return Response.json(pendingView(agent.id, url.searchParams.get('callId') ?? ''), { headers: { 'cache-control': 'no-store' } });
    }
    if (request.method !== 'POST') return fail(400, 'BAD_REQUEST', 'Method not allowed');
    if (crossSiteRequest(request)) return fail(403, 'FORBIDDEN', 'Same-origin required');
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return fail(400, 'BAD_REQUEST', 'JSON required');
    const text = await request.text();
    if (text.length > 16384) return fail(400, 'BAD_REQUEST', 'Body too large');
    let body; try { body = JSON.parse(text); } catch { return fail(400, 'BAD_REQUEST', 'Invalid JSON'); }
    const agent = lead(body?.sessionId);
    if (!agent) return fail(404, 'NOT_FOUND', 'Lead unavailable');
    const { sessionId: _s, callId, ...answer } = body;
    return Response.json(answerPending(agent.id, callId, answer), { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return fail(error.status ?? 503, error.code ?? 'UNAVAILABLE', error.status ? error.message : 'Dispatch confirm unavailable'); }
}
export function applyDispatchConfirmApi(ctx) {
  ctx.inject?.(['connection', 'agents', 'agentTeams'], scoped => scoped.connection.fetch.register({
    path: DISPATCH_CONFIRM_PATH, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: req => handleDispatchConfirm(scoped, req) }));
}
