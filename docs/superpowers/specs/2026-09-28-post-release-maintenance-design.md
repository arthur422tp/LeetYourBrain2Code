# Post-Release Maintenance

## Design Spec v0.1

**Date:** 2026-09-28  
**Status:** Automated implementation complete; manual Chrome acceptance pending
**Target release:** LeetYourBrain2Code v0.1.1  
**Release baseline:** v0.1.0 public Chrome Web Store release  
**Primary goal:** Convert the project from release-candidate development into a maintainable public extension with reproducible diagnostics, LeetCode compatibility regression coverage, and a repeatable patch-release pipeline.

---

# 1. Product Transition

v0.1.0 has crossed the boundary from a developer-owned build into a public product.

The main engineering risk is therefore no longer only:

```text
Can the visualizer represent another runtime shape?
```

It is now also:

```text
Can a public user recover when integration breaks?
Can a bug report contain enough evidence to reproduce the failure?
Can a LeetCode UI change be detected before a release?
Can a patch release be packaged from one known source commit?
Can maintenance happen without collecting user code or introducing telemetry?
```

For v0.1.1, maintenance quality is more valuable than another major visualization family.

This milestone should establish:

```text
public release
      ↓
diagnosable failures
      ↓
reproducible compatibility checks
      ↓
bounded patch release
      ↓
repeatable maintenance loop
```

The product identity remains:

> A LeetCode-native Python visual debugger that shows what the user's code actually did.

---

# 2. Current Baseline

The current repository already has a strong release baseline.

## Runtime / product

Current public capability includes:

- live Python editor and testcase synchronization;
- exact active-tab ownership;
- local Pyodide execution in a Web Worker;
- list / matrix / linked-list / tree / graph visualization;
- expression, decision, mutation, and behavioral evidence;
- recursion / Call Tree presentation;
- failure-first inspection;
- repeated-trace folding and timeline navigation;
- pinned baseline behavioral diff;
- trace replay synchronized with the visible LeetCode Monaco editor.

## Release infrastructure

Already present:

- Manifest V3;
- explicit Chrome minimum version;
- narrow `sidePanel` and `scripting` permissions;
- LeetCode-only host permission;
- local bundled Pyodide;
- privacy policy;
- MIT license;
- bug / integration / feature-request issue forms;
- CI for Python fixtures, Vitest, typecheck, build, and release checks;
- deterministic release-package validation;
- `release:zip`;
- Chrome smoke evidence for release-critical behavior.

## Post-release gaps

The repository is still partly written as if v0.1.0 were a release candidate.

Examples include:

- README status still saying v0.1.0 is being prepared;
- no explicit post-release version policy;
- no committed changelog as the public history of shipped changes;
- support asks users for information that the extension does not yet package into a copyable diagnostic report;
- compatibility tests exist across subsystems but are not organized as one explicit LeetCode integration contract;
- CI validates the package but does not yet define a single tag/manual workflow that emits the exact Web Store upload artifact plus release evidence;
- the project has no written severity/triage rules for public issues.

These are the v0.1.1 target.

---

# 3. Goals

v0.1.1 should provide four maintenance capabilities.

## Goal A — Release lifecycle

Make the repository accurately describe a shipped product and define how future patch/minor releases differ.

## Goal B — Privacy-preserving diagnostic report

Allow a user to copy enough environment and runtime metadata to make a bug report actionable without copying their source code, testcase text, locals, stdout, or raw trace.

## Goal C — Explicit LeetCode compatibility contract

Treat the editor bridge, testcase extraction, active-tab ownership, navigation, and Monaco replay integration as one compatibility surface with regression coverage.

## Goal D — Reproducible release artifact

From one commit, produce one validated Web Store ZIP and its release evidence through CI/manual/tag workflow.

---

# 4. Non-Goals

v0.1.1 must not become a feature-expansion release.

Out of scope:

- new visualization families;
- algorithm inference;
- AI explanation;
- correctness diagnosis;
- expected-output comparison;
- remote telemetry;
- crash analytics service;
- account/login;
- cloud trace upload;
- persistent code history;
- automatic submission to Chrome Web Store;
- generic browser support beyond the current Chrome target;
- broad refactor of the runtime engine;
- Case-to-Case Behavioral Diff;
- new graph/tree/DP semantics.

