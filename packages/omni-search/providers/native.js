import { activeEngines, omni, searchSettings } from '../shared/search.js';
import { transcribe, audioSettings } from '../shared/transcribe.js';

// TODO: derive this name from the shared brand constants after the brand package lands.
const SPEECH_NAME = 'AIWUK Cloud STT';
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
  for (const [name, method, factory] of [['web', 'registerSearchProvider', searchProvider], ['speechToText', 'register', speechProvider]]) {
    try {
      ctx.inject?.([name], scoped => {
        try {
          const service = scoped[name];
          if (typeof service?.[method] === 'function') scoped.effect(() => service[method](factory()));
        } catch (error) { ctx.logger?.warn?.(`omni-search: native provider registration failed: ${error?.message ?? error}`); }
      });
    } catch (error) { ctx.logger?.warn?.(`omni-search: native provider injection failed: ${error?.message ?? error}`); }
  }
}
