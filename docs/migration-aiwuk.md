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

Requirements: DSH `>=0.2.2-rc.1 <0.3.0` and Node.js >= 24.9. On an older DSH the host reports
`incompatible-version` and does not start the new packages; keep the old ones there.

## Steps for a personal install

`dsh plugin` always needs the profile: `dsh plugin --profile <profile> add|remove <package>`. The browser UI
profile is `web`; use the profile you actually run (`tui`, `headless`, ...). The examples below use `web`.

1. Stop DSH (a running session keeps the old plugin until it is recreated).
2. Install the new packages you use, from the same source you installed the old ones from (registry name, Hub
   tarball URL or `link:<dir>`):
   ```bash
   dsh plugin --profile web add @aiwuk/team
   dsh plugin --profile web add @aiwuk/search
   dsh plugin --profile web add @aiwuk/memory
   dsh plugin --profile web add @aiwuk/autocomplete
   ```
3. **Required in practice:** point the entries at the new names. Whenever you saved a setting, DSH wrote the
   package name into that entry of the profile patch (`<DSH home>/profiles/<profile>/cordis.patch.yml`). Until
   that `name:` is changed, the new bundle ignores your old settings and shows empty fields. Change only the
   `name:` values, never an `id` or `config`:
   `id: capability-team-ui` → `name: '@aiwuk/team'`, `id: autocomplete` → `name: '@aiwuk/autocomplete'`,
   `id: global-memory` → `name: '@aiwuk/memory'`, `id: omni-search` → `name: '@aiwuk/search'`.
4. In bundle lists or profile files that mention the routing plugin, replace `dsh-capability-team/roles` with
   `@aiwuk/team/roles`.
5. Remove the old packages:
   ```bash
   dsh plugin --profile web remove dsh-capability-team dsh-omni-search dsh-capability-memory dsh-capability-autocomplete
   ```
   The CLI removal does not check whether a bundle is in use. If you remove an old bundle from the Plugins page
   instead (Uninstall) and it reports `bundle-in-use`, disable the matching AIWUK bundle, uninstall the old one,
   then enable the AIWUK bundle again (no restart needed for the toggle).
6. Start DSH and check the Plugins page: only "AIWUK Team", "AIWUK Autocomplete", "AIWUK Memory" and "AIWUK Search"
   (Chinese: AI悟空 ...) are listed, and each settings page shows your previous values. Open a new session in the
   "AIWUK Team" mode.

While both the old and the new package are installed, the Plugins page lists both without any warning and both
claim the same Loader id. That is expected during the switch; finish steps 3 and 5 before you rely on the
settings shown. Instances managed by the AIWUK Mothership are migrated by the Connector automatically.

Secret values live in the credential store under the unchanged names, so nothing needs to be re-entered.

## Rollback

Before step 5 nothing is destroyed: disable the new bundle, re-enable the old one and restore the previous `name:`
values. After step 5, reinstall the old package from the source you originally used, then reverse the `name:`
edits and restart. The old names are NOT on the public npm registry, so `dsh plugin --profile web add
dsh-capability-team` fails with a 404 there; use your Hub tarball URL or a `link:` to a checkout of the old version:

```bash
dsh plugin --profile web add <old tarball URL or link:/path/to/old/checkout>
```

Verified on DSH 0.2.2-rc.1: after rollback by `link:` and reverting `name:`, the old plugins and their saved
settings return.

The credential store and data directories are untouched throughout.

## Future work

A first-run importer in `@aiwuk/team` is planned: it will detect profile entries that still pin an old package name
and offer a one-click "Migrate to AIWUK" action in the Plugins page. Until it ships, use the steps above. Fleet
instances managed by an AIWUK Mothership are migrated by the connector, not by hand.
