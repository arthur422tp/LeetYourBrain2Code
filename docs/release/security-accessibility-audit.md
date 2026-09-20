# v0.1.0 Security and Accessibility Release Audit

Audit date: 2026-09-20  
Reviewed revision: `92ab8e6` (`docs: add project license`)  
Scope: shipping Manifest V3 runtime, release build/package checks, source-to-page messaging, Pyodide worker boundary, and Side Panel UI source.

## Review method and limits

This is a release-readiness audit of the current repository state. The review used the existing release tests and package guard, direct source inspection, local `rg` searches for remote execution, credentials, storage, network, and DOM injection surfaces, and the Codex Security Standard workflow.

The Codex Security scan was run as a prompt-only Standard scan. Preflight was `ready` with a documented degraded warning: no delegated worker was available and the active worker-slot count was unknown. The independent baseline review was therefore unavailable; the primary thread performed the architecture and source review. Daybreak access was `not_granted`, which is advisory and does not change the source-review result or authorize any additional access.

Task 13's interactive Chrome smoke matrix and Task 14's screenshot capture are separate gates. This document records static accessibility evidence only; it does not claim that those browser/manual gates have been completed.

## Security audit

| Control | Result | Evidence and review note |
| --- | --- | --- |
| No remote executable code | PASS | The runtime resolves Pyodide from the bundled extension-relative `pyodide/` directory (`src/worker/pyodide-runtime.ts:92-95`, `src/worker/pyodide-runtime.ts:1187-1202`). The release guard scans built HTML/JS for remote `<script src>`, `import("https://…")`, and `importScripts("https://…")` (`scripts/release-check.mjs:114-211`, `scripts/release-check.mjs:270-280`). The final package check passed during Task 9. The GitHub privacy-policy link is an ordinary user-facing anchor, not executable code. |
| No unnecessary permissions | PASS | The source manifest contains only `sidePanel` and `scripting` (`public/manifest.json:25-27`), and `scripts/release-check.mjs:220-249` requires the exact permission, host, content-script, background, icon, and CSP configuration. |
| Host permission remains LeetCode-only | PASS | `public/manifest.json:29-30` and both content-script match entries (`public/manifest.json:35-46`) are restricted to `https://leetcode.com/*`. Runtime tab ownership additionally requires the exact `https://leetcode.com` origin (`src/sidepanel/active-tab-source.ts:53-60`). |
| MAIN-world bridge message surface is minimal | PASS | The MAIN-world bridge reads page state and answers only the documented page-state request/update message types (`src/page-bridge/leetcode-main-world.ts:83-153`). It does not access `chrome.*` APIs or perform privileged operations. The content script and bridge use a fixed message source/type plus request IDs (`src/content/leetcode-adapter.ts:307-367`). |
| Content-script message handling validates shape and source assumptions | PASS | Window messages check source window, origin, object shape, fixed source/type, request ID, and validated page state (`src/content/content-script.ts:13-40`, `src/content/leetcode-adapter.ts:328-350`). Runtime messages require the active LeetCode tab and a validated state (`src/sidepanel/active-tab-source.ts:312-333`). Page-state validation bounds code, testcase, and language lengths and validates metadata (`src/content/leetcode-page-state.ts:1-63`). |
| User Python runs in a worker, not the privileged extension UI context | PASS | The Side Panel creates a dedicated module worker for `worker/pyodide-worker.js` (`src/execution/execution-controller.ts:98-110`). The worker receives only the typed `execute` message and returns typed trace/result messages (`src/worker/pyodide-worker.ts:77-124`, `src/shared/worker-protocol.ts:58-79`, `src/shared/worker-protocol.ts:677-684`). User code is executed by the Pyodide runtime inside that worker (`src/worker/python/runner.py:496-525`). |
| Worker cannot directly access privileged Chrome extension APIs | PASS | The worker entrypoint exposes a worker scope with `addEventListener`, `removeEventListener`, and `postMessage` only (`src/worker/pyodide-worker.ts:11-21`); it has no `chrome.*` import or API call. Chrome tab/scripting access is kept in the Side Panel tab source (`src/sidepanel/active-tab-source.ts:29-140`). |
| No credentials or secrets | PASS | Source and shipping-package searches found no private-key material, API-key/token/password assignments, credential headers, analytics endpoints, or extension storage. The Python `secrets` import in `src/worker/python/runner.py:1-10` is used only for random internal instrumentation names (`src/worker/python/runner.py:337-348`), not for credentials. Task 9 also recorded a clean source secret/debug review. |
| CSP remains constrained to required WASM support | PASS | The manifest permits only same-origin scripts, `wasm-unsafe-eval` for bundled Pyodide, and same-origin objects (`public/manifest.json:48-50`). The release guard rejects any CSP drift (`scripts/release-check.mjs:247-249`). |
| Hardened sandbox claim | NOT CLAIMED | The product uses a dedicated worker as an execution containment boundary, but it does not claim a hardened sandbox. The runtime intentionally compiles and executes the captured Python program (`src/worker/python/runner.py:414-425`, `src/worker/python/runner.py:496-500`). The Store/release copy must preserve this limitation and must not describe the worker as OS-level isolation or a security boundary for hostile third-party code. |

