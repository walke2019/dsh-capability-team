# Capability Team for DSH

A configurable, capability-routed multi-agent team preset that extends DSH’s native collaboration with project-aware roles, model policies, and a live workbench.

![MIT](https://img.shields.io/badge/license-MIT-blue.svg) ![DSH 0.2.1-rc.5](https://img.shields.io/badge/DSH-0.2.1--rc.5-6f42c1.svg) ![Node >= 22](https://img.shields.io/badge/Node-%3E%3D%2022-339933.svg)

**English** | [简体中文](README.zh-CN.md)

## ✨ Highlights

- Routes teammates to models selected for their capability and required tier.
- Matches registered models automatically and fails over only within the same tier.
- Configures roles, duties, and themes through a guarded conversational workflow.
- Brings team activity, tasks, usage, and model management into a focused workbench.
- Applies per-role tool, file, and sandbox policies.
- Turns requests into dispatch plans and tracks execution on DSH’s task board.
- Supports planned session rotation and shared memory integrations.
- Tracks token usage and enforces optional per-role budgets.

## DSH team: native foundation, project-level enhancements

| DSH provides | This preset adds |
|---|---|
| Teammate lifecycle, messaging, waiting, and interruption | Capability-based model assignment and same-tier failover |
| Shared task board and dependencies | Project roles, dispatch policies, write-scope enforcement, and budgets |
| Team sessions and usage projections | Team workbench, role-aware configuration, and model management |
| Permission presets and native confirmation UI | Per-role sandbox policies and approval-gated team changes |

## 🚀 Features

### Model routing and resilience
- Automatic model catalog matching by capability and tier.
- Global model exclusions and configurable same-tier fallbacks.
- Long-context routes and cooldown-aware retry behavior.

### Team configuration and roles
- Project-specific role names, capabilities, duties, and usage guidance.
- Conversational edits with validation and native user confirmation.
- Role-scoped tool, path, shell, and permission-preset policies.

### Workflow and collaboration
- Dispatch plans for delegation, direct work, and supported free-text tasks.
- Native board integration with dependencies and scoped assignments.
- Optional teammate plan approval, dispatch confirmation, and session handoff.

### Workbench
- Team overview for members, tasks, activity, usage, and models.
- Role-focused session view and task controls.
- No integrations page or settings UI; integration configuration is read-only.

### Independent tools and memory
- `packages/cpa-tools` provides search, web fetch, search-provider listing, and transcription to all sessions without a UI.
- `packages/global-memory` reads embedding and OpenViking settings; the team plugin's memory hub reads the same configuration.
- See [configuration reference](docs/configuration.md) and each package README for setup and schema.

## Quick Start

### Prerequisites

- DSH Desktop or `dsh web` with the native agent-team service enabled.
- Node.js 22 or newer.

### Install and enable

1. Clone this repository.
2. In DSH’s plugin manager, install the repository directory with `install_bundle`.
3. Restart DSH if the installer reports that a restart is required.
4. Start a **new** session and select **能力协作团队** (`capability-team`). To make it the default, set the preset registry’s `selectedDefault` to `capability-team` in the host profile.

### Minimal setup

Register providers and models in DSH first. The preset derives assignments from that catalog. There is no integrations page; configuration is read-only and is supplied through a file, host environment variables, or the DSH credential store. Install and enable `packages/cpa-tools` and `packages/global-memory` (or their corresponding `.tgz` packages) in DSH’s plugin manager, then restart DSH. See each package README for details.

The configuration file is `%USERPROFILE%/.dsh/capability-team-themes/integrations.json`; `CAPABILITY_TEAM_HOME` can override its directory. Example:

```json
{
  "integrations": {
    "search": { "baseUrl": "https://gateway.example.com", "apiKeyEnv": "CPA_SEARCH_API_KEY" },
    "audio": { "baseUrl": "https://gateway.example.com", "apiKeyEnv": "CPA_AUDIO_API_KEY" },
    "embeddings": { "baseUrl": "https://gateway.example.com", "apiKeyEnv": "CPA_EMBED_API_KEY", "model": "<model>" },
    "openviking": { "url": "https://gateway.example.com", "apiKeyEnv": "OPENVIKING_API_KEY" }
  }
}
```

Alternatively set `CPA_SEARCH_BASE_URL`, `CPA_AUDIO_BASE_URL`, `CPA_EMBED_BASE_URL`, and `OPENVIKING_URL`. Keep secrets in the DSH credential store or named environment variables, never as literal config values. `CAPABILITY_TEAM_OPENCODE_EXECUTABLE` and `CAPABILITY_TEAM_OPENCODE_MODELS` configure the optional free-text task channel.

Start a new team session and ask: “Read the team configuration.” The lead can report the current role and model-matching summary.

## Configuration

Most settings are managed from the workbench or team configuration tools. The example below illustrates the shape only; valid fields and values depend on the team schema and registered models.

```json
{ "capabilities": { "writer": { "tier": "low", "search": false } } }
```

See the [configuration reference](docs/configuration.md) for all options.

## Tech Stack

- **Runtime:** Node.js 22+, DSH plugin lifecycle and Cordis integration.
- **Team services:** DSH `ctx.agentTeams` API and native task-board tools.
- **Workbench:** JavaScript sources in `client/`, bundled into `client.js`.
- **Tests:** Node.js built-in `node:test` runner.
- **Optional integrations:** configured search/embedding HTTP services and OpenViking memory.

## Project Structure

| Path | Purpose |
|---|---|
| `client/` | Workbench client source modules. |
| `scripts/` | Client bundling and project checks. |
| `tests/` | Node.js test suites and fixtures. |
| `skills/` | Project role/theme guidance skill. |
| `locale/` | English and Chinese interface strings. |
| `config.js`, `defaults.js`, `roles.js` | Team defaults, model matching, and role definitions. |
| `cordis.patch.yml` | DSH preset and plugin registration. |
| `client.js` | Generated workbench bundle consumed by DSH. |
| `index.js`, `ui.js` | Plugin and UI entry points. |

## Documentation

- [Configuration reference](docs/configuration.md)
- [Development guide](docs/development.md)
- [Team and repository policies](AGENTS.md)

## License

MIT. See [LICENSE](LICENSE).



