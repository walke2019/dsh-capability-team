# Configuration reference

This guide covers project configuration, model assignment, permissions, collaboration policies, and optional integrations. Most settings can be inspected with `capability_team_read` and changed with `capability_team_save` or the team workbench.

## Environment variables

Set variables in the DSH host process environment. Restart DSH after changing them.

| Variable | Purpose |
|---|---|
| `TAVILY_API_KEY` | Key for the `tavily` search engine (also used by the `tavily` fetch engine). |
| `BRAVE_API_KEY` | Key for the `brave` search engine. |
| `SEARXNG_URL` | SearXNG instance for the `searxng` engine; https, or plain http only on 127.0.0.1 / localhost / [::1]. Optional key `SEARXNG_API_KEY`. |
| `JINA_API_KEY` | Optional key for the default `jina` fetch engine (fetch works without it). |
| `OMNI_SEARCH_BASE_URL` / `OMNI_SEARCH_API_KEY` | Address and key of a `custom` search/fetch gateway. Example: `https://gateway.example.com`. |
| `OMNI_AUDIO_BASE_URL` / `OMNI_AUDIO_API_KEY` | Transcription endpoint address and key. |
| `EMBEDDING_BASE_URL` | Optional OpenAI-compatible embeddings endpoint (legacy fallback `CPA_EMBED_BASE_URL`). |
| `EMBEDDING_MODEL` | Optional embeddings model (legacy fallback `CPA_EMBED_MODEL`). |
| `EMBEDDING_DIMENSIONS` | Optional vector dimensions (legacy fallback `CPA_EMBED_DIMENSIONS`). |
| `EMBEDDING_API_KEY` | Default credential name for embeddings (legacy fallback `CPA_EMBED_API_KEY`). |
| `OPENVIKING_URL` / `OPENVIKING_API_KEY` | Address and optional key for the `openviking` memory backend. |
| `MEMORY_SHARED_RECALL` | `current` (default) keeps global-memory recall local; `none` also searches the shared backend across projects and instances. Overrides `integrations.memory.sharedRecall`. |
| `CAPABILITY_TEAM_HOME` | Team configuration storage; defaults to `~/.dsh/capability-team-themes`. |
| `CAPABILITY_TEAM_OPENCODE_EXECUTABLE` | Optional OpenCode executable path; otherwise discovered from `PATH`. |
| `CAPABILITY_TEAM_OPENCODE_MODELS` | Optional OpenCode model catalog path. |

Integration settings are read-only; provide them through the integrations file, host environment variables, or DSH credential store as described below. Never put literal key values in configuration.

## Defaults: capabilities and roles

The initial `seed` in `config.js` contains tiers, capabilities and role bindings:

- **Tiers** map a tier to eligible model IDs; the runtime catalog populates matching defaults.
- **Capabilities** define duty, required tier, vendor preference, search access, and optional model, fallback, budget, and permission policies.
- **Roles** bind stable internal IDs to display names and capabilities. Display names are presentation only.

The default capability set includes orchestrator, technical director, backend, frontend, research, writer, and QA. The lead must be bound to orchestrator; display names must be unique; unknown fields are rejected. Any catalog model that is not disabled can be assigned: a model the automatic match left ungraded is recorded in the tier of the capability it is assigned to. Two limits apply: a model graded into another tier cannot be used across tiers, and non-chat models and free variants cannot be role routes unless explicitly listed in `tiers`. A saved route does not break when the catalog changes: if a model is regraded, the route keeps working and is listed in `effective.tierDrift` from `capability_team_read`, while new or changed routes are still checked by these rules. `whenToUse` describes when a role should be assigned.

## Automatic model matching

The matcher reads providers and model IDs registered in DSH; it does not require a particular provider name. It normalizes aliases and gateway prefixes, then excludes non-chat models, models lacking team-member tool support, free/trial variants, and versions below configured vendor floors.

Tier rules use model naming and vendor-specific generation patterns. Matching order favors generation, capability vendor preference, version, and provider registration order. Global model exclusions apply before and during routing. Up to three same-tier fallbacks are selected, preferring the same model through another provider and then alternatives from other vendors. The matcher never silently downgrades: if no eligible tier exists, the capability remains unassigned and requests fail closed. Unknown model IDs are reported rather than guessed.

Provider catalog changes are picked up on subsequent requests. Explicit project configuration takes precedence over generated assignments. `capability_team_read` returns the `autoMatch` report, including matched, upgraded, below-tier, unassigned, and unrecognized models.