Compatibility or UX fixes discovered while implementing this milestone are allowed when they are required to make the maintenance loop reliable.

---

# 5. Version Policy

After v0.1.0, release numbering should have a concrete meaning.

## 5.1 Patch releases — 0.1.x

Use a patch release for:

- LeetCode compatibility fixes;
- Chrome compatibility fixes;
- correctness fixes;
- crash/recovery fixes;
- performance fixes that do not redefine product behavior;
- copy/accessibility fixes;
- diagnostic/support improvements;
- packaging/release infrastructure changes.

A patch release should not add a major new debugging concept.

## 5.2 Minor release — 0.2.0

Use v0.2.0 for a meaningful new user-facing debugging capability or a material extension of evidence semantics.

Examples:

- new control-flow evidence capability;
- new comparison mode;
- new visualization family;
- a new persistent debugging workflow.

## 5.3 Version consistency

The release version remains authoritative across:

```text
package.json
public/manifest.json
release ZIP filename
CHANGELOG.md
Git tag
GitHub Release title
Chrome Web Store version
```

The existing release check remains responsible for manifest/package consistency.

---

# 6. Repository State After v0.1.1

The repository should stop presenting itself as a release candidate.

README development status should become conceptually:

```text
Current stable release: v0.1.x

v0.1.x maintenance:
- compatibility fixes
- correctness fixes
- recovery / diagnostics
- release hardening

Next feature milestone:
- v0.2.0
```

The exact README text can stay concise.

The old v0.1.0 release-freeze text should be removed or rewritten as historical context.

Both English and Traditional Chinese README variants must remain consistent.

---

# 7. CHANGELOG.md

Add a root-level:

```text
CHANGELOG.md
```

Use a compact Keep-a-Changelog-style structure.

Required initial shape:

```md
# Changelog

## [Unreleased]

### Added
### Changed
### Fixed

## [0.1.0] - 2026-09-xx

### Added
- Initial Chrome Web Store release.
- ...
```

Do not attempt to reproduce every development commit.

The v0.1.0 section should summarize the public product surface, not internal implementation history.

Future maintenance workflow:

```text
change merged
→ add user-visible entry under Unreleased when relevant
→ prepare release
→ move Unreleased entries into version/date section
→ tag
```

Pure internal test refactors do not require changelog entries unless they materially change the release/support contract.

---

# 8. Diagnostic Report

## 8.1 User problem

A public issue such as:

> “The panel stopped updating on Two Sum.”

is not enough to distinguish:

```text
inactive tab
vs
editor unavailable
vs
wrong language
vs
testcase unavailable
vs
stale page bridge
vs
worker failure
vs
trace timeout
vs
visualizer rendering problem
vs
editor replay sync failure
```

Users should not be required to inspect DevTools to provide the first useful layer of evidence.

## 8.2 Product behavior

Add a user-triggered action in a low-priority support/settings surface:

```text
Copy diagnostic info
```

The action copies one plain-text report to the clipboard.

No report is generated or transmitted automatically.

Suggested presentation:

```text
Support
Copy diagnostic info

Copies technical status only.
Your code, testcase, variables, stdout, and trace values are not included.
```

The user can then paste it into the existing GitHub issue forms.

---

# 9. Diagnostic Report Contract

The report should be deterministic, bounded, readable, and safe to publish.

Recommended v0.1.1 schema:

```text
LeetYourBrain2Code diagnostics

Extension
version: 0.1.1
manifest: 3

Browser
chrome: <major/full version when available>
platform: <coarse platform when available>

Page
active_context: leetcode | non_leetcode | unavailable
problem_slug: <slug or unavailable>
language: python | unsupported | unavailable
page_state: ready | waiting_editor | waiting_testcase | disconnected | ...

Integration
active_tab_owned: true | false | unavailable
page_bridge: ready | stale | unavailable
editor_sync: synced | stale | unavailable | cleared
testcase_state: ready | unavailable | ...
selected_case: <index only, no content>

Execution
status: idle | running | completed | exception | timeout | trace_limit | worker_error | ...
trace_events: <count>
duration_ms: <bounded integer or unavailable>
accepted_snapshot: true | false

Visualization
kind: list | matrix | linked_list | tree | graph | call_tree | generic | ...
raw_cursor: <index>/<event_count>
baseline: none | compatible | incompatible
behavioral_diff: available | unavailable | ambiguous

Generated
timestamp_utc: <ISO timestamp>
```

