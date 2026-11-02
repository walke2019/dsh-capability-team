# Development guide

This guide is for contributors. For the authoritative collaboration, file, security, and token policies, see [AGENTS.md](../AGENTS.md).

## Development and tests

Install/use a supported Node.js runtime (22 or newer). The project uses the built-in `node:test` runner and mocked DSH contexts, catalogs, and dialogs; automated tests do not make live model or search calls.

```sh
npm test          # build client.js, then run tests
npm run lint      # syntax and repository consistency checks
npm run build     # check package closure and published files
npm run build:client  # rebuild the client bundle
```

Tool-schema tests verify the registered tool JSON schemas. Integration behavior against real external services is not implied by mocked tests.

## Verification status and known limitations

The documented baseline is 403 root + 26 omni-search + 23 global-memory passing tests with zero failures (`npm test` runs all three suites). Unit tests use mocked host APIs and do not replace interactive browser/Desktop acceptance. Optional gateways, audio, and shared memory require user-supplied endpoints and credentials; their availability is environment-dependent. Read the latest task/CI results rather than treating this baseline as a claim that every integration is live-verified.

## File and context rules: summary

- Keep source modules focused; consider splitting at 300 lines and do not exceed 500 lines. Tests have an 800-line ceiling.
- Oversized existing files may only shrink. Do not directly edit generated bundles.
- For large files, search headings/identifiers first and read bounded sections. Edit existing files locally rather than replacing them wholesale.
- Keep outputs and reports concise; sensitive data must not enter prompts, logs, docs, or test fixtures.

The full enforceable file, token, and collaboration rules are in [AGENTS.md](../AGENTS.md).

## Client build

The workbench source is organized under `client/`. Run `npm run build:client` to concatenate the source modules in filename order into the shipped `client.js`. The package exposes the single bundle to DSH; edit source modules, then rebuild rather than editing the generated bundle directly.

## Release file inventory

The package manifest’s published `files` list is authoritative. It includes the plugin entry modules (roles, configuration, routing, policies, workflow, memory, integrations and task control), `client.js` and client sources, locale files, the role/theme skill, README files, license, tests and fixtures, build/check scripts, and `cordis.patch.yml`. Run `npm run build` before release to check the package closure and published file set.
