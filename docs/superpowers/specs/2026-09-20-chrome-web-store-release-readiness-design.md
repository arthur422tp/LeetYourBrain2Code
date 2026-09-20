# Chrome Web Store Release Readiness

## Design Spec v0.1

**Date:** 2026-09-20  
**Status:** Proposed  
**Target release:** LeetCode Python Execution Visualizer v0.1.0  
**Primary goal:** Move the project from owner-tested developer build to a release candidate suitable for Chrome Web Store submission without adding another major product capability.

---

# 1. Release Decision

The project has reached feature sufficiency for an initial public release.

The next milestone is **not another visualization feature**.

Freeze major feature scope and harden the current product around:

```text
installability
→ discoverability
→ first-run usability
→ privacy / permission transparency
→ failure recovery
→ reproducible packaging
→ Chrome Web Store submission readiness
```

The release candidate should preserve the current product identity:

> A LeetCode-native Python visual debugger that shows what the user's code actually did.

Do not broaden v0.1 into:

- a solver;
- judge integration;
- AI assistance;
- cloud sync;
- account/login;
- telemetry-heavy analytics;
- another visualization family;
- Case-to-Case diff;
- arbitrary historical run storage.

---

# 2. Current Readiness Snapshot

As of this spec:

## Product / runtime

Already strong:

- live editor/testcase synchronization;
- latest-wins local execution;
- Pyodide in Web Worker;
- list / matrix / linked-list / tree / graph visualization;
- Decision / Expression / Mutation evidence;
- Control-Flow Execution Story;
- Call Tree / recursion evidence;
- Behavioral Signals / Timeline / Trace Outline;
- Failure-First entry point;
- pinned baseline Cross-Run Behavioral Diff;
- evidence-first boundaries;
- extensive automated regression suite;
- CI, typecheck, and production build.

## Release surface gaps

Current repo observations:

- `public/manifest.json` has no `description`;
- no manifest `icons`;
- no `action` metadata / toolbar icon;
- `public/` currently contains only `manifest.json`;
- no committed `PRIVACY.md`;
- no committed `LICENSE`;
- no explicit release/package script;
- no generated ZIP validation gate;
- no manifest/static package validation test;
- no Chrome Web Store listing asset set;
- no release checklist;
- no first-install / first-run onboarding artifact;
- no public support / bug-reporting path documented in-product.

These are now higher priority than new feature development.

---

# 3. Chrome Web Store Constraints

The release must be designed around the following official Chrome Web Store requirements and guidance.

## 3.1 Single purpose

The extension's single purpose should be stated narrowly:

> Visualize and compare the local execution behavior of the Python code and testcase currently open on LeetCode.

All requested permissions and Store listing claims should map directly to that purpose.

Official reference:
https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines

## 3.2 Minimum permissions

Chrome Web Store policy requires the narrowest permissions necessary.

Current permissions:

```json
"permissions": [
  "sidePanel",
  "scripting"
],
"host_permissions": [
  "https://leetcode.com/*"
]
```

This is appropriately narrow if:

- `sidePanel` is required for the persistent visual debugger UI;
- `scripting` is demonstrably required for exact-tab bridge recovery / injection;
- LeetCode host access remains limited to `https://leetcode.com/*`.

Do not add broad permissions for future features.

Official reference:
https://developer.chrome.com/docs/webstore/program-policies/permissions

## 3.3 Privacy disclosure

The extension handles user data in the broad Chrome Web Store policy sense because it reads:

- code typed into LeetCode;
- testcase text;
- LeetCode problem identity/page state;
- derived local runtime trace/state.

Even if all of this stays local, release materials must accurately disclose handling.

Official references:
https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
https://developer.chrome.com/docs/webstore/program-policies/limited-use

## 3.4 Remote code

All executable logic must remain packaged with the extension.

Current bundled Pyodide strategy is release-compatible in principle:

```text
node_modules/pyodide
→ copied into dist/pyodide
→ extension-local Web Worker runtime
```

Do not switch to a CDN-hosted Pyodide runtime for release.

Official reference:
https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements

## 3.5 Store assets

At minimum prepare:

- extension/store icon;
- at least one real product screenshot;
- Store listing description;
- privacy fields;
- permission justifications.

Prefer a complete first-release asset set rather than minimum-only submission.

Official reference:
https://developer.chrome.com/docs/webstore/best-listing

---

# 4. Release Philosophy

v0.1 should optimize for:

```text
trust
clarity
recoverability
predictability
```

not feature breadth.

A public user should be able to answer these questions without reading the repository:

1. What does this extension do?
2. Why does it need access to LeetCode?
3. Does my code leave my machine?
4. How do I open it?
5. Why is there no visualization yet?
6. What does “completed” mean?
7. What should I do if LeetCode changed and sync stopped?
8. How do I report a bug?

---

# 5. P0 Release Gate: Manifest Identity

Before Store submission, `manifest.json` must contain a complete product identity.

Recommended direction:

```json
{
  "manifest_version": 3,
  "name": "LeetCode Python Execution Visualizer",
  "short_name": "LC Visualizer",
  "version": "0.1.0",
  "description": "Visualize how your Python code actually executes on LeetCode with local step-by-step runtime evidence."
}
```

Exact copy may be refined, but:

- name remains recognizable;
- description stays factual;
- no claims of solving/correctness;
- version matches package/release metadata.

Add:

```json
"icons": {
  "16": "icons/icon16.png",
  "32": "icons/icon32.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png"
}
```

Chrome explicitly recommends at least 16/48/128 and a 128px icon for Store/install use.

---

# 6. P0 Release Gate: Toolbar / Side Panel Entry

The product currently relies on Chrome's Side Panel discovery.

For a public release, provide a recognizable action entry.

Recommended:

```json
"action": {
  "default_title": "Open LeetCode Python Execution Visualizer",
  "default_icon": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png"
  }
}
```

Then choose one of two release-safe behaviors:

## Option A — minimal release

Use the action only as identity/entry metadata and rely on Chrome's normal Side Panel access.

## Option B — preferred UX

Add a small extension service worker that configures:

```ts
chrome.sidePanel.setPanelBehavior({
  openPanelOnActionClick: true
});
```

This makes the toolbar icon an obvious open/close affordance.

If Option B is selected:

- service worker must contain no unrelated functionality;
- no background polling;
- no new host permissions;
- add lifecycle tests.

Preferred release direction: **Option B**.

---

# 7. P0 Release Gate: Icon / Brand Asset

Create one simple visual identity suitable for:

- 16px toolbar;
- 32px high-density toolbar;
- 48px extension management;
- 128px Chrome Web Store / installation.

Requirements:

- simple silhouette;
- readable at 16px;
- no tiny code text;
- no LeetCode trademark/logo imitation;
- transparent PNG;
- same identity across Store screenshots/listing.

Do not block release on sophisticated branding.

One clean icon is enough.

---

# 8. P0 Release Gate: Privacy Policy

Add:

```text
PRIVACY.md
```

The policy should state clearly:

## Data accessed

The extension reads, only on LeetCode:

- current Python editor source;
- visible testcase content;
- problem metadata required to associate runs with the active problem.

## Derived data

Locally creates:

- execution trace;
- runtime snapshots;
- expression/decision/control-flow evidence;
- baseline/current comparison state.

## Transmission

For v0.1:

> The extension does not send LeetCode code, testcase content, runtime traces, or comparison data to the developer or a remote backend.

If that remains true, say it directly.

## Storage

Current v0.1 comparison/baseline state is memory-only unless implementation changes.

Disclose whether anything uses:

- `chrome.storage`;
- IndexedDB;
- localStorage;
- remote storage.

If none are used, state that no persistent user-code history is intentionally stored.

## Third parties

Pyodide is packaged locally.

No runtime third-party analytics should be added for v0.1.

## Contact

Provide one support/security contact path.

A GitHub Issues URL is acceptable as a support path, but privacy policy should also identify the project/developer sufficiently for users.

---

# 9. P0 Release Gate: In-Product Privacy Disclosure

Because the product reads editor/testcase content, public users should not need to infer the privacy model.

Add compact first-run/help disclosure:

