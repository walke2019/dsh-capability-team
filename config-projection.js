// Client-visible per-session counter of successful team-configuration changes: capability_team_save / _import
// results and /capability-model-policy saves. The overview re-reads its configuration snapshot only when this
// number moves, so every tab stays current without running the (conversation-logged) status command on a timer.
export const CONFIG_KEY = 'capabilityTeamConfig';
const SAVE_TOOLS = ['capability_team_save', 'capability_team_import'];
const POLICY_COMMAND = 'capability-model-policy';
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const schema = (check, label) => ({ parse(value) { if (!check(value)) throw new Error(`${label} 格式无效`); return value; } });
const isIds = v => Array.isArray(v) && v.length <= 64 && v.every(id => typeof id === 'string');
export const configDefinition = {
  key: CONFIG_KEY,
  stateVersion: 1,
  stateSchema: schema(v => isMap(v) && Number.isSafeInteger(v.version) && isIds(v.pending), 'capabilityTeamConfig 状态'),
  init: () => ({ version: 0, pending: [] }),
  apply(state, event) {
    const d = event.data ?? {};
    // Remember in-flight saves by id; a bounded list, since an id settles at most once.
    if ((event.type === 'tool/call' && SAVE_TOOLS.includes(d.name)) || (event.type === 'command/run' && d.name === POLICY_COMMAND)) {
      const id = event.type === 'tool/call' ? d.callId : d.commandId;
      return typeof id === 'string' ? { ...state, pending: [...state.pending, id].slice(-64) } : state;
    }
    const id = event.type === 'tool/result' ? d.message?.toolCallId : event.type === 'command/done' ? d.commandId : undefined;
    if (typeof id !== 'string' || !state.pending.includes(id)) return state;
    const ok = event.type === 'tool/result' ? !d.message?.isError : d.kind === 'success';
    return { version: state.version + (ok ? 1 : 0), pending: state.pending.filter(p => p !== id) };
  },
  wire: {
    viewSchema: schema(v => isMap(v) && Number.isSafeInteger(v.version), 'capabilityTeamConfig 视图'),
    view: state => ({ version: state.version }),
  },
};
/** Register the counter when the host composes the projection registry; the overview works without it. */
export function applyConfigProjection(ctx) {
  if (typeof ctx.inject !== 'function') return;
  ctx.inject(['sessionProjections'], scoped => {
    scoped.effect(() => scoped.sessionProjections.register(configDefinition), 'capability-team: config projection');
  });
}
