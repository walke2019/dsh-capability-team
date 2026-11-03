# Comparison

**English** | [简体中文](comparison.zh-CN.md)

This page compares Capability Team with the other ways of running agents in DSH. It aims to be fair: the preset is built on the official DSH Agent Teams and would not work without them.

## Approaches compared

- **Single agent** — one DSH session (optionally with native generic subagent tools). Simple and cheap to start, but every step runs on the session's model.
- **Official DSH Agent Teams** — the `@deepseek-ai/dsh-experimental-agent-team-profile` bundle. It provides the team runtime: the `agentTeams` service, teammate lifecycle (`spawn_teammate`, `wait_agent`, `interrupt_agent`, `list_agents`), peer-to-peer messaging (`send_message`), the shared `team_task_*` board with dependencies and optimistic revisions, usage projections and the Team UI.
- **Generic model-routing plugins** — plugins that pick a model per request (for example by prompt size, keywords or cost rules), usually for one agent, without knowledge of team roles or the task board.
- **Capability Team (this preset)** — a policy layer on top of the official Agent Teams: roles, tier routing, failover, dispatch triage, guardrails and a workbench.

## Feature matrix

| Capability | Single agent | Official Agent Teams | Generic routing plugin | Capability Team |
|---|---|---|---|---|
| Team lifecycle, messaging | — | ✅ | — | ✅ reuses official |
| Shared task board with dependencies | — | ✅ | — | ✅ reuses official, adds DAG check and auto-created tasks |
| Per-role model routing | — | No per-role choice; all teammates use the profile's spawn provider | Per request, not per role | ✅ Per role, by capability tier |
| Automatic model matching | — | — | Varies (usually explicit rules) | ✅ From your registered DSH models by vendor naming rules |
| Fail closed when no qualifying model | — | — | Varies | ✅ |
| Same-tier failover | — | — | Varies; often any fallback | ✅ Same tier only, exponential cooldown (max 30 min) |
| Auth / quota errors | Native retries | Native retries | Varies | ✅ Switch immediately to the next same-tier backup |
| Cost controls | — | Usage projections | Model choice by cost | ✅ Tier routing, per-role token budgets, token discipline |
| Dispatch triage | — | — | — | ✅ `delegate` / `free` / `direct` dispatch plan |
| Write-scope enforcement | — | — | — | ✅ Per-task `write_scopes` |
| Per-role sandbox / tool / path access | Profile-wide presets | Profile-wide presets | — | ✅ Per role, using official presets |
| Plan-first approval | — | — | — | ✅ Optional per role |
| Session rotation and handoff | — | — | — | ✅ Soft/hard thresholds, successor inherits route and tasks |
| Team memory recall | — | — | — | ✅ Local memory hub, optional shared backend |
| Workbench | Chat only | Team UI | — | ✅ Overview, board, usage, model management, pixel office stage |

"Varies" means it depends on the specific plugin; check its documentation.

## When to use which

- **Single agent:** quick questions and small, single-file changes. Lowest overhead.
- **Official Agent Teams alone:** you want parallel teammates and a shared board, and are happy to manage models and policies yourself.
- **Generic routing plugin:** you mainly want to cut cost for one agent by sending simple prompts to cheaper models.
- **Capability Team:** multi-step projects where different roles deserve different models, where a provider outage must not stop the work, and where you want plans, write scopes and budgets enforced rather than suggested.

## Trade-offs

- Enabling the official Agent Teams bundle affects every session in the profile and disables DSH's native generic subagent tools.
- Tier matching depends on vendor naming conventions. Unknown model ids are reported rather than guessed, so a catalog of unusual names may leave roles unassigned; you can then assign models explicitly or accept single-model mode.
- Same-tier failover needs at least two models of that tier in your catalog. With only one, there is no backup to switch to, and the preset still does not downgrade to another tier.
- Planning, confirmation and board bookkeeping add some steps compared with a single agent; for one-step work the lead may handle it directly (`direct`).

See the [configuration reference](configuration.md) for the exact policies and defaults.
