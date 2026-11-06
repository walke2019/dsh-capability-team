# AIWUK Memory for DSH

[![npm](https://img.shields.io/npm/v/@aiwuk/memory.svg)](https://www.npmjs.com/package/@aiwuk/memory)

Part of [AIWUK Team for DSH](https://github.com/walke2019/dsh-capability-team) ([main README](../../README.md)); usable on its own in any session.

```bash
dsh plugin add @aiwuk/memory
```

Requires DSH >= 0.2.2-rc.1 (below 0.3.0) and Node.js >= 22.

A profile-wide, Host-only bundle (`@aiwuk/memory`, patch id `global-memory`) providing `memory_search`, `memory_write`, and bounded automatic recall. It does not create an agent preset or automatic transcript ingestion. Memory is local by default; OpenAI-compatible embeddings and an OpenViking shared backend are optional. A settings form on DSH's Plugins page is coming in this release; until then, use the configuration described below.

Since 1.0.0 the package is published as `@aiwuk/memory` (formerly `dsh-capability-memory`, and before that `@local/dsh-global-memory`); the patch id `global-memory`, the tools and the credential names are unchanged. See [docs/migration-aiwuk.md](../../docs/migration-aiwuk.md) and the [CHANGELOG](../../CHANGELOG.md).

## Build and enable from source

The `dsh plugin add` command above is the normal path. To run from a checkout instead:

1. From the repository root run `node packages/global-memory/scripts/build-shared.mjs`. This copies the original shared dependency closure verbatim and records SHA-256 hashes. Never edit generated `shared/` copies: change their original sources through the appropriate project task, then rebuild.
2. Optionally create an archive with your package manager's `pack` command inside this package. No install script or external service is required for local text search.
3. In DSH's native plugin manager install this package directory or its archive as a **profile bundle**, not under an agent preset. The bundle patch inserts the unique `global-memory` Host plugin.
4. Inspect the actual bundle/plugin ids with the native manager's `list_bundles` / `list_plugins`. Enable the returned id with `set_bundle` / `set_plugin` using that tool's current schema. Do not manually rewrite the profile or install into the DSH host with pnpm.
5. If activation is `failed`, inspect the activation error; resolve `overridden` activation conflicts; restart for `restart-required`. Restart after replacing an installed JS package. Begin a new user task to trigger recall (hot reload never replays history).
6. Verify a non-team session has both memory tools. Explicitly write a harmless project note, then search it. A later new task can recall it. Capability-team lead/member/rotation sessions must have only their existing team tools and no global-memory context.

Only one instance may run per profile. Disable the bundle, plugin, or set `enabled: false` to stop it. No client watcher/rebuild is needed.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| enabled | true | Install tools and recall |
| autoRecall | true | Recall on a changed user task; tools remain when false |
| injectChars | 2400 | Total dynamic block budget, including its title (200–6000) |
| recallK | 6 | Result limit (1–20) |
| recallTimeoutMs | 2000 | Total automatic recall budget (100–10000 ms) |
| sharedRecall | true | Permit shared search subject to project filter |
| sharedProjectFilter | null | Unset follows the deployment setting `integrations.memory.sharedRecall` / `MEMORY_SHARED_RECALL` (default `current`); set `current` or `none` to pin it for this profile |
| syncWrites | true | Queue explicit non-session writes when the shared backend is enabled |

Unknown configuration fields are rejected. The embedding and shared-backend settings use the existing integrations file/environment resolution and DSH credential references. There are no credentials or real service endpoints in this package. Credential service absence falls back to environment resolution. Enabling the bundle does not prove backend health or completed remote ingestion.

### Zero configuration

With no integrations configured, memory is fully local: notes are stored under the DSH capability-team home (`~/.dsh/capability-team-themes/`, or `CAPABILITY_TEAM_HOME`), searched with full-text (BM25-style) ranking, and nothing leaves the machine. Embeddings and a shared backend are optional upgrades.

### Optional embeddings (any OpenAI-compatible endpoint)

Set these in the environment (or the `embeddings` section of `integrations.json`). Keys can also be saved in DSH Settings → credentials under the same name.

| Variable | Meaning |
| --- | --- |
| `EMBEDDING_BASE_URL` | Endpoint base, without the path (default path `/v1/embeddings`) |
| `EMBEDDING_API_KEY` | Bearer key (name configurable via `embeddings.apiKeyEnv`) |
| `EMBEDDING_MODEL` | Model id |
| `EMBEDDING_DIMENSIONS` | Optional output dimensions, for models that accept it |

Legacy `CPA_EMBED_*` names are still read when the matching `EMBEDDING_*` variable is unset. Vectors are tagged by `model@dimensions`; changing either re-embeds lazily and never mixes vector spaces.

| Provider | `EMBEDDING_BASE_URL` | `EMBEDDING_MODEL` (example) |
| --- | --- | --- |
| OpenAI (or an OpenAI-compatible proxy) | `https://openai.example.com` | `text-embedding-3-small` |
| Jina (or a Jina-backed gateway) | `https://jina.example.com` | `jina-embeddings-v3` (optionally set `embeddings.queryTask`/`passageTask`) |
| vLLM / any gateway | `https://gateway.example.com` | the served model name |
| Ollama (behind an HTTPS front, see below) | `https://localhost:11443` | `nomic-embed-text` |

Use your provider's documented base URL in place of the `example.com` placeholders.

The embeddings `baseUrl` must currently be `https`; a local Ollama or vLLM server on `http://localhost` needs an HTTPS front (for example a local reverse proxy) until plain-http loopback is accepted for embeddings. Embedding failures always fall back to text search.

### Shared backends

`integrations.memory.backend` selects where non-session memories are mirrored as shared long-term memory. The local store always remains the source of truth.

| Backend | Config | Behaviour |
| --- | --- | --- |
| `local` (default) | none | No mirroring; shared recall returns nothing |
| `openviking` | `memory.url` / `OPENVIKING_URL` (https, or http on loopback), optional key `OPENVIKING_API_KEY`, `account`, `user` | Writes are queued durably and committed in batches; recall merges the server's context search. A down server never blocks a member |

Each caller labels what it sends (the team plugin as its team, this package as global memory) and keeps its own queue file per backend. `MEMORY_BACKEND` overrides `memory.backend` (`local` or `openviking`).

`memory.sharedRecall` decides whether this package's search and automatic recall query the shared backend: `current` (default) stays local, `none` searches the whole backend account so a memory written on one instance is found on another. `MEMORY_SHARED_RECALL` overrides it. It is read on every search, so a pushed credential applies without a reload. A plugin `sharedProjectFilter` or a call's `shared_project_filter` still wins.

### Settings from the DSH credential store

Every override variable may also be stored as a same-named DSH credential, for example when a fleet manager pushes settings to every client, so a client works with zero local config. A credential wins over the same-named environment variable; invalid values are ignored and never logged. Names: `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` (legacy `CPA_EMBED_*` equivalents), `MEMORY_BACKEND`, `OPENVIKING_URL`, `MEMORY_SHARED_RECALL`, plus the keys `EMBEDDING_API_KEY` and `OPENVIKING_API_KEY`. Credentials are re-read on start and before each embedding/backend request.

### How to add a backend

1. Create `memory-<id>.js` at the repository root exporting a factory `create<Id>(options)` that returns the interface documented at the top of `memory-backends.js`: `name`, `enabled`, `lastError`, `enqueue(memory, who)`, `revoke(memories)`, `recall(query, limit)`, `flush()`, `status()`, `pending()`. `options` carries `settings`, `queuePath`, `label`, `fetcher`, `now`, `schedule` and `warn`.
2. Add one registry line (and its import) to `MEMORY_BACKEND_REGISTRY` in `memory-backends.js`.
3. Accept the id in `MEMORY_BACKENDS` (`integrations-config.js`), add tests with a mocked `fetcher`, then rebuild `shared/` with `node packages/global-memory/scripts/build-shared.mjs`.

## Privacy and semantics

- Explicitly save short reusable conclusions only; never credentials, sensitive data, or full conversations. Redaction is defense in depth, not permission to store secrets.
- Default writes are project-scoped. `global` is explicitly cross-project. There is no role write scope.
- Session notes are local only: never embedded, enqueued, revoked remotely, or backfilled. Each agent id owns its session notes; children do not inherit them. Session-only search never sends its query to a remote service.
- Other searches send only the redacted query for optional embedding. Non-session explicit writes may send the redacted passage and project identity to configured services. Existing shared-store session records written by other plugins are not migrated or re-embedded by this plugin.
- The current shared backends (OpenViking) have no trustworthy project metadata. Therefore `current` never calls shared recall and reports `project-filter-unavailable`, preserving local search. `none` is an explicit opt-in to cross-project shared search, not an authorization mechanism. Text that looks like a project label is not trusted metadata.
- Project cwd is pinned on first use. Missing cwd permits only session/global writes and searches; project writes fail clearly.
- Embedding/shared failures fall back to text/local search. Queuing is not remote completion: `queued` means persisted locally; `saved: true` remains true on a later sync failure with `syncWarning`. The global-memory queue is separate from the team's queue.
- Automatic context is optional, reference-only, and bounded. Only the existing package context placeholder is replaced; full-prompt/suppression decisions are respected. Tool writes/searches do not mutate the current task's cached block. New tasks clear stale results; timeouts/abort/late generations cannot commit old results.
- Capability-team sessions completely yield to the existing team plugin. Other presets, teams, and ordinary subagents can use this bundle.

## Verification

From the repository root:

```text
node --test tests/global-memory/*.test.mjs
node --test tests/*.test.mjs
node scripts/check.mjs syntax
node scripts/check.mjs package
```

The root package's test script includes both suites. Tests use temporary local stores and mocked network/host services; no paid-model or production backend probe is performed. Live GUI installation and remote extraction require separate user-authorized validation.
