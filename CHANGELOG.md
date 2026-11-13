# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.3.0] - 2026-11-13

### Added

- Native rc.1 / rc.2 collaboration compatibility: reuse the legacy experimental roster on rc.1 and native subagent trees plus the task DAG on rc.2. Exact native root/path identities, synchronous local-start role preselection and generation-specific communication remain owned by DSH; no parallel roster or executor is introduced.
- Native `subagent` / `subagent_fork` role creation on rc.2 reuses the primary/fallback confirmation card after native approval and guards. Explicit registered role names are required; unknown or unnamed roles fail closed before creation. `workflow.mode=off`, existing explicit `confirmDispatch=never` and unchanged-confirmation cache semantics are preserved.

### Fixed

- Normalize native task owners, nested addresses, model/status evidence, canvas members and live token projections across both generations; retain role naming, role routing and same-tier failover, memory, status and usage. Onboarding no longer offers the removed experimental bundle on rc.2 or claims generic subagent tools must be disabled there.
- Companion Memory 1.0.6 restores ordinary-preset tools and recall on rc.2 using the current composed preset, rather than the removed membership method. Capability-team compositions remain isolated; explicit standard-preset children use global memory.
- Compatibility CI preserves the exact resolved DSH version, refreshes npm metadata and retries only bounded transient install failures; native smoke validates the selected generation's actual service APIs and base composition rather than aliasing missing legacy packages.

### Verification

- First dual-runtime gate: 867 checks per generation, 865 passed and two Desktop-ASAR cases skipped; rc.1/rc.2 native smoke, lint and build passed. Native provider preparation/lifecycle uses fixtures, not a real gateway. No browser GUI, live authentication/quota or skipped-ASAR acceptance is claimed; final package validation remains a separate gate.

## [Unreleased]

### Added

