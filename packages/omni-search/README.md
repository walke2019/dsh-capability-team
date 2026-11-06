# AIWUK Search for DSH

Part of [AIWUK Team for DSH](https://github.com/walke2019/dsh-capability-team) ([main README](../../README.md)); usable on its own in any session.

```bash
dsh plugin add @aiwuk/search
```

Requires DSH >= 0.2.2-rc.1 (below 0.3.0) and Node.js >= 22. Configure it on the plugin's page under DSH's **Plugins** (see [Settings page](#settings-page)), or through the integrations file, environment variables or the DSH credential store as described below.

A vendor-neutral, profile-wide Host-only bundle (`@aiwuk/search`, patch id `omni-search`) exposing multi-engine web search and page fetch, plus user-approved audio transcription, to ordinary sessions, other presets, subagents, and teams:

| Tool | Purpose |
|---|---|
| `omni_search` | Web search across the configured engines, with automatic failover |
| `omni_fetch` | Read the main content of one public web page |
| `omni_search_providers` | List the channels of a custom gateway (only when the `custom` engine is active and `search.providersPath` is set) |
| `omni_transcribe` / `omni_transcribe_status` | Speech to text through an OpenAI-compatible transcription endpoint |

The names deliberately differ from DSH's built-in `web_search` / `web_fetch`. The plugin makes no model call. Its only UI is the settings page below; the only HTTP route it adds is the values-free, owner-only managed-config manifest `GET /api/aiwuk.managed-config.search`.

## Zero configuration

- **Fetch works with no key at all**: the default fetch engine is [Jina Reader](https://r.jina.ai/) (`fetchEngines: ["jina"]`). Setting `JINA_API_KEY` only raises its rate limit.
- **Search needs one engine**: set any one of `TAVILY_API_KEY`, `BRAVE_API_KEY`, or `SEARXNG_URL` (a self-hosted SearXNG, e.g. `http://127.0.0.1:8888`), or configure a custom gateway. Without one, `omni_search` reports exactly which variables to set; it never pretends to search.

## Engines

`search.engines` is an ordered list from `tavily`, `brave`, `searxng`, `custom`. When it is omitted (auto), every configured engine is used in that order. On availability failures — timeout, network error, HTTP 401/403/404, 429, 5xx, or a 200 without results — the next engine is tried; on invalid input (HTTP 400/413/422, bad arguments) it is not. Upstream error bodies and keys are never echoed.

| Engine | Request | Key (DSH credential or env) | Other settings |
|---|---|---|---|
| `tavily` | `POST https://api.tavily.com/search` (`search_type: news` → `topic: news`) | `TAVILY_API_KEY` (field `tavilyKeyEnv`), sent as Bearer | — |
| `brave` | `GET https://api.search.brave.com/res/v1/web/search` (news → `/res/v1/news/search`) | `BRAVE_API_KEY` (field `braveKeyEnv`), sent as `X-Subscription-Token` | — |
| `searxng` | `GET {searxngUrl}/search?q=…&format=json` (news → `categories=news`, code → `categories=it`) | optional `SEARXNG_API_KEY` (field `searxngKeyEnv`), sent as Bearer | `searxngUrl` or env `SEARXNG_URL`; https, or plain http only for 127.0.0.1 / localhost / [::1] |
| `custom` | Any gateway speaking the generic protocol: `POST {baseUrl}{searchPath}`, `POST {baseUrl}{fetchPath}`, `GET {baseUrl}{providersPath}` | `OMNI_SEARCH_API_KEY` (field `apiKeyEnv`), sent as Bearer | `baseUrl` or env `OMNI_SEARCH_BASE_URL`; `searchPath`, `fetchPath`, `providersPath`, `headers`, `providers`, `fetchProviders`, `timeoutMs`, `fetchTimeoutMs` |

Fetch engines: `search.fetchEngines` is an ordered list from `jina`, `tavily`, `custom`, default `["jina"]`.

| Fetch engine | Request | Key |
|---|---|---|
| `jina` | `GET https://r.jina.ai/{url}` requesting markdown (`X-Return-Format`) | optional `JINA_API_KEY` (field `jinaKeyEnv`) |
| `tavily` | `POST https://api.tavily.com/extract` | `TAVILY_API_KEY` |
| `custom` | `POST {baseUrl}{fetchPath}` | `OMNI_SEARCH_API_KEY` |

The `provider` tool argument exists only when the active engine list includes `custom` (for fetch: when `fetchEngines` includes `custom`); a configured `providers` / `fetchProviders` list becomes its enum. Direct engines use `engineTimeoutMs` (default 30 s); the custom gateway keeps `timeoutMs` / `fetchTimeoutMs` (default 120 s).

Normalized results:

```text
omni_search -> { engine, results: [{ title, url, snippet, published? }] }
omni_fetch  -> { engine, url, title?, content }
```

Every request uses `redirect: 'error'`, a per-request timeout and a 1 MB response cap; a response that contains the active key is blocked. `omni_fetch` only accepts public http(s) pages: loopback, private, link-local and `.local` targets are rejected before any request.

## Build and enable from source

The `dsh plugin add` command above is the normal path. To run from a checkout instead:

1. Run `node packages/omni-search/scripts/build-shared.mjs` from the repository root. Shared adapters and their relative dependency closure are copied verbatim with SHA-256 hashes. Do not edit generated copies; rebuild after changing original sources.
2. Install this package directory or a package-manager `pack` archive using DSH's native plugin manager as a **profile bundle**, never inside a preset. The patch inserts `omni-search` once.
3. Use the manager's `list_bundles` / `list_plugins` to inspect actual ids and activation state. Enable those ids via the current `set_bundle` / `set_plugin` schema. Resolve `failed` / `overridden` and restart when `restart-required`; replacing installed JS also needs restart.
4. Verify the tools exist in a normal session. A missing engine, endpoint, key, or optional status/providers path returns a clear configuration error, not simulated success. A configured gateway does not prove its upstream providers work.
5. Disable the bundle/plugin or set `enabled: false` to remove all tools. A second instance in the same profile is rejected. The only activation option is `enabled`; endpoints and secrets cannot be supplied as activation config.

The capability-team plugin does not register these tools. Its existing capability `search` switch still denies these external-service tools when false. A team without this bundle must report the unavailable tools rather than pretend to search. Non-team sessions are not subject to that team policy.

## Settings page

Open the plugin on DSH's **Plugins** page. It edits the live (volatile) settings and shows the integration settings:

- **Secrets are write-only.** The six keys (`OMNI_SEARCH_API_KEY`, `TAVILY_API_KEY`, `BRAVE_API_KEY`, `SEARXNG_API_KEY`, `JINA_API_KEY`, `OMNI_AUDIO_API_KEY`) show a state only (Not set / Set (stored) / Set (environment) / Managed by AIWUK Mothership). Set, Replace or Clear a stored value; it is never read back or shown, and the input is cleared after each save. Values go to DSH's credential store (`~/.dsh/.credentials.yaml`, plain YAML, mode 0600). If the state cannot be read the row shows "Could not check" with a Retry button.
- **Mothership lock badges.** A setting managed by an AIWUK Mothership carries a badge: "Managed by AIWUK Mothership" (locked, read-only; change it in the Mothership) or "Default from Mothership" (editable; your value wins). The lock is a policy signal, not a security boundary on the machine.
- **Web-search provider toggle.** "Use AIWUK Search for DSH web search" sets `searchProvider: aiwuk-search` on DSH's `web` entry (`cordis.patch.yml`), so DSH's native `web_search` uses this plugin. Turning it off removes that setting and restores DSH's default. The row shows the current provider. Without a selection DSH picks a provider only when exactly one is usable, otherwise it reports `WEB_PROVIDER_AMBIGUOUS`; the environment variable `DSH_WEB_SEARCH_PROVIDER` is the equivalent setting.

## Configuration files and environment

Configuration reads `integrations.json` under `CAPABILITY_TEAM_HOME`, otherwise `~/.dsh/capability-team-themes/` (`%USERPROFILE%/.dsh/capability-team-themes/` on Windows). The document retains its established envelope:

```json
{
  "revision": 1,
  "integrations": {
    "search": {
      "engines": ["brave", "searxng", "custom"],
      "fetchEngines": ["jina", "custom"],
      "searxngUrl": "http://127.0.0.1:8888",
      "baseUrl": "https://gateway.example.com",
      "apiKeyEnv": "OMNI_SEARCH_API_KEY",
      "searchPath": "/v1/search",
      "fetchPath": "/v1/web/fetch",
      "providersPath": "/v1/providers"
    },
    "audio": {
      "baseUrl": "https://gateway.example.com",
      "apiKeyEnv": "OMNI_AUDIO_API_KEY",
      "path": "/v1/audio/transcriptions",
      "statusPath": "/health"
    }
  }
}
```

Only search/audio are used by this bundle. Embedding and memory configuration belong to [Capability Memory](../global-memory/README.md); no configuration is edited here. The shared reader accepts their fields for file compatibility, but this bundle never invokes embedding or memory services.

| Environment variable | Meaning |
|---|---|
| `TAVILY_API_KEY` / `BRAVE_API_KEY` / `SEARXNG_API_KEY` / `JINA_API_KEY` | Engine keys (default names; rename with `tavilyKeyEnv`, `braveKeyEnv`, `searxngKeyEnv`, `jinaKeyEnv`) |
| `SEARXNG_URL` | SearXNG instance address (overrides `search.searxngUrl`) |
| `OMNI_SEARCH_BASE_URL` / `OMNI_SEARCH_API_KEY` | Custom gateway address and key |
| `OMNI_SEARCH_ENGINES` / `OMNI_FETCH_ENGINES` | Comma-separated engine order (overrides `search.engines` / `search.fetchEngines`), e.g. `brave,custom` |
| `OMNI_SEARCH_PROVIDERS_PATH` | Custom gateway providers path (overrides `search.providersPath`) |
| `OMNI_AUDIO_BASE_URL` / `OMNI_AUDIO_API_KEY` | Transcription endpoint address and key |

Every key name is a DSH credential reference first (keys saved in DSH Settings are looked up through the credential store), with the same-named Host environment variable as fallback. Keys are never written to config or tool arguments. Secrets are written only through the settings page (DSH's credential store); the integrations file is never written by the plugin. Configuration is read on each request; tool schemas (the `provider` argument and the providers tool) are built at activation and rebuilt once the credential store has been read, so reload/restart after changing the engine or provider lists in the file or environment.

### Settings from the DSH credential store

Each override variable in the table above (not only the keys) may also be stored as a DSH credential with the same name, for example when a fleet manager pushes settings to every client. A credential wins over the same-named environment variable; an invalid value is ignored, and values are never logged. Override names: `OMNI_SEARCH_BASE_URL`, `OMNI_SEARCH_ENGINES`, `OMNI_FETCH_ENGINES`, `OMNI_SEARCH_PROVIDERS_PATH`, `SEARXNG_URL`, `OMNI_AUDIO_BASE_URL` (plus the memory names listed in the [Capability Memory README](../global-memory/README.md)). The source of such a value is shown as `credential:<NAME>`.

Breaking changes: the former `cpa_*` tool names and `CPA_SEARCH_*` / `CPA_AUDIO_*` variables are no longer recognized, and since 1.0.0 the package is published as `@aiwuk/search` (formerly `dsh-omni-search`, and before that `@local/dsh-omni-search`; patch id `omni-search` and the `omni_*` tools unchanged; see [docs/migration-aiwuk.md](../../docs/migration-aiwuk.md)). See the [CHANGELOG](../../CHANGELOG.md).

The custom gateway and audio endpoint must be credential-free https URLs. Never put credentials in headers or URLs in the JSON file. Missing keys explicitly fail; no paid-model fallback is attempted.

## Native providers

Use the DSH Plugins page to enable or disable the plugin; the legacy `enabled` activation setting is not volatile.

When DSH exposes its optional web and experimental speech-to-text services, the plugin registers the `aiwuk-search` and `aiwuk-cloud-stt` providers. Select the provider with the toggle on this plugin's settings page (or in DSH's own settings); the plugin never changes the selection by itself. Search uses the same engine order and credentials as the tools. The cloud speech provider sends recordings to the configured audio gateway and relies on the host's consent flow; the legacy `omni_transcribe` tool continues to require its own per-file approval.

A native fetch provider is deferred: the extraction engines do not reliably expose the target response status, body kind and truncation. The existing `omni_fetch` tool remains available, as does DSH's own native web fetch provider.

## Audio consent and privacy

Every transcription asks DSH's native question UI for approval of that exact resolved file path and size. File bytes are read only after approval; declining prevents read/upload. The already-open handle is size/type checked, preventing path substitution between validation and reading. Relative paths use the current working directory. Native tool sandbox/permission guards remain authoritative.

Only after approval are bytes uploaded as multipart to the configured gateway. This sends audio, optional language, and the explicitly supplied terminology prompt to that service. Do not provide secrets or sensitive audio without permission. Responses containing the active key are blocked; HTTP error bodies are not echoed. Gateway health is not upstream transcription health.

## Verify

```text
node --test tests/*.test.mjs
node --test tests/global-memory/*.test.mjs
node --test tests/omni-search/*.test.mjs
node scripts/check.mjs syntax
node scripts/check.mjs package
node scripts/check.mjs file-limits
```

Tests mock host/network and use temporary files; real GUI activation, gateway upstream success, and production audio are not claimed.