The final field names may adapt to existing internal types, but the privacy and semantic boundaries below are requirements.

---

# 10. Diagnostic Privacy Boundary

The default report must not include:

- Python source code;
- testcase text;
- expected output;
- stdout content;
- exception message if it can contain user values;
- local/global variable names or values;
- object snapshots;
- expression operand values;
- decision operand values;
- mutation values;
- raw trace events;
- baseline trace contents;
- LeetCode account identity;
- cookies;
- auth/session tokens;
- browser history;
- full page URL with query parameters;
- extension-internal random IDs that can correlate users across reports.

The report may include:

- extension version;
- coarse browser/platform information;
- public LeetCode problem slug;
- selected testcase case index;
- status enums;
- counts;
- durations;
- visualization kind;
- compatibility state.

Do not include a source hash or testcase hash in v0.1.1.

Even a one-way hash can become a stable fingerprint and is unnecessary for the first support contract.

No diagnostic data is sent to the developer by the extension.

Clipboard copy remains an explicit user action.

---

# 11. Diagnostic Status Source

Do not create a second diagnostic state machine.

The report must project from existing authoritative runtime state.

Conceptually:

```text
existing SidePanel / ownership / execution state
                    ↓
         DiagnosticSnapshot
                    ↓
      formatDiagnosticReport()
                    ↓
              clipboard
```

Recommended internal type:

```ts
interface DiagnosticSnapshot {
  extension: ...
  browser: ...
  page: ...
  integration: ...
  execution: ...
  visualization: ...
  generatedAt: string
}
```

The formatter should be pure.

The collector should tolerate missing subsystems and emit `unavailable` rather than throwing.

Diagnostics must never block visualization.

---

# 12. Diagnostic UX Failure Behavior

Clipboard access can fail.

Required behavior:

```text
Copy diagnostic info
       ↓
success → brief "Copied"
failure → expose selectable diagnostic text
```

Do not silently fail.

Do not add a permission only for clipboard support if the same user-triggered copy can be implemented with existing browser capabilities.

If Chrome requires another permission for the chosen implementation, prefer a no-new-permission fallback before expanding manifest permissions.

---

# 13. LeetCode Compatibility Contract

The extension depends on several external LeetCode surfaces that can change independently.

Treat them as one explicit compatibility contract.

## Contract A — problem identity

The extension must correctly associate state with the active problem slug.

## Contract B — Python editor discovery

The bridge must locate the visible active Monaco Python editor and reject stale/background/non-matching models.

## Contract C — source synchronization

Editing the active source must produce current page state without requiring LeetCode Run/Submit.

## Contract D — testcase discovery

The adapter must either produce a valid visible testcase snapshot or an explicit waiting/unavailable state.

## Contract E — testcase case selection

When multiple Cases exist, the selected case identity must remain associated with the execution request.

## Contract F — SPA navigation

Moving between LeetCode problems without a full document reload must refresh exact-page identity and state.

## Contract G — tab ownership

Only the active LeetCode tab in the current Chrome window may own live visualization state.

Background updates must not steal ownership.

## Contract H — editor replay synchronization

A trace event may highlight the matching current source line only when source/problem identity still matches.

A source edit must clear stale replay highlighting.

---

# 14. Compatibility Regression Layers

Compatibility coverage should be organized into three layers.

## Layer 1 — deterministic unit/fixture contract

Runs on every CI build.

Covers:

- metadata extraction;
- language normalization;
- editor model selection;
- page-state validation;
- testcase parsing;
- active-tab ownership transitions;
- navigation identity changes;
- message validation;
- editor replay source matching;
- stale/unavailable fallback.

These tests must not require live LeetCode network access.

Use small synthetic DOM/Monaco fixtures and existing recorded fixture patterns.

## Layer 2 — built-extension browser integration

