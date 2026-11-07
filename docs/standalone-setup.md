# Setting up AIWUK Search, Memory and Autocomplete

[简体中文](standalone-setup.zh-CN.md)

There are two ways to run these extensions. Pick the one that matches how the machine got them.

| How it was installed | Who configures it | What you see on the plugin page |
|---|---|---|
| Through an **AIWUK Mothership** (fleet) | The Mothership. URLs, models, engine lists and every API key are pushed to the instance; nothing has to be set locally. | A green notice "Configured by AIWUK Mothership", the managed values shown read-only, and keys shown as "Configured by AIWUK Mothership". Settings the Mothership does not send are folded under "Optional settings". |
| **On its own** (`dsh plugin add …`) | You, on the plugin page (or the environment / integrations file). | Plain fields and write-only key rows. |

On a managed machine, change settings in the Mothership console (Models page → Managed extension config), not on the instance. Locked rows cannot be edited locally; the lock is a policy signal, not a security boundary.

## Standalone install

```bash
dsh plugin add @aiwuk/search        # multi-engine web search, page fetch, audio transcription
dsh plugin add @aiwuk/memory        # explicit memory tools and bounded recall
dsh plugin add @aiwuk/autocomplete  # inline input completion
```

Then open DSH → **Plugins** → the extension, fill in the fields below and press **Save**. Keys use **Set**; they are written to DSH's credential store and never shown again.

Every name below can also be supplied as an environment variable of the DSH process or as a same-named DSH credential. Precedence (highest first): locked Mothership value › plugin page › DSH credential › environment › `integrations.json` › unlocked Mothership default › built-in default.

### AIWUK Search (`@aiwuk/search`)

Works with zero configuration only for tools that need no key. Configure at least one search engine:

| Goal | Set these | Notes |
|---|---|---|
| Your own gateway (recommended for teams) | `OMNI_SEARCH_ENGINES=custom`, `OMNI_SEARCH_BASE_URL`, key `OMNI_SEARCH_API_KEY`; optional `OMNI_SEARCH_PROVIDERS_PATH` | Any gateway speaking `/v1/search` and `/v1/web/fetch`. https only. |
| Hosted engines | `TAVILY_API_KEY` and/or `BRAVE_API_KEY` | Engines without a key are skipped. |
| Self-hosted SearXNG | `SEARXNG_URL` (https, or http on this machine), optional `SEARXNG_API_KEY` | |
| Page fetch | `OMNI_FETCH_ENGINES` (`jina`, `tavily`, `custom`), key `JINA_API_KEY` for Jina | Default `jina`. |
| Speech to text | `OMNI_AUDIO_BASE_URL`, key `OMNI_AUDIO_API_KEY` | Every transcription still asks the user for consent per file. |

Optionally switch on "Use AIWUK Search for DSH web search" so DSH's built-in `web_search` uses it.

### AIWUK Memory (`@aiwuk/memory`)

Zero configuration is fully local (full-text search, nothing leaves the machine). Optional upgrades:

| Goal | Set these |
|---|---|
| Semantic recall | `EMBEDDING_BASE_URL` (https), `EMBEDDING_MODEL`, key `EMBEDDING_API_KEY`; optional `EMBEDDING_DIMENSIONS` |
| Shared memory across machines | `MEMORY_BACKEND=openviking`, `OPENVIKING_URL`, key `OPENVIKING_API_KEY`; `MEMORY_SHARED_RECALL=none` to search the whole shared account |

### AIWUK Autocomplete (`@aiwuk/autocomplete`)

No keys. By default it follows the model of the current session. To use a fixed, cheap model set `AUTOCOMPLETE_ROUTE_MODE=fixed`, `AUTOCOMPLETE_PROVIDER` (a provider **ID** already configured in DSH, never a key) and `AUTOCOMPLETE_MODEL`.

## Verify

- Search: in a new session ask "search the web for <topic>"; `omni_search` returns results, or a clear error naming the missing setting.
- Memory: ask the agent to remember a fact with `memory_write`, then recall it with `memory_search`.
- Autocomplete: type in the input box and pause; ghost text appears, `Tab` accepts it. It never sends by itself.

## Instructions for an AI agent

Use this section when a user asks an agent (DSH, Claude Code, Codex, …) to configure these extensions on a standalone machine.

1. **Detect the mode first.** If the plugin page shows "Configured by AIWUK Mothership", or `~/.dsh/aiwuk/managed-config.json` exists, the machine is managed: do not change local settings; tell the user to change them in the Mothership console. Stop.
2. **Ask for, never invent, endpoints and keys.** Ask the user which engines/providers they use and for each URL. Never guess vendor URLs or reuse keys from other projects.
3. **Never write a key into a file, a command line, a log or the chat transcript.** Ask the user to paste keys into the plugin page's **Set** field themselves, or to export them as environment variables of the DSH process. URLs, model ids and engine lists are not secret and may be set for them on the plugin page.
4. **Use exact names** from the tables above. Lists are comma-separated (`OMNI_SEARCH_ENGINES=brave,custom`). Remote URLs must be `https://`; plain `http://` is accepted only for a server on the same machine (`127.0.0.1`, `localhost`).
5. **Changing engine lists or provider paths** rebuilds tool schemas on the next credential refresh; reload the plugin (or restart DSH) if the tool list looks stale.
6. **Verify with the checks above** and report the actual tool output. A configured gateway does not prove its upstream providers work; report errors verbatim (they never contain key values).
