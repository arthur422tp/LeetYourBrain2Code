# v0.1.0 Release Package Audit

Audit date: 2026-09-20

## Clean build

The release output was rebuilt from the lockfile with:

```text
rm -rf dist release
npm ci
npm run build
```

The build completed successfully. `npm ci` reported one deprecated transitive
package warning (`whatwg-encoding`); it did not report an installation or
runtime failure.

## Package contents and size

The release package contains 18 files. The measured sizes from the clean build
are:

| Area | Bytes | Approximate size |
| --- | ---: | ---: |
| Uncompressed `dist/` | 12,819,964 | 14M |
| `dist/pyodide/` | 12,268,035 | 13M |
| ZIP archive | 5,643,868 | 5.4M |

Largest files:

- `dist/pyodide/pyodide.asm.wasm`: 9,280 KiB
- `dist/pyodide/python_stdlib.zip`: 3,136 KiB
- `dist/pyodide/pyodide.asm.js`: 1,088 KiB
- `dist/sidepanel/index.js`: 256 KiB
- `dist/worker/pyodide-worker.js`: 200 KiB
- `dist/pyodide/pyodide-lock.json`: 128 KiB

The generated archive is:

```text
release/leetcode-python-execution-visualizer-v0.1.0.zip
SHA-256: 52514bd71a5340cc85002665d440ee6d5ec66eeefcdb6323177483c9d7cd8d92
```

The ZIP is generated from `dist/` only, with sorted entries and fixed ZIP
metadata. Re-running `npm run release:zip` produced the same byte size and
SHA-256, and `unzip -t` reported no errors.

## Pyodide runtime decision

The built worker contains the bundled `loadPyodide` implementation. Its
runtime `indexURL` loads these local package assets:

- `pyodide/pyodide.asm.js`
- `pyodide/pyodide.asm.wasm`
- `pyodide/python_stdlib.zip`
- `pyodide/pyodide-lock.json`

The standalone `pyodide.mjs` entry is not copied into the release because Vite
bundles the import into `worker/pyodide-worker.js`; no shipped runtime code
references the standalone file. The Pyodide developer console pages were also
excluded. They are not referenced by the extension and contain CDN-hosted
scripts, which would be inappropriate in this local-only release package.

`release:check` verifies all four runtime assets and rejects executable remote
script URLs if the unused files are accidentally reintroduced.

## Dependency audit

Commands:

```text
npm audit --omit=dev
npm audit
```

Results:

| Scope | Result | Classification |
| --- | --- | --- |
| Runtime dependencies | 0 vulnerabilities | `pyodide` is the only production dependency. |
| Full dependency tree | 2 moderate findings | Both come from transitive `@vitest/mocker` through the dev-only `vitest` toolchain. |

The finding is [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9),
which concerns Vitest mock redirection and arbitrary file reads. It is not
reachable from the shipped extension runtime. `npm audit fix --force` proposes
Vitest 5.0.1, a breaking major upgrade, so it was not applied as part of this
release hardening pass. Track the dev-tool upgrade separately and rerun the
full test suite when it is evaluated.

## Secrets and debug-artifact review

The following searches were reviewed against source and the clean release
output:

- No API keys, access tokens, passwords, backend credentials, localhost
  endpoints, or WebSocket endpoints were found.
- The `secrets` import in `src/worker/python/runner.py` is Python's standard
  library and is used only to generate unpredictable internal instrumentation
  names such as `<lc-expr-…>`; it does not read or contain credentials.
- No `console.debug`, `console.trace`, debug dump, `.log` file, or source-map
  file is shipped. The background service worker retains one `console.warn`
  for a toolbar API failure so the extension can fail visibly during browser
  diagnostics.
- The release package contains no `src/`, `tests/`, `docs/`, `node_modules/`,
  `.git/`, or log paths. The package validator rejects those paths.
- The remote executable-code guard covers extension HTML and JavaScript and
  rejects literal remote `<script src>`, `import("https://…")`, and
  `importScripts("https://…")` forms.

No additional dependency upgrade or source-code deletion was made solely to
reduce audit or keyword counts.

