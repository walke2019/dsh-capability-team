# Migrating to AIWUK (5.0.0 / 1.0.0)

The four packages moved to the `@aiwuk` scope. Everything that identifies your configuration is kept:

| Old package | New package | Loader id (unchanged) |
|---|---|---|
| `dsh-capability-team` 4.x | `@aiwuk/team` 5.0.0 | `capability-team-ui` (preset `capability-team`) |
| `dsh-capability-autocomplete` 0.4.x | `@aiwuk/autocomplete` 1.0.0 | `autocomplete` |
| `dsh-capability-memory` 0.3.x | `@aiwuk/memory` 1.0.0 | `global-memory` |
| `dsh-omni-search` 0.3.x | `@aiwuk/search` 1.0.0 | `omni-search` |

Unchanged: tool names (`capability_*`, `memory_*`, `omni_*`), credential and environment variable names
(`OMNI_SEARCH_API_KEY`, `EMBEDDING_API_KEY`, `OPENVIKING_API_KEY`, `AUTOCOMPLETE_*`, ...), and data directories such
as `~/.dsh/capability-team-themes`. Overrides in `cordis.patch.yml` are keyed by the Loader `id`, so your settings
carry over; only the `name:` value of an entry that pins the old package name needs to change.

Requirements: DSH `>=0.2.2-rc.1 <0.3.0` and Node.js >= 22. On an older DSH the host reports
`incompatible-version` and does not start the new packages; keep the old ones there.

## Steps for a personal install

1. Stop active sessions (a running session keeps the old plugin until it is recreated).
2. Install the new packages (only the ones you use):
   ```bash
   dsh plugin add @aiwuk/team
   dsh plugin add @aiwuk/search
   dsh plugin add @aiwuk/memory
   dsh plugin add @aiwuk/autocomplete
   ```
3. Point the entries at the new names. If your profile patch (`cordis.patch.yml` in the profile directory) pins
   `name:` for an entry, change only that value, for example `id: capability-team-ui` → `name: '@aiwuk/team'`,
   `id: autocomplete` → `name: '@aiwuk/autocomplete'`, `id: global-memory` → `name: '@aiwuk/memory'`,
   `id: omni-search` → `name: '@aiwuk/search'`. Do not change any `id` or `config`. Entries that you never pinned
   take the new name from the new bundle.
4. In bundle lists or profile files that mention the routing plugin, replace `dsh-capability-team/roles` with
   `@aiwuk/team/roles`.
5. Disable the old bundles, then remove them:
   ```bash
   dsh plugin remove dsh-capability-team
   dsh plugin remove dsh-capability-autocomplete
   dsh plugin remove dsh-capability-memory
   dsh plugin remove dsh-omni-search
   ```
   If a removal reports that the bundle is in use, disable the dependent entry first and retry.
6. Restart DSH and open a new session in the "capability team" mode. Check the Plugins page: the titles are
   "AIWUK Team", "AIWUK Autocomplete", "AIWUK Memory" and "AIWUK Search" (Chinese: AI悟空 ...).

Secret values live in the credential store under the unchanged names, so nothing needs to be re-entered.

## Rollback

Before step 5 nothing is destroyed: disable the new bundle, re-enable the old one and restore the previous `name:`
values. After step 5, reinstall the old name (the old packages stay published) and reverse the `name:` edits:

```bash
dsh plugin add dsh-capability-team
```

The credential store and data directories are untouched throughout.

## Future work

A first-run importer in `@aiwuk/team` is planned: it will detect profile entries that still pin an old package name
and offer a one-click "Migrate to AIWUK" action in the Plugins page. Until it ships, use the steps above. Fleet
instances managed by an AIWUK Mothership are migrated by the connector, not by hand.
