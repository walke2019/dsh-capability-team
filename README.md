# Capability Team (DSH preset)

**English** | [简体中文](README.zh-CN.md)

A multi-agent preset for DeepSeek Harness (DSH): one lead plus specialist teammates. It reuses DSH's native team and task board, and routes every model request by the teammate's **capability** to its model, instead of letting every member share the session model.

- Package `@local/dsh-capability-team`, preset id `capability-team`, display name "能力协作团队".
- Models map to capabilities only, never to display names. The default role names (Sun Quan, Zhuge Liang, …) are sample data; rename them to any theme.
- After installation it reads the providers and models you registered in DSH and derives tiers, primaries and same-tier fallbacks. No provider or model is hardcoded.
- The team configuration can be changed in conversation and is saved only after you approve it in DSH's native confirmation dialog.

## Relationship to the official DSH team

This plugin builds on DSH's official agent team (`dsh-experimental-agent-team-profile`) and does not reimplement the team itself:

| Capability | Source |
|---|---|
| Spawning teammates, messages, waiting, interrupting, the shared task board (dependencies, write-scope hints) | Official team service and tools, used directly |
| Member list, task board, opening a member's session | Official team UI; this plugin's workbench reads the same `agentTeam` projection and uses the same navigation |
| Per-session model, usage and timing stats | Official `modelSelection`, `tokenUsage`, `sessionStats` projections |
| A model per teammate by capability, tiered auto-matching, global exclusions, same-tier failover, long-context routing | **This plugin**. The official `spawn_teammate` has no model parameter, so teammates inherit the lead's model; the official subagent model selection only applies to the plain `subagent` tool, which is disabled in team mode |
| Sandbox for read-only roles | Official permission preset (`read-only`), switched per role by this plugin |
| Project-level roles, duties and when-to-use, dispatch plans with enforcement, path permissions, budgets, teammate plan approval, team templates | **This plugin**. The official team has no equivalent; official plan mode (`/plan`) is reviewed by the user in the same session, while here the lead reviews teammates' plans |

## Contents