Runs against the production `dist/` build in controlled browser fixtures where practical.

Covers:

- content script ↔ page bridge messaging;
- service worker ↔ active tab behavior;
- side panel state projection;
- editor replay message path;
- recovery after content/page bridge refresh.

This layer validates packaging/integration boundaries, not LeetCode's live DOM.

## Layer 3 — real LeetCode release smoke

Required before Web Store upload for a patch that changes LeetCode integration.

Use a real Chrome production build and a public LeetCode problem.

Record pass/fail evidence for:

- page detection;
- Python source sync;
- testcase state;
- execution;
- active-tab switching;
- SPA problem navigation;
- replay highlight;
- source-edit stale-highlight clearing.

This layer may remain manual/semi-automated because live LeetCode is an external dependency and should not make normal CI flaky.

---

# 15. Compatibility Test Organization

Introduce an explicit maintenance-facing grouping, for example:

```text
tests/
  compatibility/
    page-identity...
    editor-discovery...
    testcase...
    tab-ownership...
    navigation...
    editor-replay...
```

or an equivalent logical grouping using current test locations.

A physical directory move is not required if it would create unnecessary churn.

What is required is one command or CI step that answers:

> Does the current build still satisfy the LeetCode integration contract?

Recommended script:

```json
"test:compat": "vitest run <compatibility selection>"
```

Exact Vitest filters should follow the current test layout.

The compatibility suite may also include existing tests rather than duplicate them.

---

# 16. Compatibility Failure Classification

Public integration bugs should map into a small triage vocabulary.

Recommended categories:

```text
PAGE_IDENTITY
EDITOR_DISCOVERY
SOURCE_SYNC
TESTCASE_DISCOVERY
CASE_SELECTION
SPA_NAVIGATION
TAB_OWNERSHIP
PAGE_BRIDGE
EDITOR_REPLAY
WORKER_RUNTIME
VISUALIZATION
RELEASE_PACKAGE
UNKNOWN
```

This is a support/engineering classification, not a user-facing diagnosis.

The diagnostic report may expose friendly status fields rather than these exact internal enum names.

Issue templates should eventually allow the maintainer to map a report into one of these categories quickly.

---

# 17. Recovery Principle

A LeetCode integration failure should degrade explicitly.

Preferred progression:

```text
live state
→ stale/unavailable integration state
→ preserve last valid trace when safe
→ show recovery action
→ allow diagnostic copy
```

Avoid:

```text
integration failure
→ blank panel
→ destroy previous useful context
```

The existing recovery behavior should remain authoritative.

v0.1.1 diagnostics observe that behavior; they do not replace it.

---

# 18. Release Artifact Workflow

Current scripts already provide:

- validation;
- release package check;
- release ZIP creation.

v0.1.1 should connect them through one reproducible GitHub Actions release-artifact workflow.

Supported triggers:

```text
workflow_dispatch
or
tag matching v*
```

Recommended pipeline:

```text
checkout exact commit
→ setup Node/Python
→ npm ci
→ Python fixture tests
→ npm test
→ npm run test:compat
→ npm run typecheck
→ npm run build
→ npm run release:check
→ npm run release:zip
→ calculate SHA-256
→ upload ZIP + checksum as GitHub Actions artifacts
```

Artifact naming:

```text
leetyourbrain2code-v<version>.zip
leetyourbrain2code-v<version>.zip.sha256
```

The exact current release ZIP naming can be retained if already established; consistency matters more than the literal prefix.

---

# 19. No Automatic Web Store Publish in v0.1.1

Do not add Chrome Web Store credentials/API publishing to this milestone.

Reasons:

- it introduces secret management;
- publication is an irreversible external action;
- Store review state remains external;
- the current maintenance need is reproducible packaging, not zero-click deployment.

v0.1.1 release flow ends at:

```text
validated exact artifact
→ owner uploads artifact to Chrome Web Store
```

Automation can be reconsidered after several patch releases establish a stable process.

---

# 20. Release Evidence

Each release artifact workflow should make it easy to identify:

- version;
- source commit SHA;
- CI run;
- ZIP artifact;
- SHA-256 checksum.

The ZIP itself should remain the same extension payload expected by the Web Store.

