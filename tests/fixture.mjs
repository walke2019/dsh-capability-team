// A neutral catalog: an official OpenAI-style channel, an official Anthropic channel and a
// third-party relay that prefixes vendor names. Routes in tests are derived from it, never hardcoded.
// IDs follow the 2026-10 public naming (GPT-6 astra/sol/terra/luna, Gemini 4 codenames).
import { seed, withAutoRoutes } from '../config.js';
import { autoMatch } from '../defaults.js';
export const CATALOG = {
  openai: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-sol-pro', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-image-2', 'text-embedding-3-large'],
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5-20261007'],
  relay: ['anthropic/claude-opus-5.5', 'google/gemini-4-argon', 'google/gemini-3.8-flash', 'x-ai/grok-4.7', 'deepseek/deepseek-v4.1-flash', 'meta-llama/llama-4-scout:free', 'house-model-x'],
};
export const entries = Object.entries(CATALOG).flatMap(([provider, ids]) => ids.map(model => ({ provider, model })));
export function fakeLlm(catalog = CATALOG) {
  return {
    listProviders: () => Object.keys(catalog).map(id => ({ id, name: id })),
    listModels: async id => (catalog[id] ?? []).map(m => ({ id: m, name: m })),
  };
}
export const match = autoMatch(entries, seed.capabilities);
export const base = withAutoRoutes(seed, match);
