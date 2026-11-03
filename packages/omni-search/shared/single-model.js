// Explicit single-model mode: an opt-in, user-confirmed degrade for catalogs that cannot fill every capability tier.
// Only roles whose capability has no assigned route use the accepted model; assigned roles keep their own routes.
// There are no backups in this mode (failover stays same-tier only), so a failing single model surfaces as an error.
const LINE_CONTROL = /[\x00-\x1f\x7f]/;
const KEYS = ['provider', 'model', 'acceptedAt'];
const text = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || LINE_CONTROL.test(value)) throw new Error(`单模型模式的 ${label} 须为1–${max}字符且不含控制字符`);
  return value.trim();
};
/** Validate a stored `singleModel` field; undefined/null means the mode is off. */
export function validateSingleModel(value) {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('singleModel 必须为对象 {provider, model, acceptedAt}');
  const extra = Object.keys(value).filter(k => !KEYS.includes(k));
  if (extra.length) throw new Error(`singleModel 含未知字段 ${extra.join(', ')}`);
  const acceptedAt = text(value.acceptedAt, 40, 'acceptedAt');
  if (Number.isNaN(Date.parse(acceptedAt))) throw new Error('单模型模式的 acceptedAt 须为 ISO 时间');
  return { provider: text(value.provider, 200, 'provider'), model: text(value.model, 200, 'model'), acceptedAt };
}
/** Patch rule shared with the other config sections: undefined keeps, null turns the mode off, an object replaces it. */
export function patchSingleModel(current, patch) {
  const next = patch === undefined ? current : patch === null ? undefined : validateSingleModel(patch);
  return next === undefined ? {} : { singleModel: next };
}
/** The route a capability resolves to: its own, the accepted single model when it has none, or unassigned. */
export function effectiveRoute(c, singleModel) {
  if (c.provider !== undefined) return { provider: c.provider, model: c.model, fallbacks: c.fallbacks };
  if (singleModel) return { provider: singleModel.provider, model: singleModel.model, fallbacks: [], singleModel: true };
  return { provider: undefined, model: undefined, fallbacks: c.fallbacks ?? [], unassigned: true };
}
/** Confirmation-dialog lines for a change of the mode. */
export function singleModelChanges(before, after) {
  const a = before ? `${before.provider}/${before.model}` : undefined;
  const b = after ? `${after.provider}/${after.model}` : undefined;
  if (a === b) return [];
  if (!b) return [`单模型模式：关闭（原 ${a}）；未分配模型的角色恢复为阻止请求`];
  return [`单模型模式：开启 → 所有未分配模型的角色统一使用 ${b}；无同档备选，失败直接报告；已分配模型的角色保持原路由。可随时关闭。`];
}
/** Build the stored field from the DSH default model selection (agentDefaultModel.currentSelection()). */
export function singleModelFrom(selection, now = new Date()) {
  if (!selection?.provider || !selection?.model) throw new Error('无法读取 DSH 当前默认模型；请先在设置中选择一个默认模型，再开启单模型模式');
  return validateSingleModel({ provider: String(selection.provider), model: String(selection.model), acceptedAt: now.toISOString() });
}
