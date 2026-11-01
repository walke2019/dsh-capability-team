# CPA Tools for DSH

A profile-wide Host-only bundle exposing `cpa_search`, `cpa_web_fetch`, `cpa_search_providers`, `cpa_transcribe`, and `cpa_transcribe_status` to ordinary sessions, other presets, subagents, and teams. No UI, client entry, model call, or configuration HTTP endpoint is installed.

## Build and enable

1. Run `node packages/cpa-tools/scripts/build-shared.mjs` from the repository root. Shared adapters and their relative dependency closure are copied verbatim with SHA-256 hashes. Do not edit generated copies; rebuild after changing original sources.
2. Install this package directory or a package-manager `pack` archive using DSH's native plugin manager as a **profile bundle**, never inside a preset. The patch inserts `cpa-tools` once.
3. Use the manager's `list_bundles` / `list_plugins` to inspect actual ids and activation state. Enable those ids via the current `set_bundle` / `set_plugin` schema. Resolve `failed` / `overridden` and restart when `restart-required`; replacing installed JS also needs restart.
4. Verify the five tools exist in a normal session. Missing endpoint, key, or optional status/providers path returns a clear configuration error, not simulated success. Actual gateway configuration does not prove its upstream providers work.
5. Disable the bundle/plugin or set `enabled: false` to remove all tools. A second instance in the same profile is rejected. The only activation option is `enabled`; endpoints and secrets cannot be supplied as activation config.

The capability-team plugin no longer registers CPA tools. Its existing capability `search` switch still denies these external-service tools when false. A team with missing CPA Tools must report the unavailable tools rather than pretend to search. Non-team sessions are not subject to that team policy.

## Read-only configuration

Configuration reads `integrations.json` under `CAPABILITY_TEAM_HOME`, otherwise the existing user `.dsh/capability-team-themes` directory. The document retains its established envelope:

```json
{
  "revision": 1,
  "integrations": {
    "search": {
      "baseUrl": "https://gateway.example.com",
      "apiKeyEnv": "CPA_SEARCH_API_KEY",
      "searchPath": "/v1/search",
      "fetchPath": "/v1/web/fetch",
      "providersPath": "/v1/providers"
    },
    "audio": {
      "baseUrl": "https://gateway.example.com",
      "apiKeyEnv": "CPA_AUDIO_API_KEY",
      "path": "/v1/audio/transcriptions",
      "statusPath": "/health"
    }
  }
}
```

Only search/audio are used by this bundle. Embedding and OpenViking configuration belong to Global Memory; no configuration is edited here. The shared reader accepts their existing fields for file compatibility, but this bundle never invokes embedding or memory services.

Environment overrides: `CPA_SEARCH_BASE_URL`, `CPA_AUDIO_BASE_URL`; the `apiKeyEnv` fields name DSH credential references, with same-named Host environment variables as fallback. Keys are never written to config or tool arguments. No plugin configuration layer or HTTP writer exists. Configuration changes are read on requests; provider schema enums are captured at activation, so reload/restart after changing provider lists.

HTTPS credential-free endpoints are required. Search providers/fetch providers, paths, headers, timeouts, audio model and upload size use the shared validated configuration contract. Never put credentials in headers or URLs in the JSON file. Missing keys explicitly fail; no paid-model or alternate-search fallback is attempted.

## Audio consent and privacy

Every transcription asks DSH's native question UI for approval of that exact resolved file path and size. File bytes are read only after approval; declining prevents read/upload. The already-open handle is size/type checked, preventing path substitution between validation and reading. Relative paths use the current working directory. Native tool sandbox/permission guards remain authoritative.

Only after approval are bytes uploaded as multipart to the configured gateway. This sends audio, optional language, and the explicitly supplied terminology prompt to that service. Do not provide secrets or sensitive audio without permission. Responses containing the active key are blocked; HTTP error bodies are not echoed. Gateway health is not upstream transcription health.

## Verify

```text
node --test tests/*.test.mjs
node --test tests/global-memory/*.test.mjs
node --test tests/cpa-tools/*.test.mjs
node scripts/check.mjs syntax
node scripts/check.mjs package
node scripts/check.mjs file-limits
```

Tests mock host/network and use temporary files; real GUI activation, gateway upstream success, and production audio are not claimed.