Do not add debugging logs, source specs, test fixtures, or CI metadata inside the extension ZIP merely for release evidence.

Release evidence belongs next to the artifact, not inside the runtime package.

---

# 21. Release Gate for v0.1.1

v0.1.1 is releasable when all of the following are true.

## Repository state

- README English no longer says v0.1.0 is being prepared;
- README Traditional Chinese matches;
- version policy is documented;
- `CHANGELOG.md` exists;
- v0.1.0 public capabilities have an initial changelog entry;
- v0.1.1 changes are represented under Unreleased/release section as appropriate.

## Diagnostics

- user can trigger diagnostic copy;
- default diagnostic text excludes source/testcase/value-bearing evidence;
- report works in ready, waiting, error, timeout, and unavailable states;
- clipboard failure has a fallback;
- diagnostic formatting has unit tests.

## Compatibility

- explicit compatibility test command exists;
- editor/testcase/tab/navigation/replay contracts have coverage;
- compatibility tests run in CI;
- live integration smoke checklist is updated for the current release.

## Release

- release artifact workflow runs from an exact commit;
- release check passes;
- generated ZIP version matches manifest/package;
- SHA-256 is emitted;
- generated artifact can be loaded as an unpacked/packaged production build for smoke verification.

---

# 22. Public Issue Triage

A simple maintenance loop is enough for the current project size.

Recommended triage order:

```text
new issue
→ reproduction / diagnostic present?
→ integration vs runtime vs visualization
→ severity
→ patch candidate?
→ regression test
→ fix
→ release note
```

Suggested severity semantics:

## P0 — release blocker / unusable for broad users

Examples:

- extension cannot open;
- production package invalid;
- LeetCode integration broadly broken;
- code/testcase is unexpectedly transmitted or persisted;
- destructive or security-relevant regression.

## P1 — major supported workflow broken

Examples:

- Python editor no longer synchronizes on a common LeetCode layout;
- active-tab ownership is wrong;
- testcase selection is materially incorrect;
- worker or visualization crashes for a supported common structure.

## P2 — localized defect

Examples:

- one evidence overlay is wrong;
- one uncommon rendering state is broken;
- non-critical recovery copy/UI issue.

## P3 — enhancement

Feature requests and non-blocking improvements.

These categories may remain maintainer-side GitHub labels; they do not need to appear in the extension UI.

---

# 23. Patch Release Rule

A public bug fix should normally include:

```text
reproduction
→ regression test
→ smallest safe fix
→ changelog entry when user-visible
→ full validation
→ release artifact
```

For LeetCode integration regressions, add or update a compatibility fixture whenever the external breakage can be represented deterministically.

Do not normalize one-off selector hacks without a regression contract.

---

# 24. Telemetry Decision

v0.1.1 should remain telemetry-free.

Do not add:

- analytics SDK;
- crash-reporting SDK;
- remote event ingestion;
- unique installation ID;
- automatic diagnostic uploads.

The project can maintain a public product through:

```text
explicit user reports
+ privacy-safe diagnostics
+ deterministic regression tests
+ release smoke checks
```

This preserves the current local-processing trust model.

A future telemetry proposal would require its own privacy/product design decision.

---

# 25. Diagnostic Example

A safe example report:

```text
LeetYourBrain2Code diagnostics

Extension
version: 0.1.1
manifest: 3

Browser
chrome: 153
platform: Windows

Page
active_context: leetcode
problem_slug: number-of-islands
language: python
page_state: ready

Integration
active_tab_owned: true
page_bridge: ready
editor_sync: synced
testcase_state: ready
selected_case: 2

Execution
status: timeout
trace_events: 384
duration_ms: 5000
accepted_snapshot: true

Visualization
kind: matrix
raw_cursor: 383/384
baseline: none
behavioral_diff: unavailable

Generated
timestamp_utc: 2026-09-28T03:00:00Z
```

This report is useful without revealing the user's solution.

---

# 26. Testing Requirements

Add tests for the maintenance layer itself.

## Diagnostic formatter

Verify:

- stable field ordering;
- unavailable values;
- no accidental object serialization;
- no source/testcase inclusion;
- bounded counts/durations;
- exception/value-bearing strings are omitted.