- Mothership-managed config pages (Search 1.0.2, Memory 1.0.2, Autocomplete 1.0.1, Team 5.0.2): a page managed by an AIWUK Mothership opens with a "Configured by AIWUK Mothership" notice, shows the pushed non-secret values (URLs, models, engine lists) read-only, reports managed keys as "Configured by AIWUK Mothership", and folds integration settings the Mothership does not send under "Optional settings". The `api/aiwuk.managed-config.<ext>` route now carries `value` for non-secret refs only; secret refs (flagged or matching the forced-secret pattern) are never resolved or sent.
- `docs/standalone-setup.md` (and zh-CN): Mothership-managed vs. standalone setup for Search, Memory and Autocomplete, with an AI-agent checklist.
- `npm test` runs every test file with an isolated empty `DSH_HOME` (`tests/isolated-home.mjs`), so a developer's real managed-config file can no longer change test results.
- AIWUK Search settings page: "Use AIWUK Search for DSH web search" sets `searchProvider: aiwuk-search` on the host `web` entry through `configForms` (unset restores DSH's default) and shows the current provider.
- Config pages: a secret row whose state cannot be read now shows "Could not check" with a Retry button instead of waiting forever; one automatic retry runs first.
- Optional macOS desktop Mothership restart adapter and installer: preserve the native connector protocol, terminate the complete desktop app gracefully, and relaunch once after an authenticated restart request. Includes lifecycle tests and deployment/rollback instructions.

- `@aiwuk/search`: opt-in native fetch provider `aiwuk-fetch`. It is enabled only when DSH's web setting `fetchProvider` or the environment variable `DSH_WEB_FETCH_PROVIDER` is `aiwuk-fetch`, and it is off by default to avoid `WEB_PROVIDER_AMBIGUOUS` with DSH's built-in `http` provider. `omni_fetch` is unchanged.
- New companion package `dsh-capability-autocomplete` 0.2.0 (`packages/autocomplete`): composer ghost-text suggestions for DSH Web, inline continuation while typing and next-message suggestions after a reply. Tab accepts, Alt+Up/Down cycles, Esc dismisses; nothing is sent automatically. Routes through the session model or a fixed provider/model.
- The owner-only `POST /autocomplete/predict` endpoint refuses cross-site requests, sends only user/assistant text as quoted context, caps concurrent predictions at four and never writes the transcript.
- Settings are read from the host ConfigForm (Settings → General and the plugin card) instead of browser storage, so the server and the client share one source of truth.
- `npm run build:autocomplete` generates the package's `client.js`; lint and build verify it is current and that every published file exists.
- `dsh-capability-autocomplete` 0.3.0: Chinese and English for the plugin name and description (`locale/zh.json`, `locale/en.json`), every settings field (schemastery `i18n`) and all on-screen text.
- Touch suggestion bar for phones and tablets: tappable suggestion buttons above the composer, a ✦ button to ask for a continuation, × to dismiss. Chosen by input type (`pointer: coarse`), switchable with `mobileBar`.
- `dsh-capability-autocomplete` 0.4.0: optional fleet defaults. A manager can push `AUTOCOMPLETE_PROVIDER`, `AUTOCOMPLETE_MODEL` (and optionally `AUTOCOMPLETE_ROUTE_MODE`) through the DSH credential store; they apply only while the user's own route is untouched, and the user's choice always wins as a whole.

### Changed

- Node baseline raised to `>=24.9` for all packages, matching DSH 0.2.2-rc.1; the CI matrix runs Node 24.x.
- Generated files are no longer tracked in git: root and package `client.js` and `packages/*/shared/**` are built by `pretest`, by `prepack` (so `npm pack` and `npm publish` build them automatically) and by the CI "Build generated files" step. Parallel branches no longer conflict on them.
- Usage: the duplicate timing view is removed; wall times come from DSH's native `sessionStats`. The usage report state version moves from 3 to 4, and older checkpoints are discarded. The team's own token fold is kept, because native `tokenUsage` has no route dimension and counts fork-inherited prefix tokens.
- Memory: team `capability_memory_*` tools and `@aiwuk/memory` `memory_*` tools share one pipeline (`createMemoryCore` in `memory-store.js`). `@aiwuk/memory` gains a trusted `ingest()` and `markUsed` in search. Public `memory_write` still rejects role scope and `handoff`/`result` kinds. The storage format is unchanged.
- Design notes: `docs/design/p0-p2-native-reuse.md` records the native-reuse review. Native goals (same-session only), `workflowEngine` (would regress dispatch policy) and schedule/MCP/subagent (already native, no wrapper needed) were skipped.

### Released

- Team 5.0.8, Memory 1.0.5, Search 1.1.0 (Autocomplete stays at 1.0.4): Search 1.1.0 adds the opt-in native fetch provider `aiwuk-fetch` (off by default). Memory 1.0.5 and Team 5.0.8 share one write/search pipeline between the team hub and `@aiwuk/memory`, and Team drops the duplicated timing view in favour of the native `sessionStats`. Node >= 24.9 is now required, generated files (`client.js`, `shared/`) are built in `prepack`, and `release.yml` can publish `@aiwuk/autocomplete`.

### Fixed

- Team locale resolution uses an event-driven, shared settings snapshot to remove repeated `settings.describe()` calls from translation and history replay hot paths. Locale-change notifications are coalesced while environment overrides, English fallback and disposal cleanup are preserved.
- Composer placeholder overlap (Autocomplete 1.0.4): in next-message mode the ghost suggestion was drawn on top of DSH's native placeholder text. The placeholder is now hidden (via a scoped `data-aiwuk-ghost-next` attribute and a style rule, never by changing DSH text) while the next-mode ghost is visible and restored on dismiss, typing or unmount. The ghost also uses `white-space: pre` so its spacing is preserved.
- Autocomplete on desktop (Autocomplete 1.0.3): ghost text overlapped existing input text. It is now positioned right after the caret, using DOM-based caret-at-end detection that handles multi-paragraph (Lexical `<p>`) editors. It is hidden while the caret is not at the end and hides again on `selectionchange` and scroll. Prefix stripping is now case-insensitive.
- Roster model display for idle teammates (Team 5.0.7): once a teammate finished and DSH unloaded it, the roster fell back to its creation options again and showed the Lead model. The correction now also uses the teammate's last recorded `model/selection`, observed live or read once from its durable log through DSH's `sessionQuery` after a restart.
- Roster model display (Team 5.0.6): DSH's `list_agents` and `spawn_teammate` report a teammate's model from the options it was created with, the Lead model it inherited, so after role routing the Lead was told every teammate ran on the Lead's model. A `tools/post-execute` policy now rewrites the `model` of each roster row a capability-team member sees to that member's selected route (`agent.model.current()`); other presets, other tools and failed results are untouched.
- Teammates failed on their first step (Team 5.0.5): DSH 0.2.2-rc.1 fixes provider and model before step preparation and rejects an `agent/request` result naming another route, so per-role routing that switched a teammate off the inherited Lead model in `agent/request` ended the turn with "use agent.model.select() before step preparation". The role route is now selected with `agent.model.select()` when a teammate is created; a later route change (configuration edit, long-context switch, task override) is selected for the next step, and a same-tier failover switch ends the failed step and applies to the next one instead of retrying on the fixed route.
- Team collaboration (Memory 1.0.4, Team 5.0.4, Search 1.0.4): Team sessions created after a DSH restart had no `spawn_teammate`, `send_message`, `wait_agent` or `team_task_*` tools, so the Lead could plan a dispatch but never start teammates. DSH announces agents with `ctx.serial('agent/created')`, which stops at the first listener returning a value; the Memory listener returned its per-agent state and cut off the native Team tool installer behind it. Every `agent/created` listener now uses a block body and returns nothing, and `tests/agent-created-listeners.test.mjs` guards all packages against the pattern.
- Config pages (Team 5.0.3, Search 1.0.3, Memory 1.0.3, Autocomplete 1.0.2): a locked Mothership value now also drives dependent rows, so a Mothership-fixed autocomplete route shows its managed provider and model.
- Locked canonical managed credentials now override legacy/custom key aliases for their exact integration section and search engine. Missing locked credentials do not fall back to local aliases; standalone and unlocked configurations retain their existing behavior. Presence metadata reports the effective canonical ref, and both canonical credentials and ignored aliases remain covered by redaction. This shared resolver fix ships in Team 5.0.1, Search 1.0.1 and Memory 1.0.1.
- Config pages: secret rows could stay on "Checking..." although `credentials/describe` answered. Describe results are now ticketed (a stale or post-unmount result is ignored), a ref absent from a successful reply reads as not configured, a hung or failed call times out into the failure state, and the effect re-runs when the credentials service changes.
- Team overview on a draft session (before the first message): `/api/capability-team.runtime` and `/stream` answered 503. They now return 200 with an empty snapshot (epoch `unbound`) and an idle stream that switches to real snapshots once the runtime binds.
- READMEs no longer say a settings form is "coming"; they describe write-only secrets, Mothership lock badges and the web-search provider toggle.

### Known host limitations

- DSH 0.2.2-rc.1 agent presets take only plain strings for `name` and `description` (`AgentPreset.Config` is `z.string()`, `PresetDefinition.name?: string`, and the preset picker renders them verbatim; only built-in presets get localized copy), so the AIWUK Team preset description stays English in the Chinese UI.

- `dsh-capability-autocomplete` 0.4.2: the touch suggestion strip spanned the whole composer column and started left of the input box. Its left and right edges now match the input box exactly, re-measured on resize.
- `dsh-capability-autocomplete` 0.4.1: on phones the suggestion strip was absolutely positioned over the area above the composer and covered the workspace and mode controls. It now sits in the composer dock (laid out in flow, no height while empty) and the ✦ moves into the composer tool row, or into the strip on screens narrower than 360 px where the tool row has no room. Suggestions also stand down in multi-agent sessions while a dispatch confirmation is docked or a teammate view is read-only.

- `dsh-capability-autocomplete` 0.3.1: the settings form (model routing, provider/model, candidates) was missing on instances where DSH is installed by pnpm, because the optional `@deepseek-ai/schemastery` peer could not be resolved from the profile and the plugin exported no `Config`. schemastery is now a direct dependency pinned to the version DSH ships.
- Autocomplete works across terminals: the client calls the endpoint relative to the page, and the endpoint accepts the forwarded host of the Mothership hub tunnel or a reverse proxy as same-origin, so phones and remote browsers are no longer refused as cross-origin.

## [5.2.2] — Client session-service startup dependency

### Fixed

- Declare `uiSession` in the client plugin's Cordis injections and `@deepseek-ai/dsh-client-ui-session` in the package's client dependency list, with the matching optional peer. Cordis enforces declared service access even through optional chaining; the missing declaration could prevent Team overview and tool widgets from registering at startup. Source-level tests use real Cordis sibling providers to verify failure without the declaration and successful widget registration with it. Generated client artifacts must be rebuilt from the corrected source. This repository fix does not replace or verify an installed hotfix, and test results are not live browser or deployment acceptance evidence.

## [5.2.1] — Native member-status synchronization

### Fixed

- Member cards, running counts and the canvas now share the same resolved native session status. `uiSession.sessionStatus` and `api-session/status` updates are authoritative; unknown current-team members receive one lightweight `remote.session.state({ sessionId })` baseline, refreshed after connection reset without polling or transcript inspection. Generation and revision guards prevent late baselines or stale catalog entries from reviving an explicitly idle or removed member. Unknown status remains unknown while synchronizing rather than being displayed as idle. Catalog `activity: running` denotes residency, not execution; task counts and open turns are not used to infer running members. Source-level tests are not live browser or deployment acceptance evidence.

## [5.2.0] — First-role model confirmation

### Changed

- Unset `confirmDispatch` now defaults to `on-change`: the first Lead spawn for each role and later route changes reuse the existing primary/backup model confirmation card. `always` asks on every spawn, while existing explicit `never` remains unchanged. Native-first `workflow.mode: "off"` is preserved; role-model confirmation does not require a dispatch plan.
- For `on-change` and `always`, the spawn wrapper runs after native approval and guards and before the native tool body, so cancellation does not create a member. `never` retains the static preflight behavior described in 5.1.1. Confirmation is not an authentication, quota or LLM probe; first-request fail-closed checks remain in place. Invalidated route confirmations are cleared, and configuration or identity changes during confirmation require retry rather than creating a member with stale choices. These source changes do not imply publication or deployment.

## [5.1.1] — Dispatch readiness preflight

### Fixed

- Capability-team Lead calls to `spawn_teammate` now receive a static role/model readiness check on the downstream `allow` path before native member creation, including when dispatch enforcement is off. The check reuses role resolution and verifies configured routes, provider registration and cooldown without consuming failover state or probing credentials or model requests. Native `ask`, `deny` and `cancel` decisions remain unchanged; an `ask` approved later does not rerun this hook, so preflight is not a guarantee for every creation transaction. Safe localized errors report readiness problems without exposing raw resolver errors. The first model request still fails closed against unavailable routes to handle races. Static readiness and successful member creation do not guarantee authentication, quota or an actual LLM response; these source changes do not imply publication or deployment.

## [5.1.0] — Native-first team policies

### Changed

- Native-first policy defaults: dispatch enforcement and confirmation, task write-scope enforcement, extra file rules, rotation and token-discipline actions are opt-in. Explicit stored policies remain effective without automatic configuration rewrites. Core role naming, native-projection canvas synchronization, role models and failover, memory, status and token usage are retained.
- Product workflow instructions are conditional on enabled policies; repository maintenance conventions remain separate. Healthy fallback routes stay selected within an activity instead of returning to the primary merely when cooldown expires. Source changes and tests do not imply that running installations have been updated.

## [5.0.9] — Team failover patch

### Fixed

- Same-tier failover now resumes unfinished work automatically after a channel failure, including `QUOTA` reported with HTTP 503. DSH 0.2.2-rc.1 pins the model route for each prepared step: `agent.model.select()` changes future selections but does not restart a failed turn, and returning `retry` would still call the old route. The plugin waits for the native idle boundary, then sends one source-labelled notice through the native inbox to open a new turn with the selected backup and existing conversation history. Tried routes survive continuation and task-lease revision updates, preventing exhaustion loops even after cooldown expiry; cancellation, disposal, queued owner input and owner route changes suppress the pending wake. No configured backup means no automatic wake. Existing permissions and approval requirements remain unchanged, and the notice instructs the model not to replay completed tool calls. Ordinary tool `INVALID_ARGS` failures are not channel outages. Regression coverage includes the native driver boundary and task-control lease changes; this local patch package does not imply npm publication or deployment to a running instance.

## [5.0.0] — AIWUK rebrand

### Changed

- **BREAKING (package names):** the packages move to the `@aiwuk` scope. Loader ids, tool names, credential and
  environment variable names and data directories are unchanged, so existing configuration carries over.
  - `dsh-capability-team` 4.0.1 → `@aiwuk/team` 5.0.0 (the routing plugin is now `@aiwuk/team/roles`; patch id `capability-team-ui` unchanged)
  - `dsh-capability-autocomplete` 0.4.2 → `@aiwuk/autocomplete` 1.0.0 (patch id `autocomplete` unchanged)
  - `dsh-capability-memory` 0.3.0 → `@aiwuk/memory` 1.0.0 (patch id `global-memory` unchanged)
  - `dsh-omni-search` 0.3.0 → `@aiwuk/search` 1.0.0 (patch id `omni-search` unchanged)
  Steps and rollback: [docs/migration-aiwuk.md](docs/migration-aiwuk.md). The old names are not on the public npm registry; roll back from your original source (Hub tarball or link:).
- Display names: AIWUK Team / AI悟空 协作团队, AIWUK Autocomplete / AI悟空 输入补全, AIWUK Memory / AI悟空 全局记忆,
  AIWUK Search / AI悟空 全能搜索 (plugin locale `meta.title` and `meta.description`).
- The client module ids are now the package names (`@aiwuk/team`, `@aiwuk/autocomplete`), as the host keys client
  module rows by package name.
- All four packages declare `engines.dsh` `>=0.2.2-rc.1 <0.3.0`; the `@deepseek-ai/dsh-*` peer ranges are raised to
  `>=0.2.2-rc.1`. The host evaluates `engines.dsh` alone, with prerelease versions included in the range check.

### Added

- `brand.js`: `BRAND`, `EXTENSIONS` and `RENAME_MAP` as the single source for brand names, copied into the
  `omni-search` and `global-memory` `shared/` closures by their `build-shared.mjs`.
- `tests/brand.test.mjs`: asserts the rename map, versions and engines, and that no old package name remains outside
  the allowed places.
- Visual config pages on the DSH Plugins page (slot `plugins.bundle.config`) for Team, Memory, Search and
  Autocomplete, generated from `shared-ui/`. API keys are set, replaced or cleared through the DSH credential store;
  the page only shows whether a key is set and never reads the value back.
- Mothership-managed configuration: extensions read the values-free manifest the AIWUK Connector stores at
  credential record `mothership-connector/managed-config` (file fallback `<DSH home>/aiwuk/managed-config.json`). A
  locked ref wins over local settings and is shown read-only ("Managed by AIWUK Mothership"); an unlocked ref is a
  default below local sources. Each extension serves the manifest at `GET /api/aiwuk.managed-config.<ext>`.
- `@aiwuk/search` registers a native DSH web search provider (`aiwuk-search`) and, when the experimental service is
  present, a cloud speech-to-text provider (`aiwuk-cloud-stt`). The `omni_*` tools are kept. A native fetch provider
  is deferred until the fetch path reports the real target status.
- Server-side i18n (`i18n.js`, `locale/server.*.json`): model-facing tool text is English; user-facing text follows
  `AIWUK_LOCALE`, then the host `locale.preference`, then English.

### Changed (UI)

- All client UI follows the DSH dark/light theme through `--dsw-*` host tokens; the stage's own palette,
  `prefers-color-scheme` and the overview's private language toggle are removed. The pixel stage resolves token
  colors for the canvas and redraws on `theme/change`.
- Autocomplete fleet route: each locked field applies on its own; an incomplete fixed route falls back to `session`.

### Compatibility

- Verified by running the host's `evaluatePluginCompatibility` (`dsh-app-boot`, installed DSH 0.2.2-rc.1) on all four
  manifests: compatible with 0.2.2-rc.1 and 0.2.2, incompatible with 0.2.1-rc.5 and 0.3.0. A full session on a clean
  0.2.2-rc.1 instance was not run: unverified.
- The first-run importer for personal installs is future work; use the documented commands for now.

## [4.0.1] - 2026-11-05

### Added

- Show dispatch confirmation above the composer and display the model each member actually requested.
- Let the Lead follow the conversation's selected model with same-tier fallback routing.
- Provide an external-agent memory CLI for explicit recall and writes.

### Fixed

- Determine capability-session projections from the session header before the live agent preset.
- Publish the changes through source commit `8603890` under a new immutable package version instead of reusing 4.0.0.

## [4.0.0] - 2026-11-03

### Changed

- **BREAKING:** Packages are now published to npm under unscoped names. Update the package names in DSH
  profiles, bundle lists and `cordis.patch.yml` overrides that referenced the old local names:
  - `@local/dsh-capability-team` → `dsh-capability-team` (the routing plugin is now `dsh-capability-team/roles`)
  - `@local/dsh-omni-search` → `dsh-omni-search` (0.3.0; patch id `omni-search` unchanged)
  - `@local/dsh-global-memory` → `dsh-capability-memory` (0.3.0; patch id `global-memory` unchanged)
- **BREAKING:** The default roster is now neutral: `lead`, `architect` (technical-director), `backend`,
  `frontend`, `researcher` (research), `writer` and `qa`. The Web client shows localized names (English / Chinese)
  while a project keeps the default display names.
- Package descriptions are in English; packages declare `repository`, `homepage`, `bugs`, `author` and keywords.
- Published tarballs no longer include tests, test helpers or development scripts.

### Added

- Optional built-in `three-kingdoms` roster theme (the former default heroes), applied per project with
  `capability_team_import { theme: "three-kingdoms" }` and reverted with `theme: "default"`. Hero idle quotes are
  shown only while that roster is active.
- Optional peer dependencies on the DSH host packages the bundles plug into (`@deepseek-ai/cordis >= 4.0.1`, DSH
  packages `>= 0.2.1-rc.3`).
- `roster-defaults.js` holds the built-in rosters; `config.js` shrinks accordingly.
- Onboarding: when DSH's official Agent Teams bundle (`@deepseek-ai/dsh-experimental-agent-team-profile`) is not
  running, the team overview shows a card that explains it is required, warns that enabling it affects every session
  in the profile and disables the native generic subagent tools, and enables it only when the user clicks (DSH's
  plugin manager; applied, restart-required or the failure code is shown). A three-step welcome (enable Agent Teams →
  model tier coverage → new session with the Capability Team preset) appears once in DSH's first-run onboarding and
  after the bundle is enabled on the Plugins page. `/capability-status` and `GET /api/capability-team.onboarding`
  report `teamServicePresent`.
- Single-model mode: an explicit, user-confirmed project setting (`singleModel`, via `capability_team_save` with
  `single_model: "use-default" | "off"`) that routes roles without an assigned model to DSH's current default model
  instead of blocking them. No fallbacks; assigned roles keep their routes; role cards, role view and battle report
  show a badge. The unassigned-role error now mentions this option.
- Settings forms: `dsh-omni-search` and `dsh-capability-memory` export a schemastery `Config` with live (volatile)
  fields for engines, SearXNG/gateway URLs, key variable names, embeddings and memory backend, edited on their DSH
  Plugins page. Set fields override credentials, environment and `integrations.json`; empty fields keep them.

### Compatibility

- Project configurations saved before 4.0 that store any hero role (renamed, removed, or complete roles from a
  template) keep the hero roster; their next save stores the roster explicitly (`roster: 2`).
- Projects that never saved a role keep no trace of the old default and show the neutral roster after upgrading;
  ask the lead to apply theme `three-kingdoms` to restore the hero names.
- Teammates spawned under hero ids (for example `lv-bu`, `diao-chan-r2`) still resolve to the matching neutral
  role's capability, model and policies when the project uses the neutral roster.

[Unreleased]: https://github.com/walke2019/dsh-capability-team/compare/v4.0.0...HEAD
[4.0.0]: https://github.com/walke2019/dsh-capability-team/releases/tag/v4.0.0
