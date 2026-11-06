// Per-extension panel field lists (contract section E). A field is addressed by:
//   path  - key in the bundle's volatile DSH settings section (non-secret values, written with form.mutate)
//   ref   - env-style name shared with the managed manifest and the credential store (see catalog.js)
// Secret fields have no path: they are credentials (ctx.remote.credentials), never settings values.
// `enabled` is deliberately absent: on/off is DSH's own plugin switch on the Plugins page.
// Labels live in the dictionaries (locale/*.json, plus catalog.js for ref fields) under `field.<ref or id>`.
const field = (id, kind, extra = {}) => Object.freeze({ id, kind, ...extra });
const num = (id, min, max, step = 1) => field(id, 'number', { path: id, min, max, step });
const secret = ref => field(ref, 'secret', { ref });

export const PANELS = Object.freeze({
  autocomplete: Object.freeze({
    extension: 'autocomplete', bundle: '@aiwuk/autocomplete', namespace: 'autocomplete',
    fields: Object.freeze([
      field('routeMode', 'enum', { path: 'routeMode', ref: 'AUTOCOMPLETE_ROUTE_MODE', options: ['session', 'fixed'] }),
      field('provider', 'text', { path: 'provider', ref: 'AUTOCOMPLETE_PROVIDER', showWhen: { routeMode: 'fixed' } }),
      field('model', 'text', { path: 'model', ref: 'AUTOCOMPLETE_MODEL', showWhen: { routeMode: 'fixed' } }),
      num('maxSuggestions', 1, 5), num('typePauseMs', 200, 5000, 50), num('maxOutputTokens', 16, 2048),
      num('timeoutMs', 1000, 120000, 500), num('maxMessages', 1, 50), num('maxChars', 500, 32000, 100),
      field('mobileBar', 'switch', { path: 'mobileBar' }),
    ]),
  }),
  memory: Object.freeze({
    extension: 'memory', bundle: '@aiwuk/memory', namespace: 'global-memory',
    fields: Object.freeze([
      field('autoRecall', 'switch', { path: 'autoRecall' }),
      num('injectChars', 200, 6000, 100), num('recallK', 1, 20),
      field('memoryBackend', 'enum', { path: 'memoryBackend', ref: 'MEMORY_BACKEND', options: ['local', 'openviking'] }),
      field('memoryUrl', 'url', { path: 'memoryUrl', ref: 'OPENVIKING_URL' }),
      field('embeddingBaseUrl', 'url', { path: 'embeddingBaseUrl', ref: 'EMBEDDING_BASE_URL' }),
      field('embeddingModel', 'text', { path: 'embeddingModel', ref: 'EMBEDDING_MODEL' }),
      secret('OPENVIKING_API_KEY'), secret('EMBEDDING_API_KEY'),
    ]),
  }),
  search: Object.freeze({
    extension: 'search', bundle: '@aiwuk/search', namespace: 'omni-search',
    fields: Object.freeze([
      field('engines', 'enum', { path: 'engines', ref: 'OMNI_SEARCH_ENGINES', options: ['tavily', 'brave', 'searxng', 'custom'], multiple: true }),
      field('fetchEngines', 'enum', { path: 'fetchEngines', ref: 'OMNI_FETCH_ENGINES', options: ['jina', 'tavily', 'custom'], multiple: true }),
      field('baseUrl', 'url', { path: 'baseUrl', ref: 'OMNI_SEARCH_BASE_URL' }),
      field('searxngUrl', 'url', { path: 'searxngUrl', ref: 'SEARXNG_URL' }),
      field('audioBaseUrl', 'url', { path: 'audioBaseUrl', ref: 'OMNI_AUDIO_BASE_URL' }),
      secret('OMNI_SEARCH_API_KEY'), secret('TAVILY_API_KEY'), secret('BRAVE_API_KEY'),
      secret('SEARXNG_API_KEY'), secret('JINA_API_KEY'), secret('OMNI_AUDIO_API_KEY'),
    ]),
  }),
  // The team bundle has no editable integration fields: its page summarizes the Memory and Search panels.
  team: Object.freeze({ extension: 'team', bundle: '@aiwuk/team', namespace: 'capability-team-ui', fields: Object.freeze([]) }),
});
