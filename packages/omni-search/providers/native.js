import { activeEngines, omni, searchSettings } from '../shared/search.js';
import { INTEGRATION_DEFAULTS } from '../shared/integrations-config.js';
import { transcribe, audioSettings } from '../shared/transcribe.js';
import { BRAND } from '../shared/brand.js';

const SPEECH_NAME = `${BRAND.en} Cloud STT`;
const usable = (engine, settings) => {
  if (engine === 'searxng') return Boolean(settings.config.searxngUrl);
  if (engine === 'custom') return Boolean(settings.config.baseUrl && (settings.keys?.custom ?? settings.key));
  return Boolean(settings.keys?.[engine]);
};

export function searchProvider() {
  return {
    id: 'aiwuk-search',
    available() {
      try { const settings = searchSettings(); return activeEngines(settings).some(engine => usable(engine, settings)); }
      catch { return false; }
    },
    async search(request, signal) {
      signal?.throwIfAborted();
      const limit = request.maxResults === undefined ? 20 : Math.min(20, Math.max(1, request.maxResults));
      const result = await omni('search', { query: request.query, max_results: limit }, { signal });
      signal?.throwIfAborted();
      return { sources: result.results.map(({ url, title, snippet, published }) => ({ url, ...(title ? { title } : {}),
        ...(snippet ? { snippet } : {}), ...(published && !Number.isNaN(Date.parse(published)) ? { publishedAt: new Date(published).toISOString() } : {}) })), truncated: false };
    },
  };
}

export const FETCH_PROVIDER_ID = 'aiwuk-fetch';

/** The fetch provider id the user selected for DSH (`web.fetchProvider` setting or env override), if readable. */
export function selectedFetchProvider(web) {
  try {
    const configured = web?.config?.fetchProvider?.get?.();
    return typeof configured === 'string' && configured ? configured : process.env.DSH_WEB_FETCH_PROVIDER || undefined;
  } catch { return undefined; }
}

/**
 * Native `web_fetch` provider backed by the same engine chain as omni_fetch.
 * It is opt-in: DSH's anonymous `http` fetch provider is always available, and `ctx.web` throws
 * WEB_PROVIDER_AMBIGUOUS when several providers are usable and none is selected. So this provider reports
 * available() only when the user explicitly selected it; unreadable selection fails closed (unavailable).
 */
export function fetchProvider(web) {
  return {
    id: FETCH_PROVIDER_ID,
    available() {
      if (selectedFetchProvider(web) !== FETCH_PROVIDER_ID) return false;
      try { return (searchSettings().config.fetchEngines ?? INTEGRATION_DEFAULTS.search.fetchEngines).length > 0; }
      catch { return false; }
    },
    async fetch(request, signal) {
      signal?.throwIfAborted();
      const result = await omni('fetch', { url: request.url, format: 'markdown' }, { signal });
      signal?.throwIfAborted();
      return { url: result.url || request.url, statusCode: 200, body: { kind: 'text', content: result.content }, truncated: false };
    },
  };
}

function waveSeconds(audio) {
  const data = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  if (data.length < 46 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 16) !== 'WAVEfmt '
    || data.readUInt32LE(16) !== 16 || data.readUInt16LE(20) !== 1 || data.readUInt16LE(22) !== 1
    || data.readUInt32LE(24) !== 16000 || data.readUInt32LE(28) !== 32000 || data.readUInt16LE(32) !== 2
    || data.readUInt16LE(34) !== 16 || data.toString('ascii', 36, 40) !== 'data'
    || data.readUInt32LE(4) !== data.length - 8 || data.readUInt32LE(40) !== data.length - 44 || (data.length - 44) % 2) {
    throw new Error('Audio must be a canonical 16 kHz mono PCM16 WAV recording');
  }
  return (data.length - 44) / 32000;
}

export function speechProvider() {
  return {
    info: { id: 'aiwuk-cloud-stt', name: SPEECH_NAME, location: 'cloud', languages: ['auto', 'en', 'zh'] },
    async transcribe(input, signal) {
      signal?.throwIfAborted();
      const audioSeconds = waveSeconds(input.audio);
      if (input.audio.byteLength > audioSettings().config.maxBytes) throw new Error('Audio exceeds the configured upload size limit');
      const start = performance.now();
      const result = await transcribe({ bytes: input.audio, name: 'recording.wav', language: input.language === 'auto' ? undefined : input.language }, { signal });
      signal?.throwIfAborted();
      return { text: result.text, audioSeconds, inferenceSeconds: (performance.now() - start) / 1000 };
    },
  };
}

export function registerNativeProviders(ctx) {
  for (const [name, method, factory] of [['web', 'registerSearchProvider', searchProvider], ['web', 'registerFetchProvider', fetchProvider], ['speechToText', 'register', speechProvider]]) {
    try {
      ctx.inject?.([name], scoped => {
        try {
          const service = scoped[name];
          if (typeof service?.[method] === 'function') scoped.effect(() => service[method](factory(service)));
        } catch (error) { ctx.logger?.warn?.(`omni-search: native provider registration failed: ${error?.message ?? error}`); }
      });
    } catch (error) { ctx.logger?.warn?.(`omni-search: native provider injection failed: ${error?.message ?? error}`); }
  }
}