## Diagnostic collector

Verify:

- ready state;
- no active LeetCode tab;
- editor unavailable;
- testcase unavailable;
- running;
- completed;
- exception;
- timeout;
- trace limit;
- worker failure;
- baseline compatible/incompatible.

## Clipboard UX

Verify:

- success state;
- copy failure fallback;
- repeated copy;
- no new visualization reset.

## Compatibility suite

Verify the eight contracts in Section 13.

## Release workflow

Verify:

- version mismatch fails;
- compatibility failure blocks artifact generation;
- release check blocks ZIP upload;
- ZIP/checksum artifacts are emitted only after validation.

---

# 27. Implementation Shape

This design should be implementable in four bounded slices.

## Slice 1 — Release-state cleanup

- add `CHANGELOG.md`;
- update English/TW README release status;
- document patch/minor policy.

## Slice 2 — Diagnostics

- diagnostic snapshot projection;
- pure formatter;
- support/settings UI;
- clipboard fallback;
- tests;
- issue/support copy update.

## Slice 3 — Compatibility contract

- inventory/reuse existing integration tests;
- add missing fixtures;
- add `test:compat`;
- run it in CI;
- update live smoke checklist.

## Slice 4 — Release artifact workflow

- GitHub Actions manual/tag workflow;
- exact artifact naming;
- checksum;
- artifact upload;
- release documentation.

These slices should be independently reviewable.

---

# 28. Architectural Constraint

Maintenance code must not become coupled to every visualizer implementation.

Preferred direction:

```text
runtime / integration authoritative state
                ↓
        bounded status projection
                ↓
          diagnostics/support
```

Avoid:

```text
diagnostic button
→ inspect arbitrary DOM
→ scrape rendered text
→ infer runtime status
```

Diagnostics should consume typed application state, not presentation markup.

Similarly, compatibility tests should test adapters/bridges/contracts rather than screenshot pixels except where a browser smoke test specifically targets UI layout.

---

# 29. Acceptance Criteria

The milestone is complete when a maintainer can perform this scenario:

```text
1. A public user reports that LeetCode synchronization stopped.
2. The user clicks Copy diagnostic info.
3. The pasted report contains no code/testcase/runtime values.
4. The report identifies the relevant integration state.
5. The maintainer maps it to the compatibility contract.
6. A regression fixture is added.
7. The fix passes test:compat and the full CI suite.
8. A v0.1.x release artifact is generated from one exact commit.
9. The artifact has a checksum and can be uploaded directly to Chrome Web Store.
10. README/changelog accurately identify the shipped release.
```

If this loop works, the project has moved from “released once” to “maintainable after release.”

---

# 30. Next Milestone

After v0.1.1 is stable, feature work can reopen for v0.2.0.

The next feature should be selected from evidence gathered through actual use rather than from feature accumulation alone.

A strong candidate remains richer loop/control-flow debugging, but v0.1.1 intentionally does not commit v0.2.0 to a specific capability.

The decision gate for v0.2.0 should consider:

- public bug/feature requests;
- which execution shapes remain hard to understand;
- whether the current evidence model can support the feature without heuristic diagnosis;
- whether the feature preserves the product boundary of showing observed execution rather than solving the problem.

---

# Implementation Status

Automated implementation is complete; final real-browser release acceptance is
pending an interactive Chrome session.

Implemented:

- post-release README/changelog lifecycle;
- privacy-safe copyable diagnostics;
- diagnostic support/issue workflow;
- explicit LeetCode compatibility contract suite;
- named `test:compat` CI gate;
- public issue triage guidance;
- v0.1.1 live integration smoke gate checklist and automated package audit;
- reproducible release ZIP workflow;
- release ZIP SHA-256 artifact workflow.

Pending acceptance evidence:

- real-LeetCode v0.1.1 smoke execution;
- manual diagnostic privacy verification with recognizable values;
- toolbar/Side Panel lifecycle verification in interactive Chrome.

Deferred:

- automatic Chrome Web Store publishing;
- telemetry/crash analytics;
- persistent diagnostic history;
- automatic diagnostic uploads;
- new v0.2 debugging capability.