## Conversational configuration and templates

The role/theme workflow supports reading the effective configuration, reading exact registered model IDs, saving changes, and exporting or importing portable templates. A save validates the merged configuration and checks model IDs against the DSH catalog. DSH’s native confirmation dialog displays the diff; changes are written only after the user confirms.

In patches, objects merge, `null` restores a default, and `false` removes a setting. Template format is `capability-team-template` version 1. Templates carry roles, duties, capabilities, tiers, preferences, permissions, budgets, plan-first, workflow and failover policy, but provider-specific models, fallbacks and long-context routes remain catalog-specific. Import replaces role definitions, validates, checks catalog values, and uses the same confirmation flow.

## Permissions by role

A capability may set an `access` policy:

| Field | Meaning |
|---|---|
| `deny` | Tool names to block; a trailing `*` matches a name prefix. |
| `editPaths` | Project-relative file globs allowed for write/edit tools; an empty list denies all edits. |
| `shell` | `false` blocks shell and terminal tools. Pair with path limits where needed. |
| `preset` | Official DSH permission preset, such as `read-only`, applied to that member. |

By default, research uses the official read-only sandbox; writer is limited to documentation paths and cannot run commands. Other roles are unrestricted unless configured. Paths outside the project or paths that cannot be resolved are rejected. Configure via `capabilities.<id>.access`; it is replaced as a whole, and `null` removes it.

## Usage and budgets

The Usage view summarizes each member’s tokens, cache reads, steps and timing using DSH projections. Budget tokens are uncached input, cache writes and output; cached reads are shown separately. `capabilities.<id>.maxTokens` sets a per-member-session budget. At the limit, routing blocks the request and does not try another model. Enforcement depends on host token-meter support. Counts are tokens, not money, because DSH does not provide model prices.

## Plan-first teammates

Set `planFirst` on a capability to require teammate plan approval before execution. The teammate submits with `capability_submit_plan`; the lead approves or returns it with feedback using `capability_review_plan`. Until approval, execution tools are blocked. A new assignment requires a new approval, and plans must be resubmitted after DSH restarts. Disabled by default.

## Dispatch workflow

The lead uses `capability_dispatch_plan` to classify requests as `delegate`, `free`, or `direct`. Delegation requires roles, concrete tasks, and acceptance criteria; free work is limited to configured free models and permitted tools; direct work is capped by `directBudget`. When the user explicitly asks the lead to do the work itself, the lead passes `userRequested: true` and the user sees an allow or refuse card, with DSH's question box as the fallback. Allowing removes the cap until the user's next message; file rules and permissions still apply. The field alone only triggers the question and never lifts the cap.

| Workflow field | Meaning |
|---|---|
| `mode` | `enforce`, `remind`, or `off`. |
| `analysisBudget` | Read-only analysis allowance before planning. |
| `directBudget` | Maximum lead executions in direct mode, unless the user allowed lifting it for the current turn on the confirmation card. |
| `freeTools` / `freeModels` | Free-task tool level and model ordering. |
| `confirmDispatch` | Dispatch confirmation policy: `on-change`, `always`, or `never`. |
| `enforceWriteScopes` | Refuse changes beyond active task write scopes. |
| `rotation` / `tokens` | Session rotation and context management policies. |

Analysis and coordination tools are separately defined by workflow policy. A changed user request requires a new dispatch plan.

## Dispatch confirmation and board workflow

When enabled, dispatch confirmation shows each role’s task, primary model and up to three fallbacks. A route can be task-only or saved as a project default. The lead cannot create or message teammates until confirmation. Clients without the card use DSH’s native question dialog as a fallback.

Dispatch subtasks may define `write_scopes` and `blocked_by`. The native task board controls dependencies and claiming. Ready tasks are assigned to existing teammates; blocked tasks wait for prerequisites. With `enforceWriteScopes` enabled, edits outside a held task’s scopes are rejected.

## Retries, same-tier failover, and long context

Availability errors may trigger provider retries, configured extra retries, and then the capability’s same-tier fallbacks. Credential or quota errors are not retried on the same provider. Failed routes enter cooldown and return to the primary after recovery. Context overflow and content refusals do not trigger failover.

`longContext: { thresholdTokens, provider, model }` selects a same-tier route when projected context reaches the threshold and switches back below 80% of it. The primary and fallbacks remain available for failure recovery. Compaction-summary model selection is configured in DSH itself, not through this plugin.

