// Dispatch confirmation: before a delegate plan takes effect, the user sees every assigned role with its
// primary model and up to three fallbacks, and may change them for this task or save them as the project
// default. The Web card answers over api/capability-team.dispatch-confirm; hosts without the card fall back
// to DSH's native question box. Confirmed per-task routes live in memory per Lead and are applied by
// team.resolve before the global model policy, so disabled models stay disabled.
import { createHash } from 'node:crypto';
import { modelCatalog, verifyRoutes } from './allocation.js';
import { routeKey, routeMatcher } from './model-policy.js';
import { saveProject } from './theme.js';
export const DISPATCH_CONFIRM_PATH = '/api/capability-team.dispatch-confirm';
export { CONFIRM_MODES } from './config.js';
export const MAX_ROUTE_FALLBACKS = 3;
const CARD_GRACE_MS = 8000; // no card asked for the request in this time → the host has no card; use the question box
const leads = new Map(); // lead id → { pending: Map(callId → request), routes: Map(role → route), confirmed: Map(role → key) }
const stateOf = id => { if (!leads.has(id)) leads.set(id, { pending: new Map(), routes: new Map(), confirmed: new Map() }); return leads.get(id); };
const sameRoute = (a, b) => a?.provider === b?.provider && a?.model === b?.model;
const keyOf = r => JSON.stringify([r.primary ? routeKey(r.primary) : null, r.fallbacks.map(routeKey)]);
export const parseRoute = text => {
  const s = String(text ?? '').trim(); const i = s.indexOf('/');
  return i > 0 && i < s.length - 1 && !/\s/.test(s) ? { provider: s.slice(0, i), model: s.slice(i + 1) } : undefined;
};
/** Per-task route the user confirmed for a member of this Lead, if any. */
export function confirmedRoute(leadId, role) { return leads.get(leadId)?.routes.get(role); }
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
    const candidates = catalog.entries.filter(e => tierModels.includes(e.model) && !disabled(routeKey(e)))
      .map(e => ({ provider: e.provider, model: e.model }));
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
    if (!r) return { role: o.role, capability: o.capability, primary: o.primary, fallbacks: o.fallbacks, changed: false };
    const allowed = route => o.candidates.some(c => sameRoute(c, route)) || sameRoute(route, o.primary) || o.fallbacks.some(f => sameRoute(f, route));
    const primary = typeof r.primary === 'string' ? parseRoute(r.primary) : r.primary;
    if (!primary?.provider || !primary?.model || !allowed(primary)) throw new Error(`${o.displayName ?? o.role} 的主模型 ${primary ? routeKey(primary) : String(r.primary)} 不在同档可用模型中`);
    const list = (Array.isArray(r.fallbacks) ? r.fallbacks : []).map(f => (typeof f === 'string' ? parseRoute(f) : f));
    if (list.length > MAX_ROUTE_FALLBACKS) throw new Error(`${o.displayName ?? o.role} 的回退模型最多 ${MAX_ROUTE_FALLBACKS} 个`);
    const seen = new Set([routeKey(primary)]);
    for (const f of list) {
      if (!f?.provider || !f?.model || !allowed(f)) throw new Error(`${o.displayName ?? o.role} 的回退模型 ${f ? routeKey(f) : '?'} 不在同档可用模型中`);
      if (seen.has(routeKey(f))) throw new Error(`${o.displayName ?? o.role} 的回退模型 ${routeKey(f)} 与主模型或其他回退重复`);
      seen.add(routeKey(f));
    }
    const changed = !sameRoute(primary, o.primary) || keyOf({ primary, fallbacks: list }) !== keyOf(o);
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
/** Public view of a pending request for the card. */
export function pendingView(leadId, callId) {
  const request = leads.get(leadId)?.pending.get(callId);
  if (!request) return { schemaVersion: 1, status: 'none' };
  request.seen = true;
  return { schemaVersion: 1, status: 'pending', callId, catalogVersion: request.catalogVersion, maxFallbacks: MAX_ROUTE_FALLBACKS, routes: request.offered };
}
/** Resolve a pending request with the card's answer; throws (with status) when it cannot. */
export function answerPending(leadId, callId, answer) {
  const request = leads.get(leadId)?.pending.get(callId);
  if (!request) throw Object.assign(new Error('没有等待确认的分派'), { status: 404, code: 'NOT_FOUND' });
  if (answer?.catalogVersion !== undefined && answer.catalogVersion !== request.catalogVersion) throw Object.assign(new Error('可用模型已变化，请刷新后重新确认'), { status: 409, code: 'CONFLICT' });
  let result;
  try { result = validateAnswer(request.offered, answer); } catch (error) { throw Object.assign(error, { status: 422, code: 'INVALID' }); }
  request.resolve(result);
  return { schemaVersion: 1, status: 'resolved', decision: result.decision };
}
const fallbackText = r => r.fallbacks.length ? r.fallbacks.map(routeKey).join('、') : '无';
const routeLine = r => `${r.displayName ?? r.role}（${r.capability}）：主 ${r.primary ? routeKey(r.primary) : '未分配'}；回退 ${fallbackText(r)}`;
/** Native question box: confirm as offered, or type changes as "角色: 主模型, 回退1, 回退2". */
async function askNative(userQuestions, exec, offered) {
  const answer = await userQuestions.ask({ agent: exec.agent, signal: exec.signal, questions: [{
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
export function createDispatchConfirm(ctx, team, { graceMs = CARD_GRACE_MS } = {}) {
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
    /**
     * Ask the user to confirm a delegate plan. Resolves with the confirmed routes (applied to this Lead),
     * or throws when the user cancels. `mode` is workflow.confirmDispatch.
     */
    async confirm(exec, plan, effective, policy, mode = 'on-change') {
      const leadId = exec.agent.id;
      const state = stateOf(leadId);
      const catalog = await modelCatalog(ctx.llm, effective.tiers);
      const offered = planRoutes(plan, effective, policy.disabledRoutes, catalog).map(r => {
        const prior = state.routes.get(r.role);
        return prior ? { ...r, primary: prior.primary, fallbacks: prior.fallbacks } : r;
      });
      const unchanged = offered.every(r => state.confirmed.get(r.role) === keyOf(r));
      if (mode === 'never' || (mode === 'on-change' && unchanged)) return { asked: false, routes: offered };
      const catalogVersion = createHash('sha256').update(JSON.stringify(offered.map(r => r.candidates))).digest('hex').slice(0, 16);
      const callId = exec.callId ?? `dispatch-${Date.now()}`;
      let result;
      try {
        result = await new Promise((resolve, reject) => {
          const request = { offered, catalogVersion, seen: false, resolve };
          state.pending.set(callId, request);
          const onAbort = () => reject(new Error('分派确认已中止'));
          exec.signal?.addEventListener?.('abort', onAbort, { once: true });
          const timer = setTimeout(() => {
            if (request.seen || !ctx.userQuestions?.ask) return;
            askNative(ctx.userQuestions, exec, offered)
              .then(answer => { if (state.pending.get(callId) === request) resolve(validateAnswer(offered, answer)); })
              .catch(reject);
          }, graceMs);
          timer.unref?.();
        });
      } finally { state.pending.delete(callId); }
      if (result.decision === 'cancel') throw new Error('用户取消了这次分派，未创建或通知任何队友。请询问用户要如何调整。');
      if (result.scope === 'project') await saveDefaults(exec, result.routes);
      for (const r of result.routes) {
        if (result.scope === 'task' && r.changed) state.routes.set(r.role, { primary: r.primary, fallbacks: r.fallbacks });
        if (result.scope === 'project') state.routes.delete(r.role);
        state.confirmed.set(r.role, keyOf(r));
      }
      return { asked: true, scope: result.scope, routes: result.routes.map(r => ({ ...offered.find(o => o.role === r.role), primary: r.primary, fallbacks: r.fallbacks, changed: r.changed })) };
    },
  };
}
/** GET ?sessionId=&callId= → pending view; POST {sessionId, callId, decision, scope, routes, catalogVersion}. */
export async function handleDispatchConfirm(ctx, request) {
  const fail = (status, code, message) => Response.json({ code, message }, { status });
  try {
    const url = new URL(request.url);
    const lead = id => {
      const agent = typeof id === 'string' && /^[\w.:-]{1,256}$/.test(id) ? ctx.get('agents')?.get(id) : undefined;
      return agent && ctx.get('agentTeams')?.tryMembership(agent)?.role === 'lead' ? agent : undefined;
    };
    if (request.method === 'GET') {
      const agent = lead(url.searchParams.get('sessionId'));
      if (!agent) return fail(404, 'NOT_FOUND', 'Lead unavailable');
      return Response.json(pendingView(agent.id, url.searchParams.get('callId') ?? ''), { headers: { 'cache-control': 'no-store' } });
    }
    if (request.method !== 'POST') return fail(400, 'BAD_REQUEST', 'Method not allowed');
    if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') return fail(403, 'FORBIDDEN', 'Same-origin required');
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
