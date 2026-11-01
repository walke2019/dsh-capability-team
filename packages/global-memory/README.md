# DSH Global Memory

A profile-wide, Host-only bundle providing `memory_search`, `memory_write`, and bounded automatic recall. It does not create an agent preset, client UI, or automatic transcript ingestion.

## Build and enable

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
| sharedProjectFilter | current | Safe local fallback; `none` explicitly permits cross-project shared search |
| syncWrites | true | Queue explicit non-session writes when the shared backend is enabled |

Unknown configuration fields are rejected. The embedding/OpenViking settings use the existing integrations file/environment resolution and DSH credential references. There are no credentials or real service endpoints in this package. Credential service absence falls back to environment resolution. Enabling the bundle does not prove backend health or completed remote ingestion.

## Privacy and semantics

- Explicitly save short reusable conclusions only; never credentials, sensitive data, or full conversations. Redaction is defense in depth, not permission to store secrets.
- Default writes are project-scoped. `global` is explicitly cross-project. There is no role write scope.
- Session notes are local only: never embedded, enqueued, revoked remotely, or backfilled. Each agent id owns its session notes; children do not inherit them. Session-only search never sends its query to a remote service.
- Other searches send only the redacted query for optional embedding. Non-session explicit writes may send the redacted passage and project identity to configured services. Existing shared-store session records written by other plugins are not migrated or re-embedded by this plugin.
- The current OpenViking adapter has no trustworthy project metadata. Therefore `current` never calls shared recall and reports `project-filter-unavailable`, preserving local search. `none` is an explicit opt-in to cross-project shared search, not an authorization mechanism. Text that looks like a project label is not trusted metadata.
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