## Search and free-text channel

Search and web-fetch tools are available only to capabilities with `search: true` (enabled by default for lead and research). Fetch is restricted to public HTTP(S) destinations; private networks, credentials, redirects, and responses containing secrets are rejected. Search results are untrusted and should be checked.

`capability_free_task` uses the local OpenCode executable and catalog. `CAPABILITY_TEAM_OPENCODE_EXECUTABLE` and `CAPABILITY_TEAM_OPENCODE_MODELS` override discovery. Models must be catalog-listed free, non-deprecated, and tool-capable. Quota/auth/model availability failures move to the next configured free model; paid models are never used. Tool levels are `none`, `read`, and `write`; shell, network, subagents, outside-project paths, and sensitive credential files remain forbidden. At read/write levels project content is sent to the free model’s cloud, so do not include secrets.

## Independent tools and integrations

There is no integrations page or settings UI. Configuration is read-only and can be supplied through `integrations.json`, host environment variables, or the DSH credential store. Install and enable the independent plugins `packages/omni-search` and `packages/global-memory` in the DSH plugin manager (or install their corresponding `.tgz` packages), then restart DSH. The team plugin's memory hub reads the same configuration as `global-memory`.

`omni-search` (`@local/dsh-omni-search`) provides `omni_search`, `omni_fetch`, `omni_search_providers`, `omni_transcribe`, and `omni_transcribe_status` to all sessions without a UI. The names deliberately differ from DSH's built-in `web_search` / `web_fetch`. Team-plugin roles with `search: false` cannot call these five tools. If a tool/plugin is unavailable or disabled, report that truthfully. `global-memory` reads embedding and memory-backend settings.

### Search and fetch engines

`search.engines` is an ordered list from `tavily`, `brave`, `searxng`, `custom`; when omitted (auto), every configured engine is used in that order. Availability failures (timeout, network error, HTTP 401/403/404, 429, 5xx, or an empty 200) fall over to the next engine; invalid input (HTTP 400/413/422) does not. `search.fetchEngines` is an ordered list from `jina`, `tavily`, `custom`, default `["jina"]` (keyless). Direct engines use `engineTimeoutMs` (default 30 s); the custom gateway keeps `timeoutMs` / `fetchTimeoutMs` (default 120 s). Key names can be renamed with `tavilyKeyEnv`, `braveKeyEnv`, `searxngKeyEnv`, `jinaKeyEnv`, and `apiKeyEnv` (custom). The `custom` engine keeps the generic gateway protocol (`baseUrl`, `searchPath`, `fetchPath`, `providersPath`, `headers`, `providers`, `fetchProviders`); the `provider` tool argument exists only when `custom` is active. Zero configuration: fetch works without a key; search needs one engine key or a SearXNG URL. See [packages/omni-search/README.md](../packages/omni-search/README.md) for the per-engine table.

The file is `%USERPROFILE%/.dsh/capability-team-themes/integrations.json`; `CAPABILITY_TEAM_HOME` can override the directory. Example:

```json
{
  "integrations": {
    "search": { "engines": ["tavily", "searxng", "custom"], "fetchEngines": ["jina", "custom"], "searxngUrl": "http://127.0.0.1:8888", "baseUrl": "https://gateway.example.com", "apiKeyEnv": "OMNI_SEARCH_API_KEY" },
    "audio": { "baseUrl": "https://gateway.example.com", "apiKeyEnv": "OMNI_AUDIO_API_KEY" },
    "embeddings": { "baseUrl": "https://gateway.example.com", "apiKeyEnv": "EMBEDDING_API_KEY", "model": "<model>" },
    "memory": { "backend": "openviking", "url": "https://memory.example.com", "apiKeyEnv": "OPENVIKING_API_KEY" }
  }
}
```

Alternatively set the environment variables listed above (`OMNI_SEARCH_BASE_URL`, `SEARXNG_URL`, `OMNI_AUDIO_BASE_URL`, `EMBEDDING_BASE_URL`, `OPENVIKING_URL`, ...) in the DSH host environment; environment values override the file. Secrets belong in the DSH credential store or named environment variables, never as literal configuration values. Every key name is looked up in the DSH credential store first, then the environment. See the plugin READMEs for schemas and details.

### Settings from the DSH credential store

