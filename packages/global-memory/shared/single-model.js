import { m as modelText, t } from './i18n.js';
// Explicit single-model mode: an opt-in, user-confirmed degrade for catalogs that cannot fill every capability tier.
// Only roles whose capability has no assigned route use the accepted model; assigned roles keep their own routes.
// There are no backups in this mode (failover stays same-tier only), so a failing single model surfaces as an error.
const LINE_CONTROL = /[\x00-\x1f\x7f]/;
const KEYS = ['provider', 'model', 'acceptedAt'];
const text = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || LINE_CONTROL.test(value)) throw new Error(modelText('single-model.478', { 0: label, 1: max }));
  return value.trim();
};
/** Validate a stored `singleModel` field; undefined/null means the mode is off. */
export function validateSingleModel(value) {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(modelText('single-model.479'));
  const extra = Object.keys(value).filter(k => !KEYS.includes(k));
  if (extra.length) throw new Error(modelText('single-model.480', { 0: extra.join(', ') }));
  const acceptedAt = text(value.acceptedAt, 40, 'acceptedAt');
  if (Number.isNaN(Date.parse(acceptedAt))) throw new Error(modelText('single-model.481'));
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
  if (!b) return [t('single-model.482', { 0: a })];
  return [t('single-model.483', { 0: b })];
}
/** Build the stored field from the DSH default model selection (agentDefaultModel.currentSelection()). */
export function singleModelFrom(selection, now = new Date()) {
  if (!selection?.provider || !selection?.model) throw new Error(modelText('single-model.484'));
  return validateSingleModel({ provider: String(selection.provider), model: String(selection.model), acceptedAt: now.toISOString() });
}
