// Profile-wide first-run status for the Web onboarding card: whether DSH's official Agent Teams service is
// running, the official bundle's selection state, and how far the live model catalog covers the default tiers.
// Read-only: enabling the bundle is a user click in the browser through DSH's own pluginManager Remote.
import { seed } from './config.js';
import { autoMatch } from './defaults.js';
export const ONBOARDING_PATH = '/api/capability-team.onboarding';
export const AGENT_TEAM_BUNDLE = '@deepseek-ai/dsh-experimental-agent-team-profile';
/** The official bundle row from pluginManager.listBundles(), reduced to what the card needs. */
export async function teamBundleStatus(pluginManager) {
  if (typeof pluginManager?.listBundles !== 'function') return { known: false };
  try {
    const listed = await pluginManager.listBundles();
    const rows = Array.isArray(listed) ? listed : listed?.ok ? listed.value : [];
    const row = rows.find(b => b?.name === AGENT_TEAM_BUNDLE);
    if (!row) return { known: true, listed: false };
    return { known: true, listed: true, enabled: !!row.enabled, installed: !!row.installed, availability: row.availability ?? null, ...(row.error?.code ? { error: row.error.code } : {}) };
  } catch (error) { return { known: false, error: String(error?.message ?? error).slice(0, 200) }; }
}
/** Tier coverage of the seed capabilities against the live catalog; no model is called. */
export async function tierCoverage(llm, capabilities = seed.capabilities) {
  if (typeof llm?.listProviders !== 'function') return { known: false };
  const entries = []; const errors = [];
  for (const provider of llm.listProviders()) {
    try { for (const m of await llm.listModels(provider.id)) entries.push({ provider: provider.id, model: m.id }); }
    catch { errors.push(provider.id); }
  }
  const { report } = autoMatch(entries, capabilities);
  const unassigned = report.filter(r => r.status === 'unassigned').map(r => r.capability);
  return { known: true, models: entries.length, capabilities: report.length, covered: report.length - unassigned.length, unassigned, ...(errors.length ? { catalogErrors: errors } : {}) };
}
/** Everything the onboarding card shows; each part degrades to `known: false` instead of failing. */
export async function onboardingStatus(ctx) {
  const selection = (() => { try { return ctx.get?.('agentDefaultModel')?.currentSelection?.(); } catch { return undefined; } })();
  return {
    teamServicePresent: !!ctx.get?.('agentTeams'),
    bundle: await teamBundleStatus(ctx.get?.('pluginManager')),
    coverage: await tierCoverage(ctx.get?.('llm')).catch(() => ({ known: false })),
    ...(selection?.provider && selection?.model ? { defaultModel: `${selection.provider}/${selection.model}` } : {}),
  };
}
export function applyOnboardingApi(ctx) {
  ctx.inject?.(['connection'], scoped => scoped.connection.fetch.register({ path: ONBOARDING_PATH, methods: ['GET'], requestBody: 'buffered',
    fetch: async () => {
      try { return Response.json(await onboardingStatus(ctx), { headers: { 'cache-control': 'no-store' } }); }
      catch { return Response.json({ code: 'UNAVAILABLE' }, { status: 503 }); }
    } }));
}