### Security conclusion

No reportable security finding was established in the reviewed release surfaces. The main residual security assumption is explicit product scope: the extension visualizes code selected from the user's active LeetCode page and executes it locally. The worker boundary is an engineering containment choice, not a hardened sandbox promise.

## Accessibility audit

This section is a static implementation review. Browser focus traversal, zoom, high-contrast behavior, and assistive-technology announcements remain part of the manual Chrome gate.

| Requirement | Result | Evidence and review note |
| --- | --- | --- |
| Toolbar entry understandable | PASS (static) | The action title identifies both the LeetCode scope and the Python visualizer (`public/manifest.json:14-19`); the background service worker opens the Side Panel on toolbar action (`src/background/service-worker.ts:1-10`). |
| Onboarding/recovery controls keyboard reachable | PASS (static) | The primary action is a native button with an explicit `type` and text (`src/sidepanel/bootstrap.ts:218-221`). Recovery reuses that button as a visible `Retry` action (`src/sidepanel/bootstrap.ts:314-320`), and onboarding/recovery content is textual (`src/sidepanel/components/ReleaseOnboarding.ts:42-88`, `src/sidepanel/components/RecoveryNotice.ts:12-38`). |
| Visible focus | PASS (static; manual browser check pending) | The stylesheet does not remove the browser focus outline from native buttons, selects, links, or summaries. Read-only textareas also have an explicit focus border/outline (`src/sidepanel/styles.css:316-319`). Task 13 must confirm the resulting focus visibility in the production Side Panel. |
| `button` used for actions | PASS | Run, retry, baseline, trace navigation, visualizer inspection, matrix controls, and Call Tree controls are native buttons with `type="button"`; representative examples are `src/sidepanel/bootstrap.ts:218-221`, `src/sidepanel/components/BaselineControls.ts:24-35`, and `src/sidepanel/components/CallFrameStory.ts:188-243`. |
| `details/summary` remains keyboard usable | PASS (static) | Input, privacy, trace panels, and loop disclosures use native `details`/`summary` elements (`src/sidepanel/bootstrap.ts:180-185`, `src/sidepanel/components/AboutPrivacy.ts:8-13`, `src/sidepanel/components/TraceVisualizer.ts:70-85`, `src/sidepanel/components/TraceOutline.ts:47-63`). No custom keyboard replacement removes the native disclosure control. |
| Status messages are textual | PASS | Live status is updated with readable text (`src/sidepanel/bootstrap.ts:327-367`); recovery, onboarding, baseline, and behavioral-diff messages are text nodes. The behavioral diff additionally uses `aria-live="polite"` (`src/sidepanel/components/BehavioralDiff.ts:46-51`). |
| Baseline/Current diff is not color-only | PASS | The diff renders explicit `Baseline` and `Current` headings and factual text/source/step content (`src/sidepanel/components/BehavioralDiff.ts:68-99`), with an explicit `Inspect current` button where applicable (`src/sidepanel/components/BehavioralDiff.ts:101-106`). Color and borders are supplementary styling. |
| Call Tree disclosure remains accessible | PASS | The Call Tree has a textual heading, native list structure, labeled frame buttons, and disclosure buttons exposing `aria-expanded` plus an action label (`src/sidepanel/components/CallFrameStory.ts:320-377`, `src/sidepanel/components/CallFrameStory.ts:188-243`). |
| Side Panel scrolling does not trap keyboard focus | PASS (static; manual browser check pending) | Long code, matrix, list, and linked-list surfaces use ordinary nested scrolling (`src/sidepanel/styles.css:626-637`, `src/sidepanel/styles.css:1355-1362`, `src/sidepanel/styles.css:1531-1536`, `src/sidepanel/styles.css:941-946`). No focus trap, `tabindex` loop, or keyboard event interception was found. Task 13 must confirm keyboard traversal while nested scroll regions are present. |

## Automated regression decision

No focused test was added for Task 12 because the audit found no concrete failure. Existing tests already cover the relevant message, tab-ownership, worker-protocol, release-manifest/package, onboarding/recovery, diff, Call Tree, and trace-outline behavior, including:

- `tests/execution/content-script.test.ts`
- `tests/execution/leetcode-adapter.test.ts`
- `tests/execution/pyodide-worker.test.ts`
- `tests/protocol/worker-protocol.test.ts`
- `tests/sidepanel/active-tab-source.test.ts`
- `tests/sidepanel/release-onboarding.test.ts`
- `tests/sidepanel/recovery-notice.test.ts`
- `tests/sidepanel/behavioral-diff.test.ts`
- `tests/sidepanel/call-frame-story.test.ts`
- `tests/sidepanel/trace-outline.test.ts`
- `tests/release/manifest.test.ts`
- `tests/release/package-validation.test.ts`

Verification for this task is recorded by the existing TDD suite, typecheck, production build, and `npm run release:check`; the manual browser/screenshot gates remain intentionally separate.
