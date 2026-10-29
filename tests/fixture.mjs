// A neutral catalog: an official OpenAI-style channel, an official Anthropic channel and a
// third-party relay that prefixes vendor names. Routes in tests are derived from it, never hardcoded.
import { seed, withAutoRoutes } from '../config.js';
import { autoMatch } from '../defaults.js';
export const CATALOG = {
  openai: ['gpt-5.5', 'gpt-5.5-pro', 'gpt-5-mini', 'gpt-5-nano', 'gpt-image-1', 'text-embedding-3-large'],
  anthropic: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  relay: ['anthropic/claude-opus-4-8', 'google/gemini-3-pro-preview', 'gemini-3-flash', 'x-ai/grok-4', 'deepseek-chat', 'meta-llama/llama-4-scout:free', 'house-model-x'],
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