- [Installation](#installation)
- [Environment variables](#environment-variables)
- [Default capabilities and roles](#default-capabilities-and-roles)
- [Automatic model matching](#automatic-model-matching)
- [Conversational configuration](#conversational-configuration)
- [Per-role permissions](#per-role-permissions)
- [Usage and budgets](#usage-and-budgets)
- [Plan-first teammates](#plan-first-teammates)
- [Coordination overhead](#coordination-overhead)
- [Lead dispatch workflow](#lead-dispatch-workflow)
- [Retries and same-tier failover](#retries-and-same-tier-failover)
- [Long-context routing](#long-context-routing)
- [Search and the free channel](#search-and-the-free-channel)
- [Runtime details](#runtime-details)
- [Integrations](#integrations)
- [File rules](#file-rules)
- [Dispatch confirmation](#dispatch-confirmation)
- [Session rotation and handoff](#session-rotation-and-handoff)
- [Token rules](#token-rules)
- [Board dispatch](#board-dispatch)
- [Learned model preferences](#learned-model-preferences)
- [Task control](#task-control)
- [Memory hub](#memory-hub)
- [Development and tests](#development-and-tests)
- [Verification status and known limitations](#verification-status-and-known-limitations)

## Installation

Requires DSH Desktop (or `dsh web`) and Node.js 22 or later (the code uses `AbortSignal.any`).

1. Clone the repository anywhere:
   ```sh
   git clone https://github.com/walke2019/dsh-capability-team.git
   ```
2. Install the cloned directory with the DSH plugin manager: `plugin_manager` → `install_bundle`, with `target` set to the directory's absolute path. Do not hand-edit profile dependencies or run package managers in the profile directory. If the result is `restart-required`, quit DSH completely and restart it; if it fails, address the reported diagnostics first — an existing package directory does not mean the install succeeded.
3. This package's [cordis.patch.yml](cordis.patch.yml) registers the `capability-team` preset. To make it the default for new sessions, set `selectedDefault` of `agent-preset-registry` to `capability-team` in your profile's `cordis.patch.yml`.
4. Quit DSH completely, restart it, create a new session and choose "能力协作团队". Sessions that are already open do not load new code.

To verify: say "read the team configuration" in a new session. If the lead calls `capability_team_read` and returns an `autoMatch` report, the install works.

## Environment variables

All variables are set in the host (DSH process) environment; restart DSH after changing them. The repository contains no keys or private addresses.

| Variable | Required | Purpose |
|---|---|---|
| `CPA_SEARCH_BASE_URL` | No | Overrides the search gateway URL from the Integrations page (`https`, no credentials or query string) |
| `CPA_SEARCH_API_KEY` | For search | Default environment variable for the search gateway key; the variable name can be changed on the Integrations page |
| `CPA_EMBED_BASE_URL` / `CPA_EMBED_MODEL` / `CPA_EMBED_DIMENSIONS` | No | Override the embeddings URL, model and dimensions from the Integrations page |
| `CPA_EMBED_API_KEY` | For vector search | Default environment variable for the embeddings key; the name can be changed too |
| `CAPABILITY_TEAM_HOME` | No | Where project team configs are stored; default `~/.dsh/capability-team-themes` |
| `CAPABILITY_TEAM_OPENCODE_EXECUTABLE` | No | The native OpenCode executable for the free channel; found on `PATH` by default (all platforms) |
| `CAPABILITY_TEAM_OPENCODE_MODELS` | No | OpenCode model catalog file; default `$XDG_CACHE_HOME/opencode/models.json` (`~/.cache/…` when unset) |

Search gateway and embeddings URLs, paths and models are configured on the team overview's Integrations page (see [Integrations](#integrations)); the plugin hardcodes no gateway. Keys live only in environment variables; the config stores just the variable name.

## Default capabilities and roles

`seed` in [config.js](config.js) is the initial default, in three parts:

- **tiers**: tier → list of model IDs. Empty by default, filled after installation.
- **capabilities**: capability → duty, required tier, vendor preference `prefer`, and whether search is allowed (`search`). Provider, model and fallbacks come from auto-matching or the project config.
- **roles**: teammate internal id → display name, capability, optional description.

Each capability can also have `whenToUse` (one sentence on when to assign it), which goes into the lead's roster and dispatch hints to help it pick the right role; defaults are in [config.js](config.js).

| Capability | Duty | Required tier | Search | Vendor preference |
|---|---|---|---|---|
| orchestrator (lead) | Intent analysis, assignment, decisions and final delivery | high | Yes | claude, gpt, gemini |
| technical-director | Technical design, task breakdown, interface contracts and technical acceptance | upper | No | gpt, claude, gemini |
| backend | Services, databases, APIs and backend tests | upper | No | gpt, claude, deepseek, qwen, kimi, glm |
| frontend | Pages, components, interaction and frontend tests | medium | No | gemini, claude, gpt |
| research | Using search tools, checking sources and cross-verifying | medium | Yes | gemini, gpt, grok |
| writer | Documentation and delivery notes | low | No | gpt, claude, gemini, deepseek, qwen |
| qa | Test plans, regression, acceptance, failure reproduction and evidence | upper | No | gpt, claude, gemini |

The default role table is `bindings` in `cordis.patch.yml`; edit it directly, or rename roles per project in conversation. The merged config is validated as a whole:

- lead must be bound to orchestrator, and no other role may be;
- display names must be unique;
- a model must belong to its tier;
- unknown fields are rejected.

The static system prompt contains no role names, models or tiers.

## Automatic model matching

[defaults.js](defaults.js) reads every provider and model registered in DSH and derives default tiers, primaries and same-tier fallbacks. Official APIs, OpenAI-compatible relays and self-hosted gateways all work; nothing depends on a specific provider name.

1. **Normalize**: strip gateway prefixes (`anthropic/`, `bai/`, `pro/deepseek-ai/`, …), suffixes such as `:free`, and date snapshots; `claude-opus-5-5` and `claude-opus-5.5` are the same model.
2. **Exclude**:
   - non-chat models: image, video (including `gemini-omni-*`), speech, realtime voice (`*-live`), translation, embeddings, moderation;
   - models that cannot be team members: no tool calling (`grok-4.20-multi-agent`), hosted agents (`deep-research`), role-play (`-her`), approval-gated specialist models (`daybreak`, `rosalind`, `gpt-5.6-cyber`);
   - free or trial variants marked `free`;
   - models older than each vendor's minimum version, e.g. GPT-4, Claude 3, Gemini 2, Gemma 3.
3. **Tier**: rules follow each vendor's naming pattern rather than listing models one by one. Vendors often change naming between generations, so both the current and previous patterns are kept. Snapshot as of 2026-10-29, checked against vendors' official model pages and the OpenRouter public catalog:

   | Tier | Current official IDs (input/output, USD per million tokens) | Previous naming |
   |---|---|---|
   | high (flagship) | `gpt-6-astra` (10/50), `claude-fable-5-1` (10/50), `claude-opus-5-5` (4/20), `gemini-4-argon` (2/10; Gemini 4 uses codenames) | `gpt-5.0~5.5-pro`, `gemini-3.x-pro` |
   | upper (strong) | `gpt-6.1-sol` (2/10), `claude-sonnet-5-5` (2/10), `grok-4.7` (2/6), `kimi-k3.1-pro`, `qwen3.8-max(-prime)`, `glm-5.3(-prime)`, `deepseek-v4-pro`, `mimo-v2.6-pro`, `minimax-m3` | `gpt-5.6-sol`, `gpt-5.x` |
   | medium (balanced) | `gpt-6.1-terra` (1/5), `gemini-3.8-flash`, `deepseek-flash` (no version in the official name; currently V4.1-Flash-1017), `grok-build-0.1`, `glm-5.3-flashx` | `gpt-5.6-terra`, `gpt-5.x-mini`, `gemini-3.6-flash` |
   | low (light) | `gpt-6-luna` (0.1/0.5), `claude-haiku-5-5`, `minimax-m3.1-flash`, `mimo-v2.6-flash`, `qwen3.8-flash`, `glm-5.3-flash`, `gemini-3.5-flash-lite` | `gpt-5.6-luna`, `gpt-5.x-nano` |

   Vendor-specific rules:
   - **OpenAI**: since GPT-5.6, models are named on four lines (astra/sol/terra/luna) that upgrade independently. As of 2026-10-29 the official models are `gpt-6.1-sol`, `gpt-6.1-terra` and `gpt-6-luna`; there is no `gpt-6.1-luna` yet. Versions are only compared within a line: when `gpt-6.1-luna` appears it automatically becomes the primary and `gpt-6-luna` the last fallback.
   - **OpenAI `-pro`**: every GPT-6 line has a `-pro` at the same price, treated as a reasoning mode of the same model rather than a higher tier; only GPT-5-era `-pro` was the flagship.
   - **DeepSeek**: Flash is a full general model that is just priced low, so it is medium; other Chinese vendors' `-flash` models are light versions and go to low. The official API now has only `deepseek-flash` and `deepseek-v4-pro`; the old name `deepseek-v4-flash` still works but is served by V4.1 Flash. Relays usually include the version (e.g. `deepseek-v4.1-flash`); both spellings are recognized.
   - **xAI**: a Grok version is only the number after `grok-`. `grok-build-0.1` is the coding-agent line with its own version numbers and is not treated as an older generation.
   - **Gemini**: Flash is about 0.8/4, i.e. medium.

   General rules:
   - **Generations are judged by your own catalog**: when the same vendor line has a newer major version in your catalog, the older one drops a tier and goes last. E.g. with `gemini-4-argon` present, `gemini-3.1-pro` drops to upper; there is no Gemini 4 Flash yet, so `gemini-3.8-flash` does not drop. Users who only have previous-generation providers keep those models at their original tier.
   - **Newer minor versions first**: with both `deepseek-v4.1-flash` and `deepseek-v4-flash` in the catalog, the former is primary and the latter only the last fallback.
   - **Open-weight models** are tiered by the parameter count in the name (e.g. `-27b`, `-2.4t`).
   - **`-latest` aliases** move with new versions (including previews) and rank after pinned versions; a vendor's own versionless official name (such as `deepseek-flash`) is stable and ranks normally.
   - **Unrecognized models are not guessed**: they are listed in the report, and the lead asks you.
4. **Assign**: each capability takes the best model in its required tier, comparing in order: newer generation → the capability's vendor preference → version number → provider registration order.
5. **Same-tier fallbacks** (at most 3): first the same model on other providers (identical behavior), then one same-tier model per other vendor, to spread single-vendor outages. Mode variants of one model (`-pro`, `-high`, `-thinking`, `-fast`, …) count as one and do not take extra slots.
6. **Never downgrade**: if the required tier has no allowed model, a higher tier may be chosen; if that is empty too, the capability stays unassigned and requests are blocked instead of falling back to the session model. The global disable list (with prefix rules) is applied before primaries and fallbacks are chosen and checked again at request routing; explicitly configured primaries and fallbacks are never silently replaced.

When providers change, the next request rematches automatically, no restart needed. Explicitly saved project configs take precedence over auto-matching. `capability_team_read` returns `autoMatch` with the report (`matched` / `upgraded` / `below-tier` / `unassigned`) and the unrecognized models.

> Tiers follow vendors' official positioning, naming and pricing, not benchmark scores. When a new vendor or naming scheme appears, update `VENDOR_RULES` in `defaults.js`.

## Conversational configuration

The [project-role-theme skill](skills/project-role-theme/SKILL.md) guides the lead to adjust the current project's team with these tools:

| Tool | Who | Purpose |
|---|---|---|
| `capability_team_read` | All members | Read the revision, defaults, project overrides, effective result and auto-match report |
| `capability_model_catalog` | All members | Read exact model IDs of DSH's registered providers, with their tiers |
| `capability_team_save` | Lead only | Save changes; requires `expected_revision` |
| `capability_team_export` | All members | Export the current team as a portable template |
| `capability_team_import` | Lead only | Apply a template to the current project, with the same confirmation flow as saving |

You can change: role names or the whole theme, descriptions, capabilities, tiers and model assignment, same-tier fallbacks, failover policy, dispatch workflow limits, and adding or removing roles.

In a `capability_team_save` patch, objects merge, `null` restores the default and `false` deletes. Saving:

1. validates the full merged config;
2. checks new or changed models against the DSH catalog;
3. shows the full diff to the user in DSH's native question dialog;
4. writes only after the user clicks Save. The confirmation is taken from the dialog, not from parameters the model reports.

## Per-role permissions

[access.js](access.js) adds an optional `access` policy to each capability, enforced for every team member as a `tools.guard` (a monotonic guard no other plugin can override):

| Field | Meaning |
|---|---|
| `deny` | Denied tool names; entries ending in `*` such as `web_*` match by prefix |
| `editPaths` | Project-relative globs that may be modified (`**` crosses directories, `*` and `?` do not). Applies to modifications through `write`, `edit` and `str_replace_editor`; `[]` means no file may be changed, omitted means unrestricted |
| `shell` | When `false`, blocks `bash`, `pwsh` and `terminal_*`. Restricting paths while keeping a shell can be bypassed with commands, so set both together |
| `preset` | An official DSH permission preset (e.g. `read-only`). Before each request, if the member session's current preset differs, it is switched with the official `permissionPresets.set`. Once the preset **is in effect**, commands are bounded by the official sandbox (even with `shell=false`); if the preset is missing or switching fails, `shell` blocking still applies and nothing is loosened |

By default, research uses the official `read-only` sandbox preset (no file changes, read-only commands allowed); writer may only change `*.md`/`*.mdx`/`*.txt` and `docs/**` and cannot run commands (the official sandbox cannot express such path rules); other capabilities are unrestricted. Note that presets carry their own approval policy: if `read-only` is configured as `ask`, a teammate leaving the sandbox triggers an approval prompt. Relative paths are resolved against the member's working directory and compared with the project root; changes outside the project, paths starting with `~`, or targets that cannot be determined are rejected. Checks look at the literal path and do not resolve symlinks.

The permission summary is written into each member's team context, the lead's roster and dispatch results, and shown on the overview's "Roles & settings" page. Change it in conversation (`capabilities.<id>.access` in `capability_team_save`, replaced as a whole; `null` removes the restriction).

## Usage and budgets

[usage.js](usage.js) folds each team member's session log by DSH token-meter's `tokenUsage` rules: each assistant settlement takes the last usage sample, streaming samples within a step replace each other, and retries after `llm/retry-started` count separately. Each sample belongs to the model in the latest preceding request header, i.e. the model the request was actually sent to; events inherited from a parent session are excluded.

- **Overview "Usage" page**: per member, budget tokens (uncached input + cache writes + output), cache reads listed separately, and steps and average time per step for each model. Totals and timing update live (see "Live data" below); the per-model token split comes from the last refresh, sharing one log read with the request log.
- **Budget**: a capability's `maxTokens` caps budget tokens per member session. At request routing the session's accumulated usage is read synchronously from token-meter's session projection (no log reads); at the cap the request is blocked with a reason, and no other model is tried. Not enforced if the host has no token-meter. Change it in conversation; `null` removes it.
- DSH provides no model prices, so this counts tokens only, not money.

## Plan-first teammates

[plan-gate.js](plan-gate.js) implements a capability's `planFirst`: such teammates must have their plan approved by the lead before making changes, similar to Claude Code's team mode where teammates submit plans in plan mode for the lead to approve.

1. The teammate calls `capability_submit_plan`; the plugin sends the plan to the lead as a 【计划待批】(plan pending) message from the teammate;
2. The lead approves with `capability_review_plan`, or returns it with feedback, which is sent back to the teammate;
3. Until approved, the guard only allows analysis and coordination tools and rejects execution tools such as file writes and commands; a returned plan must be resubmitted;
4. When the lead's dispatch plan for a new request assigns this role, the earlier approval expires and the new task needs a new plan.

DSH's own plan mode (`/plan`) is reviewed by the user in the same session and does not restrict tools; here the lead reviews and it is enforced at the tool layer. Plan state is in memory and must be resubmitted after DSH restarts. Off for every capability by default.

### Team templates

[template.js](template.js) defines a portable template (`format: "capability-team-template"`, `version: 1`) with roles, each capability's duty, when-to-use, tier, vendor preference, permissions, budget and plan-first, plus the workflow and failover policy. Providers, models, fallbacks and long-context routes are tied to each person's DSH catalog and are not in templates.

On import, these capability fields are set from the template and fields the template omits are cleared; existing providers and models are kept; roles are replaced as a whole. Import goes through the same validation, catalog check and confirmation dialog; new capabilities from the template are listed as unassigned for later model assignment.

## Coordination overhead

DSH's `wait_agent` wakes the lead on any teammate status change, message or board update, with a 30-second default timeout. In one measured session, 29% of teammate steps and 73% of lead steps were pure coordination (progress reports, board updates, repeated waits). So the policy requires (in line with similar projects that "return only a result summary and let the lead own completion"):

- teammates update the board once on claim and once on completion, report the final result once with `send_message`, and only reach out mid-task when blocked or a decision is needed;
- after dispatching, the lead waits with `wait_agent` (`timeoutMs=600000`) and on waking handles only final results, blockers or decision requests, without replying to progress messages.

## Lead dispatch workflow

[workflow.js](workflow.js) makes the lead analyse and assign each new user request instead of doing everything itself:

1. **Analyse and assign**: each new user message starts a new round. The lead may do a little read-only analysis first (6 `read`/`glob`/`grep` by default), then must call `capability_dispatch_plan`:
   - `delegate`: multi-step or specialist work. Write the analysis, pick one or more registered roles by their duties, and give each a concrete task with acceptance criteria;
   - `free`: long plain text (summarizing, translating, drafting, organizing given material) for a free model, with a stated reason. Not for keys or sensitive content;
   - `direct`: a one- or two-step hands-on task (checking status, reading a file, running a command) or a question answerable in a few sentences, with a stated reason. Handing these off would cost an extra lead request.
   The plan result is visible to the user and lists each role's display name, capability and actual model.
2. **Enforcement** (`tools.guard`, which the model cannot bypass):
   - without a plan, execution tools such as shell, file writes and search are rejected with a hint to plan first;
   - after `delegate`, the lead can only create the planned teammates, message, manage the board, wait and do read-only acceptance, not execute itself;
   - after `free`, the lead can only call `capability_free_task` and review; the free channel is unavailable in other modes;
   - after `direct`, the lead's own executions are capped (3 by default); beyond that it must delegate;
   - when the request changes, calling `capability_dispatch_plan` again replaces the plan.
3. **Visible state**: the lead's team context shows the current assignment at every step. Teammate reports do not reset the round's plan.

Only the lead is constrained; teammates use all tools as usual. The limits are part of the project config and can be changed in conversation (`workflow` in `capability_team_save`, merged by field; `null` restores defaults):

| Field | Default | Meaning |
|---|---|---|
| `mode` | `enforce` | `enforce`; `remind` only reminds in context; `off` disables |
| `analysisBudget` | 6 | Read-only analysis steps allowed before a plan |
| `directBudget` | 3 | Cap on the lead's own executions in `direct` mode |
| `freeTools` | `none` | Free model tool level: `none` text only; `read` may read and search project files; `write` may also create and edit project files (see below) |
| `freeModels` | `[]` | Order of free models to try; empty means every free model in OpenCode's catalog, newest first |
| `analysisTools` | read, glob, grep, read_image, session_search, session_event_search, session_event_read | Analysis tools (read-only, a few allowed before planning) |
| `coordinationTools` | team, board, question, skill, goal tools, … | Coordination tools, unrestricted |
| `fileLimits` | see [File rules](#file-rules) | File size and read/write rules; `false` disables |
| `confirmDispatch` | `on-change` | See [Dispatch confirmation](#dispatch-confirmation) |
| `rotation` | see [Session rotation](#session-rotation-and-handoff) | Rotation thresholds; `false` disables |
| `enforceWriteScopes` | `true` | Refuse edits outside the write scopes of held board tasks (see [Board dispatch](#board-dispatch)) |
| `tokens` | see [Token rules](#token-rules) | Idle compaction and output trimming; `false` disables |

Tools in neither list count as execution, including tools other plugins add.

## Retries and same-tier failover

[failover.js](failover.js) handles DSH request errors in this order; every parameter can be changed in conversation via the project's `failover` policy:

1. **DSH provider retries**: rate limits, 5xx, timeouts, network errors and empty responses, 5 times by default with backoff up to 10 seconds. Decided by the provider config; this plugin does not interfere.
2. **Extra retries**: after DSH gives up, the same model is retried `retries` more times (default 2). Exponential backoff starts at 1 second, caps at 15 seconds, and honors the server's `Retry-After`. Quota or credential errors are not retried on the same provider.
3. **Same-tier fallbacks**: switch in the order of the capability's `fallbacks`, skipping providers not registered in DSH and models in cooldown. Fallbacks must be the same tier and may be paid models; no cross-tier or downgrade. If all fail, each model's error is reported.
4. **Cooldown**: a model switched away from cools down for `cooldownMs` (default 60 seconds, 5 seconds to 10 minutes); afterwards new requests return to the primary automatically. If the same model fails again soon after its cooldown ends, the cooldown doubles each time (60 s, 2 min, 4 min… up to 30 min), so a dead provider is not retried every minute; after 10 cooldown lengths without a failure it starts over at 1×.

Errors unrelated to availability, such as context overflow or content refusals, do not switch. Per the DSH source, the recovery hook only runs when a started stream ends in an error; if the adapter throws before sending (e.g. an unregistered provider), the hook never runs, so unregistered providers are skipped before routing. Switches are recorded in the session request header, and on the next step this plugin explicitly routes back to the intended model.

## Long-context routing

[long-context.js](long-context.js) lets a capability use another same-tier model (usually one with a larger context window) when the context is long, configured as `longContext: { thresholdTokens, provider, model }`:

- Each request reads the next prompt size synchronously from token-meter's `contextPressure` projection (the same algorithm as DSH's usage display), without reading logs or calling a model.
- At `thresholdTokens` it switches to that model, with the original primary and fallbacks after it for failover; it switches back only below 80% of the threshold (e.g. after compaction), to avoid flipping every step and invalidating the cache.
- The model must be the same tier as the primary ("never downgrade"); a route disabled by the global model policy is ignored. New routes are checked against the DSH catalog before saving.
- The model that writes compaction summaries is set in DSH's `compaction-basic` config (`summarizationProvider/Model`) and does not go through this plugin's routing, so set "cheap model for background requests" there.

## Search and the free channel

- **`cpa_search` / `cpa_web_fetch`**: call the aggregation gateway configured in the `search` section of the Integrations page (`baseUrl` + `searchPath` / `fetchPath`, defaults `/v1/search` and `/v1/web/fetch`).
  - Only members whose capability has `search: true` may use them; by default the lead and research.
  - Fetch only allows public HTTP(S) pages and rejects localhost, private networks, cloud metadata addresses and URLs with credentials.
  - Redirects are not followed; upstream bodies are not echoed on errors; responses containing the key are refused.
  - Search results are untrusted external material; citations need checking.
- **`capability_free_task`**: the lead hands work to a free model of the local OpenCode and backfills the native board: create a task, claim it, write the result (including changed files) and complete it; on failure, record the reason and release the task.
  - **Cross-platform lookup**: the executable comes from `CAPABILITY_TEAM_OPENCODE_EXECUTABLE`, otherwise `PATH` (native `opencode.exe` on Windows, including the package file in the npm global directory; `opencode` on macOS / Linux), and finally `~/.opencode/bin` from the official install script. `.cmd` / `.ps1` wrappers are not used.
  - **Free models are not hardcoded**: they are filtered from OpenCode's own catalog (`$XDG_CACHE_HOME/opencode/models.json`, default `~/.cache/opencode/models.json`, overridable with `CAPABILITY_TEAM_OPENCODE_MODELS`) — zero-cost, non-deprecated, tool-capable models of the `opencode` provider. The catalog updates with OpenCode, so free models come and go without code changes; if it is missing, run `opencode models` once. The project's `freeModels` can only reorder or narrow the set, and each entry is checked as free against the catalog at run time.
  - **Next model in order**: when a free model reports exhausted quota, unauthorized, missing model or similar (OpenCode itself would retry forever), it is stopped at once and the next free model is tried; only when all are unavailable is an error reported. Paid models are never used. Other errors are reported as-is without switching.
  - **Built-in `build` agent**: each run overrides only `build`'s model and permissions for this process via inline config (`OPENCODE_CONFIG_CONTENT`) and turns off title generation, because an agent's own permissions take precedence over `OPENCODE_PERMISSION`, a user's default agent may delegate to paid subagents, and title generation uses the user's paid small model. The child process starts with an argument array, without a shell.
  - **Tool levels** (project `workflow.freeTools`): `none` exposes no files; `read` allows reading and searching inside the project; `write` also allows creating and editing inside the project. All three forbid shell, network, subagents and paths outside the project, and forbid reading or writing `.env`, private keys, certificates and files named with credentials/secret.
  - The `none` level still carries one read rule that matches no file: in testing, OpenCode's free endpoint rejected requests with no tools at all with "Free usage limit reached".
  - From `read` up, project file contents are sent to the free model's cloud, so the default is `none`. Never send keys or sensitive data at any level.

## Runtime details

- **Dynamic context**: each team member registers a `capability-team:roster` context in its own scope when created. Its roles, duties, models and roster are regenerated every step, so saves take effect from the next step.
- **Request routing**: project configs are cached by modification time; the global model policy is read on every request. The catalog updates when the set of providers changes or on explicit refresh; disable rules are reapplied on the cached catalog without calling a model.
- **Unregistered teammates**: requests fail with a hint for the lead to register the role in conversation; the model is never guessed.
- **Non-team sessions**: routing is not rewritten.
- **Project ownership**: a member's project is fixed at its first request; changing directories later does not change the config. If a parent directory already has a config, subdirectories are the same project.
- **Storage**: configs live in `$CAPABILITY_TEAM_HOME/<sha256 of project path>.json` and the global model policy in `$CAPABILITY_TEAM_HOME/model-policy/` (per DSH profile); nothing is written into your repository.
- **Concurrency**: saves use revision CAS and a lock file; a lock whose owner process exited or that is older than 30 seconds is reclaimed.
- **Legacy migration**: files in the old names/descriptions/routes format are migrated on read and written in the new format on the next save.
- **Tool parameters**: all tool parameters are standard JSON Schema (root `type: "object"`, required fields in a `required` array) using only the keyword subset DSH supports. Helpers are in [tool-schema.js](tool-schema.js). APIs such as Claude validate tool definitions strictly, and an invalid definition makes the whole request return 400.

## Integrations

[integrations-config.js](integrations-config.js): the search gateway and embeddings endpoint are your own settings; the plugin presets no address, model or vendor field. Effective values are taken in this order (highest first), and the overview's Integrations page shows where each field came from:

1. Environment variables (see the table above; they override only a few fields, and overridden fields are read-only on the page);
2. The file saved by the Integrations page, `$CAPABILITY_TEAM_HOME/integrations.json` (versioned; concurrent edits return a conflict);
3. Plugin config: add `integrations: { search: {...}, embeddings: {...} }` to `@local/dsh-capability-team/roles` in your profile's `cordis.patch.yml`;
4. Defaults: empty URL and model (feature off); paths default to `/v1/search`, `/v1/web/fetch`, `/v1/embeddings`.

| Section | Fields |
|---|---|
| `search` | `baseUrl`, `apiKeyEnv`, `searchPath`, `fetchPath`, `headers` (extra request headers, e.g. a User-Agent your gateway requires), `providers` / `fetchProviders` (when set, they become the tools' provider choices; empty means any), `timeoutMs`, `fetchTimeoutMs` |
| `embeddings` | `baseUrl`, `apiKeyEnv`, `path`, `model`, `provider`, `dimensions`, `queryTask`, `passageTask`, `headers`, `timeoutMs`, `batch` |

Keys never go into the config: `apiKeyEnv` is only an environment variable name, and `headers` may not contain `Authorization`, `Cookie` and the like.

## File rules

[file-limits.js](file-limits.js) is enforced at the tool layer for every team member, and `npm run lint` applies the same rules to this repository:

| Rule | Default |
|---|---|
| Source files | Consider splitting from 300 lines; **hard limit 500 lines** |
| Test files | **Hard limit 800 lines** |
| Files already over the limit | May only shrink (no more lines after a change than before) |
| Whole-file reads | Code files over 400 lines cannot be read without `limit`; grep first, then read with `offset/limit` |
| Overwriting existing files | `write` cannot overwrite an existing file; use `edit` for local changes |
| Teammate reports | Each `send_message` at most 1500 characters; split long reports, conclusions first |

Generated files whose first line is `// @generated`, lock files, and `node_modules`/`dist`/`vendor` are exempt from line limits, but generated files cannot be edited directly. Thresholds can be changed in conversation via `workflow.fileLimits` (`false` disables).

Following these rules, the client is split into source files under [client/](client/); `npm run build:client` concatenates them in file-name order into the shipped [client.js](client.js) (DSH loads one client script per package, and official packages are built into single files too). `npm test` builds first, and `npm run lint` checks that client.js matches its sources.

## Dispatch confirmation

[dispatch-confirm.js](dispatch-confirm.js): when the lead's dispatch plan assigns teammates, `capability_dispatch_plan` pauses and shows a confirmation card right under the call in the conversation:

- one row per role: task, primary model (a dropdown of same-tier models not disabled by the global policy) and fallbacks (up to 3, add/remove/reorder);
- scope: **this task only** (affects only this role's requests in this lead session) or **save as project default** (written to the project config, affecting every role with that capability);
- the lead can create or message teammates only after you click "Confirm dispatch"; "Cancel" discards the plan, and the lead needs to ask you how to adjust.

`workflow.confirmDispatch` controls when to confirm: `on-change` (default: on the first dispatch of each new session, then only when a route changes), `always`, `never`. Clients that cannot show the card (CLI, ACP) fall back after 8 seconds to DSH's native question dialog, where you can enter one "role-id: model, fallback1, fallback2" per line. Config validation also limits fallbacks to 3.

Every plugin tool that returns JSON has its own card (model catalog, budget, temporary model, export/import, search, web fetch, handoff, rotation, memory), so the conversation never shows raw JSON.

## Session rotation and handoff

[session-rotation.js](session-rotation.js) tracks, per teammate session, compactions, turns, repeated reads of the same file and context usage:

| Level | Default triggers (any) | Action |
|---|---|---|
| Soft | ≥2 compactions, context ≥75%, same file read ≥15 times | Reminder only: read less, don't reread, start editing — **no handoff** |
| Hard | ≥3 compactions, context ≥90%, ≥8 turns | The lead can no longer give it new work and must rotate it first |

The hard level applies only to **sessions that made progress** (edited a file, or were compacted). A session that has only read code stays at the reminder level however full its context is, so a successor is not spawned just to read the same code again (we measured three successors in a row that never edited anything).

- The teammate calls `capability_handoff` (done, remaining, pitfalls, open questions, how to verify); the plugin attaches `git diff --stat`, its open board tasks and its last test run;
- The lead calls `capability_rotate_member` and gets the successor name `<role>-r<N>` (DSH team rosters never reuse names), the successor's first message, and the `interrupt_agent` / `spawn_teammate` calls to make; when the successor starts, the plugin reassigns the old member's open board tasks to it with DSH's reassign action;
- The successor keeps the original role's model, permissions, budget and confirmed route; messages from the lead to the old member are blocked with a hint to message the successor;
- When team slots (`maxMembers`, DSH default 8) run out, no rotation happens; it switches to a context-saving mode and suggests raising DSH's `maxMembers`.

Thresholds can be changed in conversation via `workflow.rotation` (`false` disables).

## Token rules

[token-discipline.js](token-discipline.js) / [teammate-context.js](teammate-context.js). Measured here, prompt caching already works well (93–98% of prompt tokens are cache reads; DSH does this well), so cost comes from **how much context every step resends**: DSH compacts only at 80% of the window, so sessions ran at ~150k tokens per step; one frontend session resent ~200M tokens over 1358 steps. The rules aim for a small, stable prefix and a small working context:

| Rule | How |
|---|---|
| Stable prefix (keep the cache) | Plugin rules and context change only on events, never with per-step counters; a session does not switch models casually (long-context routing has hysteresis, failover cooldowns double) |
| Lean teammate prefix | Lead-only tools are installed on the lead only and teammate-only tools on teammates only; DSH's skill catalog is shortened for teammates to name + one line (326 skills: 56k → 26k characters), or set per capability with `skills`: `full` / `none` / a list |
| Small working context | File rules limit whole-file reads; command, search and web output over 6000 characters is cut at once to its first 3000 and last 1500 characters, with the full text written to a temp file whose path is given (DSH's own pruner only acts at compaction time) |
| Compact when idle | A team member that goes idle above 35% of its window is compacted. The provider cache expires after a few idle minutes anyway, so this costs almost no cache |
| No wasted work | Do only the assigned task, no out-of-scope research, report once (≤1500 characters), the lead waits long and does not answer progress messages |

Change thresholds in conversation via `workflow.tokens` (`idleCompactRatio`, `trimToolOutputChars`, `keepHeadChars`, `keepTailChars`; `false` disables).

**Two settings the plugin cannot make for you, in your DSH config:**
- **Mid-turn compaction threshold**: compaction during one long piece of work is decided only by DSH's `compaction-basic.thresholdRatio` (default 0.8), for every session. Around 0.5 cuts the per-step context a lot, at the cost of more summary requests.
- **Gateway cache affinity**: we saw 60+ cache misses within 5 minutes with no local cause, most likely the gateway rotating upstream accounts. Pinning each session to one upstream raises the hit rate further.

## Board dispatch

[board-dispatch.js](board-dispatch.js): dispatch goes through the official DSH team's shared task board, following its rules (list → get → claim → work → complete):

- Each role in `capability_dispatch_plan` can carry `tasks` that split its work into subtasks, each with a subject, description, `write_scopes` (project paths it will change) and `blocked_by` (keys of subtasks listed earlier in the plan, so no cycles). Without `tasks`, the whole assignment is one board task.
- After you confirm, the plugin creates these tasks on the board. Existing teammates get their ready tasks at once; new teammates get theirs when they start; blocked tasks wait for their prerequisites.
- Each teammate's runtime context lists its board tasks and their status and reminds it of the board workflow.
- `workflow.enforceWriteScopes` (default `true`): when the tasks a teammate holds declare write scopes, edits outside them are refused (DSH itself only warns about overlaps). `false` makes it advisory again.
- Before the final answer, the lead should check `team_task_list` for tasks still in progress.

## Learned model preferences

[model-prefs.js](model-prefs.js): every confirmed dispatch records, per capability, the primary and fallback order you chose (up to 20 per project).

- **Preselect**: when a primary was chosen at least twice and in most of the last 10 choices, the next card preselects it with your latest fallback order, marked "your usual choice". The card still asks; nothing changes silently.
- **Avoid failures**: models with recent failures (cooling, ≥2 consecutive failures, or a credential error) are never preselected and move to the end of the fallbacks, with the failure count shown. Failures are kept in `$CAPABILITY_TEAM_HOME/route-health.json` and survive a DSH restart: credential errors for a day, other failures for an hour.
- **Suggest saving**: when the last 3 choices are identical, the card suggests saving them as the project default.
- The lead can view or clear what was learned with `capability_model_prefs` (`read` / `clear`); data lives in `$CAPABILITY_TEAM_HOME/model-prefs/`.

## Task control

Each teammate card in the team workbench has a "Task control" area: used/estimated steps (yellow near the estimate, red over it; not a quality rating), the temporary model (original → temporary, expiry, auto-restore rule) and recent actions. You can set a temporary model (candidates only from the backend catalog, confirmed in-page with cost and cache impact stated), restore the configured model, end the lease, or start counting by complexity when there is no lease. A 409 is never retried automatically; you are asked to confirm again.

The Usage page also shows, per member, **average input per step** (uncached input + cache reads + cache writes, divided by steps) and **cache-read share**; above 80k tokens per step it suggests rotating the session.

## Memory hub

[memory-hub.js](memory-hub.js) / [memory-store.js](memory-store.js) / [memory-embed.js](memory-embed.js): the team's conclusions are kept per project and brought back automatically for related work.

- **Automatic ingestion**: handoffs (a role's newer handoff replaces the older one), pitfalls from handoffs (project scope), and teammates' successful final reports to the lead (200+ characters);
- **Explicit writes**: `capability_memory_write` with kinds `pitfall` / `decision` / `note`; a `decision` with a `key` replaces older decisions on the same topic; identical content merges;
- **Scopes**: `role` (default, this role), `project` (whole team), `session`, `global` (lead only); other projects' memories are invisible;
- **Automatic recall**: when a member receives a new task, memories are searched by the task text and up to 2400 characters are injected into its runtime context; not recomputed while the task is unchanged, so the context is not resent every step;
- **On-demand search**: `capability_memory_search`;
- **Ranking**: BM25 full-text (Latin words plus Chinese single characters and bigrams) and vector cosine, merged by reciprocal rank fusion (RRF), then decayed with a 30-day half-life and slightly boosted by use; without embeddings it uses full-text only, says why in the results, and fills in missing vectors later;
- **Forgetting**: memories unused for 180 days and superseded ones are removed on compaction; at most 2000 per project;
- Storage: `$CAPABILITY_TEAM_HOME/memory/<project hash>.jsonl` and `global.jsonl`, append-only, atomically replaced on compaction.

### Embeddings endpoint

The memory hub calls `<baseUrl><path>` in the OpenAI-compatible format (`path` defaults to `/v1/embeddings`):

```http
POST <baseUrl><path>
Authorization: Bearer <value of the variable named by apiKeyEnv>
Content-Type: application/json

{"model":"<model>","input":["text 1","text 2"]}
```

`provider`, `dimensions` and `task` (`passageTask` when storing, `queryTask` when searching) are added to the body only when filled in on the Integrations page, for gateways that require them (for example, a Jina-backed gateway may need `provider=jina`, `queryTask=retrieval.query`, `passageTask=retrieval.passage`). The response must be `{"data":[{"index":0,"embedding":[...]}]}` with as many non-empty vectors as inputs; otherwise it is a failure and search falls back to full-text (a gateway status page is never taken as vectors). Each vector records "model@dimensions"; after changing the model or dimensions, old vectors are excluded from comparison and re-embedded in the background.

## Development and tests

```sh
npm test          # builds client.js, then runs all tests
npm run lint      # syntax, file line limits, whether client.js is up to date
npm run build     # checks the published file set before release
```

Tests use mocked ctx, model catalogs and question dialogs, and make no model, search or Git write calls. Auto-matching is tested with a neutral sample catalog (official OpenAI, official Anthropic, and vendor-prefixed relays; see [tests/fixture.mjs](tests/fixture.mjs)), independent of any real user config.

| File | Contents |
|---|---|
| [index.js](index.js) | Plugin entry; wires the modules together |
| [roles.js](roles.js) / [team.js](team.js) | Role binding, team context and request routing |
| [config.js](config.js) | Default config, merging and validation |
| [defaults.js](defaults.js) | Model normalization, tiering and auto-matching |
| [allocation.js](allocation.js) | Model catalog reads and route checks |
| [theme.js](theme.js) / [theme-plugin.js](theme-plugin.js) | Project config storage and conversational config tools |
| [failover.js](failover.js) | Extra retries, same-tier failover and cooldown |
| [search.js](search.js) / [integrations.js](integrations.js) | Aggregated search tools |
| [task-bridge.js](task-bridge.js) / [free-worker.mjs](free-worker.mjs) | Free channel and board backfill |
| [tool-schema.js](tool-schema.js) | Tool parameter JSON Schema helpers and validation |
| [workflow.js](workflow.js) | Lead dispatch plan and tool enforcement |
| [access.js](access.js) | Per-role tool, command and file path permissions |
| [usage.js](usage.js) | Member usage folding and token budgets |
| [long-context.js](long-context.js) | Same-tier long-context routing |
| [plan-gate.js](plan-gate.js) | Teammate plan submission, lead approval and execution guard |
| [template.js](template.js) | Team template export and import |
| [config-projection.js](config-projection.js) | Config save counter projection that triggers the panel to reread the config |
| [integrations-config.js](integrations-config.js) | Integrations config layers, validation, saving and HTTP API |
| [file-limits.js](file-limits.js) | File rules (shared by the tool guard and lint) |
| [dispatch-confirm.js](dispatch-confirm.js) | Dispatch confirmation: routes, validation, HTTP API and native dialog fallback |
| [session-rotation.js](session-rotation.js) | Session rotation signals, handoffs and successors |
| [board-dispatch.js](board-dispatch.js) | Board dispatch: subtasks, write scopes, dependencies, hand-out and reassignment |
| [route-health.js](route-health.js) | Route failures that survive restarts |
| [model-prefs.js](model-prefs.js) | Learned model preferences and failure avoidance |
| [token-discipline.js](token-discipline.js) / [teammate-context.js](teammate-context.js) | Token rules: idle compaction, output trimming, lean teammate prefix |
| [memory-hub.js](memory-hub.js) / [memory-store.js](memory-store.js) / [memory-embed.js](memory-embed.js) | Memory hub: ingestion, recall, hybrid search and embeddings |
| [client/](client/) / [scripts/build-client.mjs](scripts/build-client.mjs) | Client sources and single-file build |

After changing tool parameters, [tests/tool-schema.test.mjs](tests/tool-schema.test.mjs) checks the schema of every registered tool.

## Team overview and model management

Choose "能力协作团队" in the new session's mode picker, then open the right panel and choose "Team overview" from its home.

**Live data**: the workbench (member status, board tasks, each member's actual model) and usage (token totals, time per step, time to first token, decode speed) need no refresh. They all read DSH's own session projections, the same data the official team UI uses:

- the lead session's `agentTeam` (team service): members and board tasks;
- each member session's `modelSelection` (session controller): the current model, i.e. the model of its latest request;
- each member session's `tokenUsage` (token-meter): usage;
- each member session's `sessionStats` (session-stats): steps, model time, time to first token and decode speed;
- the panel subscribes to the client's shared session store (`ctx.sessions.list`) and redraws whenever these projections change, without running commands or writing to the conversation. Clicking a teammate card opens that teammate's session, the same way as the official team UI.

The "Roles & settings" page and the top of the "Request log" page also overlay this live data (current status, latest request model, steps).

**Configuration data** (role definitions, model policy, diagnostics, request log details) comes from `/capability-status`. Slash command results do not enter the model context but leave a command card in the conversation, so it is not polled; it is read only:

- once automatically, when the session has a team (with teammates) and the panel has no snapshot yet;
- again automatically when the `capabilityTeamConfig` projection registered by this plugin ([config-projection.js](config-projection.js)), which counts successful `capability_team_save`/`capability_team_import` calls and model policy saves in this session, changes (at most once per count);
- when you click Refresh.

The last result is cached per session in the panel together with the config count at read time, which decides whether the cache is stale when the panel reopens. The overview no longer takes over the center session view and can sit beside the chat. Creative mode (cordis) sessions are not migrated automatically by restarts or extension installs; existing sessions can be kept. You can also type `/capability-status` to read diagnostics without starting a model.

Development checks: `npm run lint` checks JavaScript syntax and file rules, and `npm run build` checks syntax, package exports, published files and locale JSON; the extension ships native JavaScript without transpiling. `npm test` runs all regression tests.

- **Team workbench**: one card per role showing working/idle/not started/error, the current board task and the actual model, with animated links from the lead to teammates it delegated to. Data comes from the live projections above and the host's `api-session/status` push, without polling or writing to the conversation.
- Precheck candidates are listed in tabs by tier (first tier by default, models in use first, 40 per render), including unassigned and unclassified models; catalog read failures are reported separately. Tiers are rule-based inference, not measured capability.
- Turning a switch off disables a model; nothing is written until you click "Save globally", and unsaved changes are drafts. Saves are revision-checked, and conflicts never overwrite another window's changes.
- **Prefix exclusion**: rules ending in `*` match both "provider/model" and the bare model ID (e.g. `@cf/*` covers `@cf/` models on every provider); rules stay in effect, so future models with the same prefix are excluded too.
- **The model policy is global**: one per DSH profile, shared by every capability-team session (including new ones); any lead session's save applies from each session's next request; teammates cannot change it. Requests already sent are not undone.
- The candidate preview after saving is separate from the log: candidates only show routes the current policy allows, and the actual choice can still be affected by failure cooldowns. Refresh after saving to see new candidates.
- "Request config recorded" proves the log recorded the request config, not that the provider call succeeded; "Assistant response recorded" does not mean the task passed acceptance either. Only model identifiers and event coordinates are extracted; no content or prompts are shown.
- The official team UI shows a teammate's model from `modelSelection`, i.e. the model of its latest request. Before a teammate's first request it shows the inherited model.
- Once every eligible model is disabled, requests are blocked. Saving from the overview calls no model, so you can still re-enable models to recover.

## Verification status and known limitations

Verified:

- 298 regression tests pass (including file rules, dispatch confirmation, session rotation, the task control panel and the memory hub), covering route filtering, prefix rules, shared global policy, revision conflicts, component draft/save/error states, keeping the editor on refresh failure, UTF-8 stream chunking, quota error switching across chunks, input limits, active lock protection, stale lock recovery, sync prompt/policy consistency and init/teardown; component tests use mocked hooks and APIs, which is not the same as browser testing;
- a real host was started in an isolated DSH_HOME with the desktop's bundled CLI: the capability-team preset registered and the diagnostics plugin activated; this is not acceptance of a session after the production desktop process reloaded;
- the `capability-team-overview` registration in the installed package and connected client was confirmed, but later source fixes still need confirmation that the running process reloaded;
- an independent browser got 401 from the GUI, so read, toggle, save and restore on an authenticated page have not been accepted yet;
- every tool's parameter schema passes DSH's own validation code;
- auto-matching was trial-run against the OpenRouter public catalog (450+ models) and matched the tier rules above;
- search, web fetch and embeddings were tested live against a real gateway locally (called through the Integrations config).

Not yet accepted in a real DSH session:

- whether per-member contexts appear in prompts;
- the native question dialog confirmation and save flow;
- per-request capability routing;
- failover under real failures (requires actually failing requests, which incurs paid calls);
- the dispatch confirmation card, task control panel and session rotation in a real desktop session (only component tests with mocked hooks so far);
- automatic memory ingestion and recall in a real DSH session (the gateway's vector endpoint was tested live, and hybrid search was verified locally against the real gateway).

Known limitations:

- Tiers are based on naming patterns and prices; new vendors (such as nvidia, stepfun, cohere) are currently listed as "unrecognized" and need a tier set manually.
- Free variants (`:free`, `-free`) never take part in auto-matching or serve as fallbacks.
- The native UI still shows teammates' internal ids; display names only apply in the model context.
- A rotation successor (`<role>-rN`) does not start step counting automatically (its predecessor used the dispatch's budget); start it in the task control area.
- Routes confirmed as "this task only" are kept in memory and revert to the project config after DSH restarts.

## License

[MIT](LICENSE)
