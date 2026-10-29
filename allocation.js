// Model catalog lookups happen only when a configuration is saved, never per request.
export async function modelCatalog(llm, tiers = {}) {
  const entries = []; const errors = [];
  for (const provider of llm.listProviders()) {
    try {
      for (const model of await llm.listModels(provider.id)) {
        entries.push({ provider: provider.id, providerName: provider.name, model: model.id, name: model.name,
          tiers: Object.entries(tiers).filter(([, ids]) => ids.includes(model.id)).map(([tier]) => tier) });
      }
    } catch { errors.push({ provider: provider.id, error: '模型目录读取失败，禁止从该渠道新增分配' }); }
  }
  return { entries, errors };
}
/** Every capability whose provider/model changed must exist in the live catalog. */
export function changedRoutes(before, after) {
  const known = new Set(Object.values(before.capabilities).flatMap(c => [c, ...c.fallbacks]).map(r => `${r.provider}/${r.model}`));
  return Object.entries(after.capabilities).flatMap(([id, c]) => [c, ...c.fallbacks]
    .filter(r => !known.has(`${r.provider}/${r.model}`))
    .map(r => ({ capability: id, provider: r.provider, model: r.model, tier: c.tier })));
}
export function verifyRoutes(routes, catalog) {
  for (const r of routes) {
    if (!catalog.entries.some(e => e.provider === r.provider && e.model === r.model)) {
      throw new Error(`能力 ${r.capability} 的模型 ${r.provider}/${r.model} 不在当前DSH模型目录中；请先在DSH配置该渠道或改选目录中的模型`);
    }
  }
}
/** Replace the inherited route; provider-specific controls do not transfer between models. */
export function allocatedRequest(previous, role) {
  const { reasoningEffort, temperature, maxTokens, stop, ...rest } = previous;
  return { ...rest, provider: role.provider, model: role.model };
}
