import { m as modelText } from './i18n.js';
// Model catalog lookups happen only when a configuration is saved, never per request.
export async function modelCatalog(llm, tiers = {}) {
  const entries = []; const errors = [];
  for (const provider of llm.listProviders()) {
    try {
      for (const model of await llm.listModels(provider.id)) {
        entries.push({ provider: provider.id, providerName: provider.name, model: model.id, name: model.name,
          tiers: Object.entries(tiers).filter(([, ids]) => ids.includes(model.id)).map(([tier]) => tier) });
      }
    } catch { errors.push({ provider: provider.id, error: modelText('allocation.027') }); }
  }
  return { entries, errors };
}
/** Every capability whose provider/model changed must exist in the live catalog. */
export function changedRoutes(before, after) {
  const routes = c => [c, ...c.fallbacks, ...(c.longContext ? [c.longContext] : [])];
  const known = new Set(Object.values(before.capabilities).flatMap(routes).map(r => `${r.provider}/${r.model}`));
  return Object.entries(after.capabilities).flatMap(([id, c]) => routes(c)
    .filter(r => r.provider !== undefined && !known.has(`${r.provider}/${r.model}`))
    .map(r => ({ capability: id, provider: r.provider, model: r.model, tier: c.tier })));
}
export function verifyRoutes(routes, catalog) {
  for (const r of routes) {
    if (!catalog.entries.some(e => e.provider === r.provider && e.model === r.model)) {
      throw new Error(modelText('allocation.028', { 0: r.capability, 1: r.provider, 2: r.model }));
    }
  }
}
/** Replace the inherited route; provider-specific controls do not transfer between models. */
export function allocatedRequest(previous, role) {
  const { reasoningEffort, temperature, maxTokens, stop, ...rest } = previous;
  return { ...rest, provider: role.provider, model: role.model };
}