```text
Runs locally

This extension reads the Python code and testcase on the active LeetCode page
to build the visualization. Execution uses bundled Pyodide in your browser.
Your code and testcase are not sent to a backend.
```

This may live in:

- a first-run onboarding card;
- a collapsed “About & privacy” block;
- both.

Do not show a modal on every launch.

No dark pattern consent flow.

---

# 10. P0 Release Gate: Store Privacy Practices

Prepare exact Developer Dashboard answers before submission.

Single purpose:

> Visualize and compare the local runtime behavior of Python solutions and testcases on LeetCode.

Permission justification:

## sidePanel

> Displays the execution visualizer alongside the active LeetCode problem so users can inspect code execution without leaving the problem page.

## scripting

> Re-establishes the LeetCode page bridge for the exact active tab when needed so the extension can read the current editor/testcase state reliably.

## host permission — leetcode.com

> Reads the active LeetCode problem's Python editor, testcase controls, and problem metadata required for the user-facing visualization.

Data handling statement must match implementation and `PRIVACY.md`.

Do not overclaim “collects no data” if the Dashboard interprets local access/handling as data handling.

Prefer:

> Processes the required code/testcase data locally and does not transmit it to the developer or third parties.

---

# 11. P0 Release Gate: License Decision

The GitHub repository is public but currently has no committed license.

Before public promotion, make an explicit licensing decision.

Recommended for this project if the intent is open source:

```text
MIT
```

Alternative:

```text
Apache-2.0
```

This is a repository/legal distribution decision, not a Chrome Web Store technical requirement.

Do not silently add a license during implementation without the owner's explicit choice.

Release may technically proceed without an open-source license, but the public repo then remains source-visible rather than openly licensed.

---

# 12. P0 Release Gate: Dependency and Package Audit

The release package must contain only what the extension needs.

Current build copies the complete installed `pyodide` package recursively.

Before submission:

- inspect `dist/pyodide`;
- confirm no development-only package artifacts are unnecessarily shipped;
- measure final ZIP size;
- ensure no source secrets, test fixtures, logs, or node modules outside required Pyodide runtime are packaged;
- ensure all executable runtime assets are extension-local;
- ensure no source maps disclose more than intended if source maps are ever enabled.

Do not optimize package size blindly if doing so risks breaking Pyodide.

First establish deterministic package contents.

---

# 13. P0 Release Gate: Release Build Script

Add an explicit release path separate from ad hoc developer build.

Recommended scripts:

```json
{
  "scripts": {
    "validate": "npm test && npm run typecheck && npm run build",
    "release:check": "...",
    "release:zip": "..."
  }
}
```

Expected workflow:

```text
clean
→ npm ci
→ tests
→ typecheck
→ build
→ manifest/package validation
→ create deterministic release ZIP
→ print package summary
```

Output:

```text
release/leetcode-python-execution-visualizer-v0.1.0.zip
```

Do not commit generated ZIPs to `main`.

---

# 14. P0 Release Gate: Manifest / Package Validation

Create a release validation script/test that fails when:

- manifest is invalid JSON;
- manifest version is not 3;
- package version and manifest version disagree;
- required icon files are missing;
- side panel entry file is missing;
- declared content script file is missing;
- declared service worker/action assets are missing;
- bundled Pyodide entry assets are missing;
- unexpected remote script URLs appear in extension HTML/JS configuration;
- release ZIP contains `node_modules/`, tests, source specs, or logs at root;
- package contains no manifest.

This should run in CI.

---

# 15. P0 Release Gate: First-Run Onboarding

A new user does not know the developer workflow.

Create a compact onboarding state shown when:

```text
extension is open
+
active page is LeetCode
+
no accepted trace has been captured yet
```

It should explain only:

```text
1. Open a LeetCode problem.
2. Select Python.
3. Enter or choose a testcase.
4. Start typing — visualization updates automatically.
```

Also state local execution/privacy.

Do not create a multi-page tutorial.

Once normal execution begins, onboarding disappears.

---

# 16. P0 Release Gate: Non-LeetCode State

Current paused state:

```text
Live: paused · No active LeetCode tab
```

For public release, make it actionable:

```text
Open a LeetCode problem to start visualizing Python execution.
```

Optional button:

```text
Open LeetCode
```

Avoid opening tabs automatically without user action.

---

# 17. P0 Release Gate: Unsupported-Language State

The current product is Python-only.

If a user opens Java/C++/JavaScript:

Do not leave them with a vague syncing state.

Required explicit state:

```text
Python required

This release visualizes Python solutions only.
Switch the LeetCode editor language to Python to continue.
```

No silent failure.

---

# 18. P0 Release Gate: Recovery UX

Public users will hit stale LeetCode DOM / content-script problems.

Current error copy already handles connection failures.

Release hardening should standardize recoverable states:

```text
Unable to connect to this LeetCode tab
→ Refresh the LeetCode page and reopen the Side Panel.

Waiting for editor
→ LeetCode editor has not mounted yet.

Waiting for testcase
→ Open or enter a testcase.

Unsupported language
→ Switch to Python.

Local execution timeout
→ Show captured prefix; explain local runtime limit.

Internal worker/runtime failure
→ Preserve latest stable visualization when safe and expose Retry.
```

Add a user-triggered Retry / Run now path when recovery is possible.

---

# 19. P0 Release Gate: Failure Containment

A bad current draft must not destroy the last useful debugging context unnecessarily.

Existing behavior already preserves prior visualization in some waiting states.

Formalize release behavior:

- source/testcase syncing failure does not wipe last successful visualization;
- unsupported language does not fabricate current output;
- worker exception produces explicit state;
- trace/runtime limits retain captured prefix;
- new fatal UI render error should fail one panel where possible, not blank the entire Side Panel.

Do not introduce a large new error-boundary framework unless needed.

---

# 20. P0 Release Gate: Smoke-Test Matrix

Automated unit tests are strong, but public release requires browser-level smoke coverage.

Create a release checklist for real Chrome using unpacked production build.

Minimum matrix:

## Installation / lifecycle

- fresh install;
- open Side Panel;
- reload extension;
- reload LeetCode tab;
- close/reopen Side Panel;
- switch LeetCode tabs;
- switch to non-LeetCode tab and back.

## Problem/runtime

- Two Sum/list;
- Binary Search;
- Linked List;
- Tree 104;
- Graph;
- Matrix/DP;
- recursion;
- Runtime Error;
- local timeout / trace limit;
- Cross-Run baseline diff.

## Editor states

- Python;
- unsupported language;
- empty editor;
- syntax error;
- testcase missing;
- multiple testcase Cases.

## Navigation

- Previous/Next;
- Play/Pause;
- Timeline;
- Call Tree;
- Inspect current from Behavioral Diff.

No release submission until all P0 smoke cases are recorded pass/fail.

---

# 21. P0 Release Gate: Chrome Version Support

Side Panel requires modern Chrome.

Declare a tested minimum Chrome version.

Possible manifest field:

```json
"minimum_chrome_version": "114"
```

However, choose the minimum based on the newest Chrome API actually relied upon by the shipping code, not only Side Panel's original availability.

Before setting this field:

- inventory all `chrome.*` APIs used;
- verify availability;
- test that version range if practical.

If the release assumes a current Chrome baseline, document it clearly.

---

# 22. P0 Release Gate: Version Consistency

Single authoritative version:

```text
0.1.0
```

Must remain consistent across:

- `public/manifest.json`;
- `package.json`;
- generated ZIP filename;
- release notes;
- Git tag.

Add automated version consistency check.

---

# 23. P0 Release Gate: Git Release Hygiene

For the release candidate:

```text
main green
→ release smoke checklist green
→ version finalized
→ release ZIP generated from clean commit
→ tag v0.1.0
→ GitHub Release
→ Chrome Web Store upload
```

Do not publish a ZIP generated from a dirty working tree.

Record source commit SHA in release notes.

---

# 24. P1 Release Gate: Store Listing Copy

Create concise listing copy separate from the very technical README.

Recommended structure:

## Short description

> Visualize how your Python solution actually executes on LeetCode—step by step, including failures, recursion, state changes, and behavioral diffs.

Final text must stay within Store limits.

## Long description

Structure:

1. one-paragraph value proposition;
2. 5–7 primary features;
3. local execution/privacy statement;
4. Python-only v0.1 boundary;
5. not a solver / not LeetCode judge disclaimer.

Avoid dumping the entire README capability list into the Store listing.

---

# 25. P1 Release Gate: Store Screenshots

Prepare 4–5 real screenshots at 1280×800 where practical.

Recommended set:

## Screenshot 1 — Core execution

Binary Search or Two Sum:

- code line;
- list visualization;
- current state.

Caption concept:

> See your Python code execute step by step.

## Screenshot 2 — Decision / mutation evidence

Binary Search:

> See which condition Python evaluated and what changed next.

## Screenshot 3 — Recursion / Call Tree

LeetCode 104:

> Follow concrete recursive calls, arguments, and returns.

## Screenshot 4 — Matrix / structured visualization

A DP/grid problem:

> Turn runtime state into a visual matrix or data-structure view.

## Screenshot 5 — Behavioral Diff

Pinned baseline:

> Compare two captured runs and jump to the first supported behavioral difference.

Screenshots should show actual UI.

Do not mock capabilities that are not shipping.

---

# 26. P1 Release Gate: Support Surface

Add a public support section.

Minimum:

- GitHub Issues link;
- reproduction template expectations:
  - LeetCode problem URL/slug;
  - Chrome version;
  - extension version;
  - Python code if user is willing to share;
  - testcase if user is willing to share;
  - screenshot;
  - whether issue reproduces after page refresh.

Do not ask users to post private code publicly without warning.

Add:

```text
Before attaching code/testcases to a public issue, remove anything you do not want to share publicly.
```

---

# 27. P1 Release Gate: Issue Templates

Recommended GitHub templates:

```text
Bug report
Visualization mismatch
LeetCode integration/sync issue
Feature request
```

The bug template should distinguish:

```text
actual Python behavior
vs
visualizer presentation
vs
LeetCode integration
```

This will matter once reports come from users unfamiliar with the architecture.

---

# 28. P1 Release Gate: Release Notes

v0.1 release notes should be short.

Include:

- what it does;
- primary visualization types;
- local Python execution;
- pinned behavioral diff;
- current boundaries:
  - Python only;
  - local runtime != LeetCode judge;
  - LeetCode DOM integration may require updates when LeetCode changes.

Do not list every internal evidence subsystem.

---

# 29. P1 Release Gate: README Release Cleanup

Current README is technically strong but long.

Before public promotion:

- keep technical depth;
- add top-level install/use section earlier;
- add screenshot/GIF near the top;
- add privacy/local execution note near the top;
- add Store installation path once available;
- add support link;
- add license badge only after license decision;
- move exhaustive architecture details lower.

The README serves developers.

The Store listing serves end users.

Do not force one document to do both jobs.

---

# 30. P1 Release Gate: Security Review

Release security checklist:

- no `eval` / remote script injection outside packaged Pyodide requirements;
- no remote executable code;
- no credentials/API keys;
- content-script messages validate sender/tab assumptions where applicable;
- MAIN-world bridge accepts only the minimal message surface;
- user code cannot directly access Chrome extension APIs;
- Pyodide worker has no privileged Chrome APIs;
- no arbitrary host permissions;
- CSP remains restrictive apart from required WASM capability;
- no developer-only debug data leaks into public UI by default.

Remember:

> Web Worker + Pyodide is not a hardened hostile-code sandbox.

Keep that boundary documented.

---

# 31. P1 Release Gate: Dependency Review

Before v0.1 tag:

- `npm audit`;
- record known advisories;
- update only if low-risk and compatible;
- inspect Pyodide package version;
- avoid opportunistic major upgrades immediately before release.

A known moderate dev/build advisory is not automatically a release blocker.

Runtime-reachable security issues are.

---

# 32. P1 Release Gate: Performance Baselines

Do not turn release hardening into premature optimization.

Record basic acceptance baselines:

- extension open-to-ready state;
- warm simple execution;
- recursion example;
- matrix example;
- large trace navigation responsiveness;
- memory behavior after repeated reruns.

Use qualitative thresholds first:

```text
no visible freeze
no runaway DOM growth
no accumulating old run history
no worker leak after repeated sessions
```

Only add strict numeric budgets if measurements show a real risk.

---

# 33. P1 Release Gate: Accessibility Smoke

Minimum public release accessibility:

- all controls keyboard reachable;
- visible focus;
- buttons use button semantics;
- details/summary panels operate by keyboard;
- status is not color-only;
- baseline/current differences use text labels;
- call tree disclosure remains understandable;
- scrollable side panel does not trap keyboard navigation.

Automated DOM tests plus one real keyboard smoke pass.

---

# 34. P2: Post-Release, Not Before v0.1

Do not block initial release on:

- telemetry;
- crash reporting backend;
- account sync;
- persistent settings;
- localization framework;
- Firefox;
- Edge Store;
- Safari;
- AI explanations;
- expected-vs-actual judge data;
- Case-to-Case Behavioral Diff;
- full E2E browser automation;
- custom website/landing page.

These may follow after real users produce evidence about what matters.

---

# 35. Release Gate Tiers

## Gate A — Submission blocker

Must be complete before Chrome Web Store upload:

```text
manifest identity
icons
privacy policy
privacy dashboard answers
permission justification
release ZIP
package validation
CI green
first-run / unsupported-language / non-LeetCode states
recovery copy
manual smoke matrix
version consistency
Store listing copy
at least one Store screenshot
```

## Gate B — Strongly recommended before public promotion

```text
toolbar click opens Side Panel
4–5 screenshots
support path
issue templates
GitHub release/tag
README cleanup
security review
accessibility smoke
dependency review
```

## Gate C — Post-release

Everything in P2.

---

# 36. Release Candidate Definition

`v0.1.0-rc1` exists when:

1. no major feature work is in flight;
2. all Gate A engineering work is merged;
3. package ZIP is reproducible;
4. CI passes from the exact release commit;
5. Chrome unpacked smoke matrix passes;
6. privacy/store copy matches actual behavior;
7. no known P0 correctness/security issue exists.

Then use RC1 for final manual testing.

If a bug is found:

```text
fix
→ RC2
```

Do not add features between RCs.

---

# 37. Public Release Definition

`v0.1.0` is release-ready when:

```text
RC smoke passes
+
Store assets complete
+
Privacy tab complete
+
listing copy complete
+
package built from tagged commit
+
no release blocker remains
```

Chrome Web Store review itself is an external publication step, not a code-completeness condition.

---

# 38. Recommended Work Order

```text
Phase 1 — Compliance + manifest
  privacy policy
  permission audit
  manifest metadata
  icons
  Side Panel action

Phase 2 — Release engineering
  package validation
  release ZIP
  CI release gate
  version consistency

Phase 3 — Public-user hardening
  onboarding
  unsupported-language state
  non-LeetCode state
  recovery / retry
  failure containment

Phase 4 — Acceptance
  real Chrome smoke matrix
  security/accessibility/dependency review

Phase 5 — Store package
  listing copy
  screenshots
  support path
  release notes
  tag / GitHub Release

Phase 6 — Submit
  Chrome Web Store dashboard
  privacy practices
  permission justifications
  distribution settings
  upload RC-approved ZIP
```

---

# 39. What Not to Change During Release Hardening

Avoid architectural churn in:

- trace schema;
- Python instrumentation;
- call-frame semantics;
- Cross-Run Diff alignment;
- visualization registry;
- live scheduler behavior;
- active-tab ownership.

Change these only for a confirmed release blocker.

The current engine has already passed a substantial regression suite.

Release hardening should reduce risk, not reopen stable subsystems.

---

# 40. Suggested Acceptance Problems

Keep one fixed public-release smoke set.

## Array / control flow

LeetCode 704 — Binary Search

Tests:

- live sync;
- Decision Evidence;
- list visualization;
- mutations;
- Cross-Run Diff.

## Linked list

LeetCode 206 — Reverse Linked List

Tests:

- object/reference behavior;
- linked-list visualizer.

## Tree / recursion

LeetCode 104 — Maximum Depth of Binary Tree

Tests:

- TreeNode decoding;
- tree visualizer;
- recursion Call Tree;
- return evidence.

## Matrix / DP

Use one small rectangular-grid problem already known to render correctly.

Tests:

- matrix viewport;
- cell focus;
- expression overlay/path if supported by chosen fixture.

## Graph

Use one standard `Node(val, neighbors)` problem.

Tests graph visualization and adjacency testcase decoder.

These five become the stable release smoke suite.

---

# 41. Definition of Done

Release Readiness v0.1 is complete when:

1. major feature scope is frozen for v0.1;
2. manifest has a concise description;
3. manifest has short_name or equivalent compact identity;
4. 16/32/48/128 extension icons exist;
5. manifest declares icons;
6. toolbar/action icon is configured;
7. chosen Side Panel opening behavior is implemented and tested;
8. host permissions remain LeetCode-only;
9. every manifest permission has a documented user-facing justification;
10. no unnecessary permission is present;
11. Pyodide/runtime executable assets are bundled locally;
12. no release runtime code depends on a remote executable script;
13. privacy policy exists;
14. privacy policy accurately describes editor/testcase access;
15. privacy policy accurately describes local runtime-derived data;
16. privacy policy accurately describes transmission;
17. privacy policy accurately describes persistence/storage;
18. privacy policy identifies third-party/runtime dependencies appropriately;
19. in-product local-processing disclosure exists;
20. Store single-purpose statement is drafted;
21. Store permission justification text is drafted;
22. Store data-handling answers are drafted;
23. license decision has been made explicitly;
24. if open-source release is intended, a license file exists;
25. release package contents are deterministic;
26. release package excludes development-only root artifacts;
27. release package includes manifest;
28. release package includes all declared assets;
29. release package includes bundled Pyodide runtime assets;
30. release ZIP command exists;
31. release validation command exists;
32. manifest JSON validation is automated;
33. version consistency is automated;
34. declared file existence is automated;
35. remote executable-code guard is automated where practical;
36. release checks run in CI;
37. first-run onboarding explains how to start;
38. onboarding states Python-only support;
39. onboarding states local execution/privacy;
40. non-LeetCode state is actionable;
41. unsupported-language state is explicit;
42. missing-editor state is explicit;
43. missing-testcase state is explicit;
44. connection failure gives recovery instructions;
45. local runtime failure remains distinguishable from LeetCode judge status;
46. Retry/Run-now path exists where recovery is possible;
47. waiting/sync failures do not unnecessarily destroy the last useful visualization;
48. fresh-install Chrome smoke passes;
49. extension reload smoke passes;
50. LeetCode page reload smoke passes;
51. Side Panel reopen smoke passes;
52. multi-tab ownership smoke passes;
53. non-LeetCode pause/resume smoke passes;
54. Binary Search smoke passes;
55. linked-list smoke passes;
56. Tree/recursion smoke passes;
57. matrix smoke passes;
58. graph smoke passes;
59. Runtime Error smoke passes;
60. timeout/trace-limit smoke passes;
61. Cross-Run Diff smoke passes;
62. multi-Case smoke passes;
63. keyboard accessibility smoke passes;
64. security checklist has no unresolved P0 item;
65. dependency review has no unresolved runtime-critical advisory;
66. Store short description exists;
67. Store long description exists;
68. at least one compliant Store screenshot exists;
69. preferred 4–5 screenshot set is prepared before promotion;
70. support path is published;
71. public bug-reporting privacy warning exists;
72. release notes exist;
73. README has an obvious install/use path;
74. README states local execution/privacy prominently;
75. release candidate ZIP comes from a clean commit;
76. release candidate CI is green;
77. version is finalized;
78. Git tag/release source SHA is recorded;
79. Chrome Web Store Privacy tab can be completed without inventing answers;
80. Chrome Web Store listing matches actual shipping behavior;
81. no known P0 release blocker remains.

---

# 42. Outcome

When this milestone is complete, the project changes from:

```text
a strong extension the developer can use successfully
```

to:

```text
a reproducible, understandable, privacy-transparent extension
that an unfamiliar Chrome Web Store user can install and use safely
```

That is the correct final milestone before public v0.1 publication.