Each single-field override variable may also be stored as a same-named DSH credential (useful when a fleet manager pushes settings to every client, which then needs no local config). A credential wins over the same-named environment variable; invalid values are ignored and never logged; the source is reported as `credential:<NAME>`. Names: `OMNI_SEARCH_BASE_URL`, `OMNI_SEARCH_ENGINES`, `OMNI_FETCH_ENGINES` (comma-separated lists), `OMNI_SEARCH_PROVIDERS_PATH`, `SEARXNG_URL`, `OMNI_AUDIO_BASE_URL`, `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` (legacy `CPA_EMBED_*`), `MEMORY_BACKEND`, `OPENVIKING_URL`, `MEMORY_SHARED_RECALL`. `omni-search` re-registers its search tools when such settings change the schema.

### Migration from cpa-tools

Breaking change: the old names are no longer recognized.

| Old | New |
|---|---|
| `packages/cpa-tools` | `packages/omni-search` (`@local/dsh-omni-search`, patch id `omni-search`) |
| `cpa_search`, `cpa_fetch`, `cpa_search_providers`, `cpa_transcribe`, `cpa_transcribe_status` | `omni_search`, `omni_fetch`, `omni_search_providers`, `omni_transcribe`, `omni_transcribe_status` |
| `CPA_SEARCH_BASE_URL` / `CPA_SEARCH_API_KEY` | `OMNI_SEARCH_BASE_URL` / `OMNI_SEARCH_API_KEY` (the `custom` engine) |
| `CPA_AUDIO_BASE_URL` / `CPA_AUDIO_API_KEY` | `OMNI_AUDIO_BASE_URL` / `OMNI_AUDIO_API_KEY` |
| `CPA_EMBED_*` | `EMBEDDING_*` (legacy names still read when the new one is unset) |

## Session rotation and handoff

Soft rotation reminders trigger at two compactions, 75% context, or 15 reads of the same file. Hard rotation triggers at three compactions, 90% context, or eight turns, for sessions that made progress. Before rotation the teammate sends a handoff; the successor inherits the role’s model, permissions, budget and confirmed route, and open tasks are reassigned. Thresholds are configurable through `workflow.rotation`; disabling it uses `false`.

## Model preferences and task control

Confirmed dispatch choices are remembered per capability. Repeated choices can be preselected but still require confirmation; recent route failures suppress or demote a model. The lead can inspect or clear preferences with `capability_model_prefs`.

The workbench’s Task control shows estimated/used steps, temporary model leases and recent actions. Temporary models come from the backend catalog and require confirmation; leases can be restored or ended. Conflicting updates are not retried automatically. Usage also reports average input per step and cache-read share, and may suggest rotation for very large contexts.

## Memory hub and shared backends

The local memory hub stores project-scoped notes, decisions, pitfalls and handoffs. New tasks trigger recall; `capability_memory_search` searches on demand. Ranking combines BM25 and optional vector similarity with recency/use weighting. Without embeddings it falls back to full-text search. Credentials are redacted before storage; stale and superseded records are removed during compaction.

The local store is always the source of truth. `integrations.memory.backend` selects a pluggable shared backend (`memory-backends.js`): `local` (default) keeps memories on this machine only; `openviking` mirrors non-session memories to an OpenViking server (`memory.url` / `OPENVIKING_URL`, optional `account`, `user`). Remote endpoints must use HTTPS; local HTTP is permitted only on the same machine. Pending writes queue durably during outages and local search remains available. Use `OPENVIKING_API_KEY` as a credential variable name, never as a literal value in configuration. A new backend is one `memory-<id>.js` file plus one line in `MEMORY_BACKEND_REGISTRY` and the id in `MEMORY_BACKENDS`; see [packages/global-memory/README.md](../packages/global-memory/README.md).

### Embeddings API shape

The memory hub uses an OpenAI-compatible endpoint, default path `/v1/embeddings`:

```http
POST https://gateway.example.com/v1/embeddings
Authorization: Bearer <value from the variable named by apiKeyEnv>
Content-Type: application/json

{"model":"<model>","input":["text 1","text 2"]}
```

Optional `provider`, `dimensions`, and query/passage task fields are sent only when configured. Responses must contain a non-empty embedding vector for each input. Vectors are associated with model and dimensions; changing either causes old vectors to be excluded and re-embedded.

## Team overview and model management

Choose the preset for a new session, then open the right panel’s Team overview. Live member status, task board, selected models, token usage and timing come from DSH session projections. Roles/settings and request details are read from the plugin status endpoint on initial display, after a successful configuration change, or when refreshed manually. The panel can remain beside chat and does not poll continuously.
