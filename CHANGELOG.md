# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- New companion package `dsh-capability-autocomplete` 0.2.0 (`packages/autocomplete`): composer ghost-text suggestions for DSH Web, inline continuation while typing and next-message suggestions after a reply. Tab accepts, Alt+Up/Down cycles, Esc dismisses; nothing is sent automatically. Routes through the session model or a fixed provider/model.
- The owner-only `POST /autocomplete/predict` endpoint refuses cross-site requests, sends only user/assistant text as quoted context, caps concurrent predictions at four and never writes the transcript.
- Settings are read from the host ConfigForm (Settings → General and the plugin card) instead of browser storage, so the server and the client share one source of truth.
- `npm run build:autocomplete` generates the package's `client.js`; lint and build verify it is current and that every published file exists.
- `dsh-capability-autocomplete` 0.3.0: Chinese and English for the plugin name and description (`locale/zh.json`, `locale/en.json`), every settings field (schemastery `i18n`) and all on-screen text.
- Touch suggestion bar for phones and tablets: tappable suggestion buttons above the composer, a ✦ button to ask for a continuation, × to dismiss. Chosen by input type (`pointer: coarse`), switchable with `mobileBar`.
- `dsh-capability-autocomplete` 0.4.0: optional fleet defaults. A manager can push `AUTOCOMPLETE_PROVIDER`, `AUTOCOMPLETE_MODEL` (and optionally `AUTOCOMPLETE_ROUTE_MODE`) through the DSH credential store; they apply only while the user's own route is untouched, and the user's choice always wins as a whole.

### Fixed

- `dsh-capability-autocomplete` 0.4.1: on phones the suggestion strip was absolutely positioned over the area above the composer and covered the workspace and mode controls. It now sits in the composer dock (laid out in flow, no height while empty) and the ✦ moves into the composer tool row, or into the strip on screens narrower than 360 px where the tool row has no room. Suggestions also stand down in multi-agent sessions while a dispatch confirmation is docked or a teammate view is read-only.

- `dsh-capability-autocomplete` 0.3.1: the settings form (model routing, provider/model, candidates) was missing on instances where DSH is installed by pnpm, because the optional `@deepseek-ai/schemastery` peer could not be resolved from the profile and the plugin exported no `Config`. schemastery is now a direct dependency pinned to the version DSH ships.
- Autocomplete works across terminals: the client calls the endpoint relative to the page, and the endpoint accepts the forwarded host of the Mothership hub tunnel or a reverse proxy as same-origin, so phones and remote browsers are no longer refused as cross-origin.

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
