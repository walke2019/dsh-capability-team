import { randomUUID, createHash } from 'node:crypto';
import { TIER_ORDER } from './defaults.js';
import { routeMatcher, routeKey } from './model-policy.js';
import { params } from './tool-schema.js';
import { ownsCapabilityTeam } from './preset-guard.js';
import { redactReason } from './task-control-audit.js';
import { baseName } from './session-rotation.js';
import { legacyRoleId } from './roster-defaults.js';
export const ESTIMATES = { simple: 15, medium: 40, complex: 80 };
export const judgment = (used, estimated) => used > estimated * 2 ? 'unqualified' : used > estimated * 1.5 ? 'warning' : 'within';
const rank = tier => TIER_ORDER.indexOf(tier);
const bindings = new WeakMap();
const leadBindings = new Map();
export const taskControlSnapshot = id => leadBindings.get(id)?.snapshot({id}) ?? null;
export const taskControlBinding = agent => bindings.get(agent);
export function taskError(code, message, status = 422) { return Object.assign(new Error(message), { code, status }); }
export function createTaskControl(ctx, team, { audit, now = Date.now, onChanged = () => {}, predecessorOf } = {}) {
  const groups = new Map(); let workflow;
  const changed = lead => { group(lead).revision++; try { onChanged(lead.id); } catch { /* notification never changes control */ } };
  let disposed = false;
  const group = lead => { if (!groups.has(lead.id)) groups.set(lead.id, { revision: 0, generation: 0, leases: [], auditTail: [], pending: [], tombstones: new Map(), timer: null, queue: Promise.resolve() }); return groups.get(lead.id); };
  const schedule = lead => {
    const g = group(lead); if (g.timer) clearTimeout(g.timer); g.timer = null;
    if (disposed) return;
    const expiry = Math.min(...g.leases.filter(l => l.status !== 'ended').map(l => l.expiresAt));
    if (!Number.isFinite(expiry)) return;
    g.timer = setTimeout(() => { g.timer = null; void sweep(lead).finally(() => schedule(lead)).catch(() => {}); }, Math.max(0, expiry - now()));
    g.timer.unref?.();
  };
  const validate = (args, method) => {
    const allowed = method === 'budget' ? ['action','role','lease_id','expected_revision','task_id','assignment_id','complexity','timeout_seconds','reason'] : ['action','role','lease_id','expected_revision','provider','model','catalog_version','reason'];
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.getPrototypeOf(args) !== Object.prototype || Object.keys(args).some(k => !allowed.includes(k))) throw taskError('BAD_REQUEST','Unknown fields',400);
    if (!(method === 'budget' ? ['start','finish','inspect'] : ['set','clear','inspect']).includes(args.action)) throw taskError('BAD_REQUEST','Invalid action',400);
    for (const key of allowed.filter(k => !['expected_revision','timeout_seconds'].includes(k))) if (args[key] !== undefined && (typeof args[key] !== 'string' || args[key].length > (key === 'model' ? 512 : 256))) throw taskError('BAD_REQUEST',`Invalid ${key}`,400);
    for (const key of ['expected_revision','timeout_seconds']) if (args[key] !== undefined && (!Number.isSafeInteger(args[key]) || args[key] < 0)) throw taskError('BAD_REQUEST',`Invalid ${key}`,400);
    if (typeof args.role !== 'string' || !args.role || args.role.length > 80) throw taskError('BAD_REQUEST','Invalid role',400);
    if (args.complexity !== undefined && (!Object.hasOwn(ESTIMATES,args.complexity) || !['simple','medium','complex'].includes(args.complexity))) throw taskError('INVALID','Invalid complexity');
    if (args.timeout_seconds !== undefined && (args.timeout_seconds < 60 || args.timeout_seconds > 28800)) throw taskError('INVALID','Invalid timeout');
  };
  const member = (lead, role) => {
    if (!ownsCapabilityTeam(ctx, lead) || ctx.agents.get(lead?.id) !== lead || ctx.agentTeams.tryMembership(lead)?.role !== 'lead') throw taskError('FORBIDDEN', 'Lead only', 403);
    if (typeof role !== 'string' || role.length > 80) throw taskError('BAD_REQUEST','Invalid role',400);
    if (role === 'lead') throw taskError('FORBIDDEN', 'Cannot target Lead', 403);
    const found = ctx.agentTeams.listMembers(lead).find(m => m.name === role && m.role !== 'lead');
    if (!found) throw taskError('NOT_FOUND', 'Member unavailable', 404);
    return found;
  };
  const append = async (lead, action, lease, reason = '', strict = false, intentEventId = null) => {
    const g = group(lead), record = { intentEventId, eventId: randomUUID(), at: now(), action, leadSessionId: lead.id, memberSessionId: lease?.memberSessionId ?? null, leaseId: lease?.leaseId ?? null, roleId: lease?.roleId ?? null, revision: lease?.revision ?? null, actor: lease?._actor ?? {kind:'system',id:lead.id}, from: lease?.override?.from ?? null, to: lease?.override ? {provider:lease.override.provider,model:lease.override.model,tier:lease.override.tier} : null, reasonCode: action, reason: redactReason(reason), source: ['lease-end','threshold-warning','threshold-unqualified'].includes(action) ? 'lifecycle' : lease?._source ?? 'lifecycle', startsUsed: lease?.startsUsed ?? null, estimatedSteps: lease?.estimatedSteps ?? null, complexity: lease?.complexity ?? null, taskId: lease?.taskId ?? null, assignmentId: lease?.assignmentId ?? null };
    try { await audit.append(lead.id, record); } catch { if (strict) throw taskError('AUDIT_UNAVAILABLE', 'Audit unavailable', 503); record.auditWarning = true; }
    record.reason=redactReason(record.reason);record.reasonCode=action;
    g.auditTail = [record, ...g.auditTail].slice(0, 100); changed(lead);
    return record.eventId;
  };
  const end = async (lead, lease, reason) => {
    if (!lease || lease.status === 'ended') return;
    group(lead).tombstones.set(`${lease._generation}:${lease.roleId}`,{assignmentId:lease.assignmentId,judgment:lease.judgment,startsUsed:lease.startsUsed});
    lease._routable=false;
    lease._lastOverride = lease.override; lease.status = 'ended'; lease.override = null; lease.endedAt = now(); lease.endReason = reason; lease.revision++;
    changed(lead); schedule(lead);
    await append(lead, 'lease-end', lease, reason);
  };
  const sweep = async lead => { const endings=[];for (const l of group(lead).leases) if (l.status !== 'ended' && now() >= l.expiresAt) endings.push(end(lead,l,'timeout'));await Promise.all(endings); };
  const serial = (lead, action) => { const g = group(lead), result = g.queue.catch(() => {}).then(action); g.queue = result; return result; };
  const active = (lead, role) => group(lead).leases.find(l => l.roleId === role && l.status !== 'ended');
  // A rotation successor (<role>-rN) works on its predecessor's assignment.
  const currentAssignment = (lead, role) => {const plan=workflow?.state(lead).plan;return plan?.mode==='delegate'?plan.assignments?.find(a=>a.role===role||a.role===baseName(role)):undefined;};
  const requireAssignment = (lead, role) => { if (!currentAssignment(lead, role)) throw taskError('FORBIDDEN', 'Role not in current delegate assignment', 403); };
  const checkCAS = (lease, args) => { if (!lease || args.lease_id !== lease.leaseId || args.expected_revision !== lease.revision) throw taskError('CONFLICT', 'CONFLICT', 409); };
  const steps = id => { const agent = ctx.agents.get(id); try { return ctx.get?.('sessionProjections')?.stateOf(agent.session, 'capabilityTeamReport')?.view?.stepsStarted ?? 0; } catch { return 0; } };
  async function candidates(lead, roleId) {
    member(lead, roleId); const { effective, policy } = await team.load(lead); const entry = effective.roles[roleId] ?? effective.roles[baseName(roleId)] ?? effective.roles[legacyRoleId(baseName(roleId), effective.roles)], capability = effective.capabilities[entry?.capability];
    if (!capability) throw taskError('NOT_FOUND', 'Unknown role', 404);
    const rows = [];
    for (const provider of ctx.llm.listProviders()) {
      let models; try { models = await ctx.llm.listModels(provider.id); } catch { continue; }
      for (const model of models) {
        const tier = TIER_ORDER.findLast(t => effective.tiers[t]?.includes(model.id));
        if (tier && rank(tier) >= rank(capability.tier) && !routeMatcher(policy.disabledRoutes)(routeKey({ provider: provider.id, model: model.id }))) rows.push({ provider: provider.id, model: model.id, tier });
      }
    }
    const catalogVersion = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    return { schemaVersion: 1, role: roleId, catalogVersion, candidates: rows, capability, effective };
  }
  const api = {
    setWorkflow(value) { workflow = value; },
    candidates: async (lead, role) => { const { capability, effective, ...view } = await candidates(lead, role); return view; },
    async dispatch(lead, assignments) {
      const g=group(lead), generation=++g.generation;
      const pending=assignments.map(a=>({role:a.role,complexity:a.complexity??'medium',assignmentId:randomUUID(),generation,consumed:false}));
      const valid=()=>{if(g.generation!==generation)throw taskError('CONFLICT','Dispatch superseded',409);};
      for(const lease of g.leases)lease._routable=false;
      changed(lead);
      await serial(lead, async () => {
        valid();bindings.set(lead,api);leadBindings.set(lead.id,api);
        for(const lease of g.leases){valid();await end(lead,lease,'replaced');valid();}
        g.pending=pending;
      });
      for(const assignment of pending){
        valid();try{member(lead,assignment.role);await api.budget(lead,{action:'start',role:assignment.role,complexity:assignment.complexity,assignment_id:assignment.assignmentId},{kind:'system',id:lead.id});valid();}catch(error){valid();if(error.status!==404)throw error;}
      }
      valid();
    },
    async budget(lead, args, actor = { kind: 'lead', id: lead.id }) {
      validate(args,'budget');
      const generation=group(lead).generation;
      return serial(lead, async () => {
        if(args.action==='start'&&generation!==group(lead).generation)throw taskError('CONFLICT','Dispatch superseded',409);
        const m = member(lead, args.role); bindings.set(lead, api); leadBindings.set(lead.id, api); await sweep(lead);
        if (args.action === 'inspect') return api.snapshot(lead);
        let lease = active(lead, args.role);
        if (args.action === 'finish') { checkCAS(lease, args); await end(lead, lease, 'explicit-finish'); return structuredClone(lease); }
        if (args.action !== 'start') throw taskError('BAD_REQUEST', 'Invalid action', 400);
        requireAssignment(lead, args.role);
        const complexity = args.complexity ?? 'medium', timeout = args.timeout_seconds ?? 7200;
        if (!Object.hasOwn(ESTIMATES,complexity) || !['simple','medium','complex'].includes(complexity)) throw taskError('INVALID', 'Invalid complexity');
        const pending=group(lead).pending.find(a=>a.role===args.role&&a.generation===group(lead).generation);
        if(group(lead).tombstones.has(`${generation}:${args.role}`) || pending?.consumed)throw taskError('CONFLICT','Assignment already consumed; dispatch a new task',409);
        const assignmentId=args.assignment_id ?? pending?.assignmentId ?? lease?.assignmentId ?? `generation:${group(lead).generation}:${args.role}`;
        if(args.task_id){const task=ctx.agentTeams.listTasks(lead).find(t=>t.id===args.task_id);if(!task || (task.ownerName && task.ownerName!==args.role) || (task.owner && ![args.role,m.id].includes(task.owner)))throw taskError('INVALID','Task must exist and belong to member or be unassigned');}
        if(lease){checkCAS(lease,args);throw taskError('CONFLICT','Dispatch a new assignment before starting a new task',409);}
        if(!lease && (args.lease_id!==undefined || args.expected_revision!==undefined))throw taskError('CONFLICT','CONFLICT',409);
        if (args.assignment_id && !group(lead).pending.some(a=>a.role===args.role&&a.assignmentId===args.assignment_id)) throw taskError('FORBIDDEN','Assignment mismatch',403);
        if (typeof args.task_id !== 'undefined' && (typeof args.task_id !== 'string' || args.task_id.length>256)) throw taskError('BAD_REQUEST','Invalid task id',400);
        const newLease = { schemaVersion: 1, leadSessionId: lead.id, memberSessionId: m.id, leaseId: randomUUID(), revision: 1, roleId: args.role, taskId: args.task_id ?? null, assignmentId, status: 'armed', createdAt: now(), startedAt: null, endedAt: null, expiresAt: now() + timeout * 1000, endReason: null, complexity, estimatedSteps: ESTIMATES[complexity], baselineStarts: steps(m.id), startsUsed: 0, judgment: 'within', override: null };
        newLease._generation=generation;newLease._routable=true;newLease._actor=actor;newLease._source=actor.kind==='owner'?'panel':'tool';
        await append(lead, 'budget-start', newLease, args.reason, true);
        requireAssignment(lead,args.role);if(group(lead).generation!==generation)throw taskError('CONFLICT','Assignment generation changed',409);if(lease)checkCAS(lease,args);
        if (lease) await end(lead, lease, 'task-replaced');
        const g = group(lead); if (g.leases.filter(l => l.status !== 'ended').length >= 64) throw taskError('LIMIT', 'Active lease limit');
        g.leases = [newLease, ...g.leases].filter((l, i, all) => l.status !== 'ended' || all.slice(0,i).filter(x=>x.status==='ended').length < 100);
        if(pending)pending.consumed=true;
        changed(lead);schedule(lead);
        const live=ctx.agents.get(m.id); if(live)bindings.set(live, api); return structuredClone(newLease);
      });
    },
    /**
     * Rotation: the successor `to` continues the predecessor's lease of the current dispatch — same assignment,
     * task, complexity, deadline and per-task override, with the steps already used carried over — so the budget
     * keeps counting without a manual start. Returns the new lease, or null when there is nothing to continue.
     */
    async inherit(lead, from, to) {
      return serial(lead, async () => {
        const g = group(lead), m = member(lead, to); await sweep(lead);
        if (active(lead, to)) return null;
        const prev = g.leases.find(l => l.roleId === from && l._generation === g.generation);
        if (!prev || !currentAssignment(lead, to)) return null;
        const override = prev.override ?? prev._lastOverride ?? null;
        if (prev.status !== 'ended') await end(lead, prev, 'rotated');
        const used = prev.startsUsed;
        const { _actor, _source, _generation, _routable, _lastOverride, ...plain } = prev;
        const lease = { ...structuredClone(plain), leaseId: randomUUID(), revision: 1, roleId: to, memberSessionId: m.id, status: 'armed',
          createdAt: now(), startedAt: null, endedAt: null, endReason: null, expiresAt: Math.max(prev.expiresAt, now() + 30 * 60000),
          baselineStarts: steps(m.id) - used, startsUsed: used, override };
        Object.assign(lease, { _generation: g.generation, _routable: true, _actor: { kind: 'system', id: lead.id }, _source: 'lifecycle' });
        await append(lead, 'budget-inherit', lease, `rotated from ${from}`);
        g.leases = [lease, ...g.leases]; changed(lead); schedule(lead);
        const live = ctx.agents.get(m.id); if (live) bindings.set(live, api);
        return structuredClone(lease);
      });
    },
    async override(lead, args, actor = { kind: 'lead', id: lead.id }) {
      validate(args,'override');
      return serial(lead, async () => {
        member(lead, args.role); await sweep(lead); const lease = active(lead,args.role);
        if (args.action === 'inspect') return structuredClone(lease??null);
        checkCAS(lease,args);
        if (args.action === 'clear') { lease._actor=actor;lease._source=actor.kind==='owner'?'panel':'tool';await append(lead,'override-clear',lease,args.reason,true);checkCAS(lease,args);await sweep(lead);checkCAS(lease,args);lease.override=null; lease.revision++;changed(lead);return structuredClone(lease); }
        if (args.action !== 'set') throw taskError('BAD_REQUEST','Invalid action',400);
        requireAssignment(lead,args.role); const catalog = await candidates(lead,args.role);
        if (args.catalog_version && args.catalog_version !== catalog.catalogVersion) throw taskError('CONFLICT','CONFLICT',409);
        const selected = catalog.candidates.find(r=>r.provider===args.provider&&r.model===args.model); if(!selected) throw taskError('INVALID_MODEL','Model unavailable or below capability tier');
        requireAssignment(lead,args.role);await sweep(lead);checkCAS(lease,args);
        lease._actor=actor;lease._source=actor.kind==='owner'?'panel':'tool';
        const intent=await append(lead,'override-set',{...lease,override:{...selected,from:lease.override??catalog.capability}},args.reason,true);
        try{requireAssignment(lead,args.role);await sweep(lead);checkCAS(lease,args);
          if(lease.status==='ended'||lease._routable===false||lease._generation!==group(lead).generation)throw taskError('CONFLICT','Lease invalidated while auditing',409);
        }catch(error){await append(lead,'override-rejected',lease,'',false,intent);throw error;}
        lease.override={...selected,setAt:now(),from:lease.override?{provider:lease.override.provider,model:lease.override.model}:{provider:catalog.capability.provider,model:catalog.capability.model},reason:redactReason(args.reason),actor}; lease.revision++; changed(lead);
        return structuredClone(lease);
      });
    },
    async route(agent, role) {
      const ownIdentity=ctx.agentTeams.tryMembership(agent);
      if(ownIdentity?.role==='lead') {await api.update(agent);return role;}
      const identity=ctx.agentTeams.tryMembership(agent); if(!identity || identity.role==='lead') return role;
      const lead=identity.root ?? ctx.agents.get(identity.leadSessionId ?? identity.rootId); if(!lead) return role;
      const before=active(lead,identity.name);if(before&&(before._routable===false||before._generation!==group(lead).generation||now()>=before.expiresAt))return role;
      await api.update(lead); const lease=active(lead,identity.name); if(!lease?.override || lease._routable===false || lease._generation!==group(lead).generation || now()>=lease.expiresAt) return role;
      const revision=lease.revision, override=lease.override;
      const catalog=await candidates(lead,identity.name);
      if(lease._routable===false || lease._generation!==group(lead).generation || active(lead,identity.name)!==lease || lease.status==='ended' || lease.revision!==revision || lease.override!==override || now()>=lease.expiresAt)return role;
      const chosen=catalog.candidates.find(r=>r.provider===override.provider&&r.model===override.model);
      if(!chosen) { lease.override=null; lease.revision++; await append(lead,'override-clear',lease,'override-invalid'); return role; }
      return {...role,provider:chosen.provider,model:chosen.model,fallbacks:(role.fallbacks??[]).filter(r=>catalog.candidates.some(c=>c.provider===r.provider&&c.model===r.model&&rank(c.tier)>=rank(chosen.tier))),longContext:undefined,taskLeaseSignature:`${lease.leaseId}:${lease.revision}`};
    },
    async status(agent,status) {
      for(const [id,g] of groups) { const lead=ctx.agents.get(id); if(!lead) continue;
        for(const l of g.leases.filter(l=>l.memberSessionId===agent.id&&l.status!=='ended')) {
          if(status==='disposed') await end(lead,l,'disposed');
          else if(status==='running'&&l.status==='armed') {l.status='running';l.startedAt=now();l.revision++;changed(lead);}
          else if(status==='idle'&&l.status==='running'&&agent.status==='idle') {await api.update(lead);const revision=l.revision;await Promise.resolve();if(agent.status==='idle'&&l.revision===revision&&active(lead,l.roleId)===l)await end(lead,l,'idle');}
        }
      }
    },
    async update(lead) {
      await sweep(lead); for(const l of group(lead).leases.filter(l=>l.status!=='ended')) {
        const task=l.taskId ? ctx.agentTeams.listTasks(lead).find(t=>t.id===l.taskId):null;
        if(task?.status==='completed') {await end(lead,l,'task-completed');continue;}
        const used=Math.max(l.startsUsed,steps(l.memberSessionId)-l.baselineStarts);if(used!==l.startsUsed){l.startsUsed=used;l.revision++;changed(lead);}
        const next=judgment(l.startsUsed,l.estimatedSteps);
        if(['within','warning','unqualified'].indexOf(next)>['within','warning','unqualified'].indexOf(l.judgment)){l.judgment=next;l.revision++;await append(lead,`threshold-${next}`,l);}
      }
    },
    snapshot(lead) {const g=group(lead);for(const l of g.leases)if(l.status!=='ended'&&now()>=l.expiresAt){void end(lead,l,'timeout').catch(()=>{});}return structuredClone({schemaVersion:1,revision:g.revision,leases:g.leases.map(({_actor,_source,_generation,_routable,_lastOverride,...lease})=>lease),auditTail:g.auditTail});},
    summary(lead) {for(const l of group(lead).leases.filter(l=>l.status!=='ended')){const used=Math.max(l.startsUsed,steps(l.memberSessionId)-l.baselineStarts);const next=judgment(used,l.estimatedSteps);if(used!==l.startsUsed){l.startsUsed=used;l.revision++;changed(lead);}if(['within','warning','unqualified'].indexOf(next)>['within','warning','unqualified'].indexOf(l.judgment)){l.judgment=next;l.revision++;void append(lead,`threshold-${next}`,l);}}return JSON.stringify(api.snapshot(lead).leases.filter(l=>l.status!=='ended'&&l.judgment!=='within').map(l=>({role:l.roleId,used:l.startsUsed,estimated:l.estimatedSteps,judgment:l.judgment}))).slice(0,2000);},
    dispose() {disposed=true;for(const [id,g] of groups){if(g.timer)clearTimeout(g.timer);leadBindings.delete(id);}groups.clear();},
    register() {
      ctx.effect(()=>()=>api.dispose());
      ctx.inject?.(['sessionProjections'], scoped => scoped.effect(() => scoped.sessionProjections.onChanged((session,key) => {
        if (!['capabilityTeamReport','agentTeam'].includes(key)) return;
        for (const [id,g] of groups) { const lead=ctx.agents.get(id); if(!lead)continue;
          for(const l of g.leases) if(l.memberSessionId===session.header.id && l.status==='armed' && steps(l.memberSessionId)>l.baselineStarts) {l.status='running';l.startedAt=now();l.revision++;changed(lead);}
          void api.update(lead).catch(()=>{});
        }
      })));
      ctx.on('agent/status',({agent,status})=>{if(ownsCapabilityTeam(ctx,agent))void api.status(agent,status).catch(()=>{});});
      ctx.on('agent/created',({agent})=>{if(!ownsCapabilityTeam(ctx,agent))return;const identity=ctx.agentTeams.tryMembership(agent);if(identity?.role==='teammate'){const lead=identity.root;const pending=group(lead).pending.find(a=>a.role===identity.name&&!a.consumed&&!a.claimed&&a.generation===group(lead).generation);if(pending){pending.claimed=true;void api.budget(lead,{action:'start',role:pending.role,complexity:pending.complexity,assignment_id:pending.assignmentId},{kind:'system',id:lead.id}).catch(()=>{});}else{const from=predecessorOf?.(lead.id,identity.name);if(from)void api.inherit(lead,from,identity.name).catch(()=>{});}}});
      ctx.on('agent/disposed',({agent})=>{if(ownsCapabilityTeam(ctx,agent))void api.status(agent,'disposed').catch(()=>{});});
      for(const [name,method] of [['capability_task_budget','budget'],['capability_member_override','override']]) ctx.effect(()=>ctx.tools.register({name,description:'单队友单任务，不修改配置。budget action=start/finish/inspect，override action=set/clear/inspect。先inspect获取leaseId与revision；修改需lease_id和expected_revision，CONFLICT后重新inspect。同一assignment不能重置预算。',parameters:params(Object.fromEntries((method==='budget'?['action','role','lease_id','expected_revision','task_id','assignment_id','complexity','timeout_seconds','reason']:['action','role','lease_id','expected_revision','provider','model','catalog_version','reason']).map(k=>[k,{type:['expected_revision','timeout_seconds'].includes(k)?'number':'string',...(k==='action'?{enum:method==='budget'?['start','finish','inspect']:['set','clear','inspect']}:k==='complexity'?{enum:['simple','medium','complex']}:{})}])),['action','role']),output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute:async(args,exec)=>JSON.stringify(await api[method](exec.agent,args))}));
    },
  };
  for (const method of ['budget','override']) {
    const original=api[method];
    api[method]=async (lead,args,actor)=>{try{return await original(lead,args,actor);}catch(error){
      if(ctx.agentTeams.tryMembership(lead)?.role==='lead') await append(lead,'rejected',null,error.code??'rejected');
      throw error;
    }};
  }
  return api;
}
