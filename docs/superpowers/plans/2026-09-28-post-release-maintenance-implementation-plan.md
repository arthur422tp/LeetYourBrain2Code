# Post-Release Maintenance Implementation Plan

> **Execution mode:** implement sequentially, keep every task independently testable, and do not add new debugger capabilities during this milestone.

**Goal:** Ship a maintainable `v0.1.1` patch release with an accurate post-release repository state, privacy-preserving diagnostics, an explicit LeetCode compatibility regression suite, and a reproducible GitHub Actions release artifact.

**Design spec:** `docs/superpowers/specs/2026-09-28-post-release-maintenance-design.md`

**Release policy:** `0.1.x` is maintenance only. New debugging semantics, visualization families, comparison modes, AI behavior, telemetry, persistence, or solver-like capability belong to a separately designed `0.2.0+` milestone.

---

# Current Starting Point

The repository already has:

- public Chrome Web Store v0.1.0 baseline;
- Manifest V3;
- `package.json` and `public/manifest.json` at `0.1.0`;
- narrow `sidePanel` + `scripting` permissions;
- LeetCode-only host permission;
- local bundled Pyodide;
- Side Panel public onboarding and recovery states;
- privacy and support documentation;
- bug / integration / feature-request issue forms;
- CI with Python fixtures, Vitest, typecheck, build, and release package validation;
- `release:check`;
- `release:zip`;
- release package tests;
- active-tab ownership;
- LeetCode page-state synchronization;
- editor replay synchronization into the visible Monaco editor.

The maintenance gaps are now:

```text
README still describes a release candidate
no root changelog
no copyable support diagnostics
no explicit compatibility test command
no single release-artifact workflow
no checksum beside generated release ZIP
```

---

# Global Constraints

- Do not add telemetry.
- Do not add a backend.
- Do not add analytics or crash-reporting SDKs.
- Do not add persistent code/testcase history.
- Do not add a user/install identifier.
- Do not add broad Chrome permissions.
- Do not send diagnostics automatically.
- Default diagnostics must not contain source code, testcase content, stdout, raw trace data, variable names/values, expression values, decision values, mutation values, cookies, account identity, or stable source/testcase hashes.
- Keep LeetCode host access exactly scoped unless a separate design explicitly changes it.
- Preserve existing active-tab ownership and latest-wins execution behavior.
- Preserve the evidence-first product boundary.
- Do not claim local `completed` means LeetCode Accepted.
- Do not claim local `timeout` means LeetCode TLE.
- Do not use diagnostics as a second runtime state machine.
- Do not make live LeetCode network access a normal CI dependency.
- Do not automatically publish to Chrome Web Store in this milestone.
- Release artifacts must come from the exact validated commit.
- Generated ZIP/checksum artifacts must not be committed to `main`.

---

# Task 0: Record the Public Release Baseline

**Files:**
- Create: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `README.zh-TW.md`

- [x] **Step 1: Add `CHANGELOG.md`**

Use a compact public-product changelog:

```md
# Changelog

## [Unreleased]

### Added

### Changed

### Fixed

## [0.1.0] - <actual publication date>

### Added
- Initial public Chrome Web Store release.
- Live LeetCode Python source/testcase synchronization.
- Local Pyodide execution and trace replay.
- List, matrix, linked-list, tree, graph, and recursion-oriented visualization.
- Runtime expression, decision, mutation, control-flow, and behavioral evidence.
- Failure-first inspection and pinned-baseline behavioral diff.
```

Use the actual Web Store publication date if known from release records. Do not invent a date merely to fill the field; if it cannot be confirmed during implementation, omit the date from the heading until it can be verified.

Do not reproduce the commit log.

- [x] **Step 2: Replace the English release-candidate status**

Remove wording equivalent to:

```text
Current status: preparing v0.1.0 release candidate.
Release freeze: ...
```

Replace with a concise maintenance statement:

```text
Current stable release: v0.1.0.

v0.1.x is reserved for compatibility, correctness, recovery, diagnostics, and release-maintenance fixes.
New debugging capabilities target a future minor release.
```

Exact prose may be tightened.

- [x] **Step 3: Mirror the state in Traditional Chinese**

Keep English and Traditional Chinese release semantics equivalent.

- [x] **Step 4: Add the post-release maintenance documents to Project documents**

Add links to:

```text
docs/superpowers/specs/2026-09-28-post-release-maintenance-design.md
docs/superpowers/plans/2026-09-28-post-release-maintenance-implementation-plan.md
```

Do not reorder the entire historical document list unless necessary.

- [x] **Step 5: Sanity check**

Verify:

- no README claims v0.1.0 is still unreleased;
- no README implies v0.2.0 is already implemented;
- privacy copy still matches runtime behavior;
- relative links resolve.

- [x] **Step 6: Commit**

```bash
git add CHANGELOG.md README.md README.zh-TW.md
git commit -m "docs: transition repository to post release maintenance"
```

---

# Task 1: Define the Diagnostic Data Contract

**Files:**
- Create: `src/sidepanel/diagnostics.ts`
- Create: `tests/sidepanel/diagnostics.test.ts`

The first implementation task for diagnostics is a typed, pure contract. Do not begin with UI.

## Required model

Create bounded status-only types. Exact naming may follow existing code style, but the model should be equivalent to:

```ts
export type DiagnosticAvailability =
  | "ready"
  | "waiting"
  | "stale"
  | "unavailable"
  | "unknown";

export interface DiagnosticSnapshot {
  extension: {
    version: string;
    manifestVersion: number;
  };
  browser: {
    chrome: string | "unavailable";
    platform: string | "unavailable";
  };
  page: {
    activeContext: "leetcode" | "non_leetcode" | "unavailable";
    problemSlug: string | "unavailable";
    language: string | "unavailable";
    pageState: string;
  };
  integration: {
    activeTabOwned: boolean | "unavailable";
    pageBridge: string;
    editorSync: string;
    testcaseState: string;
    selectedCase: number | "unavailable";
  };
  execution: {
    status: string;
    traceEvents: number | "unavailable";
    durationMs: number | "unavailable";
    acceptedSnapshot: boolean;
  };
  visualization: {
    kind: string | "unavailable";
    rawCursor: string | "unavailable";
    baseline: string;
    behavioralDiff: string;
  };
  generatedAt: string;
}
```

Do not put user-bearing trace/value objects into this interface.

- [x] **Step 1: Create the diagnostic type surface**

Prefer closed string unions where the current product already has stable status enums.

Use `string` only where the current subsystem has no stable shared enum and introducing one would over-refactor this patch.

- [x] **Step 2: Add a pure formatter**

Target function:

```ts
export function formatDiagnosticReport(
  snapshot: DiagnosticSnapshot
): string
```

Requirements:

- deterministic field order;
- no JSON dump;
- no arbitrary object serialization;
- one bounded plain-text report;
- stable labels suitable for public GitHub issues.

- [x] **Step 3: Clamp untrusted numeric fields**

For defensive formatting:

- negative event counts → `unavailable`;
- non-finite duration → `unavailable`;
- extremely large values may be bounded before formatting.

Do not stringify unexpected objects.

- [x] **Step 4: Add privacy regression tests**

Tests must construct tempting unsafe objects containing:

```text
sourceCode
testcase
stdout
exception.message
locals
globals
variables
trace
rawTrace
objectSnapshot
expressionValue
decisionValue
mutationValue
cookie
token
email
```

and prove the formatter output contains none of those values.

The formatter should accept only the safe snapshot type, but tests should still guard against accidental future widening.

- [x] **Step 5: Add stable-format tests**

Cover:

- ready state;
- unavailable values;
- timeout status;
- zero-event state;
- baseline none/compatible/incompatible;
- UTC timestamp;
- stable newline layout.

- [x] **Step 6: Run**

```bash
npx vitest run tests/sidepanel/diagnostics.test.ts
npm run typecheck
```

- [x] **Step 7: Commit**

```bash
git add src/sidepanel/diagnostics.ts tests/sidepanel/diagnostics.test.ts
git commit -m "feat: define privacy safe diagnostic report"
```

---

# Task 2: Project Existing Runtime State Into Diagnostics

**Files:**
- Modify: `src/sidepanel/diagnostics.ts`
- Modify: `src/sidepanel/bootstrap.ts`
- Modify if needed: `src/sidepanel/active-tab-source.ts`
- Modify if needed: `src/sidepanel/editor-trace-sync.ts`
- Modify: `tests/sidepanel/diagnostics.test.ts`
- Modify: `tests/sidepanel/bootstrap.test.ts`

Do not create a new polling loop.

Do not inspect rendered DOM text to infer state.

## Target architecture

```text
existing authoritative state
  ├─ active tab ownership
  ├─ current page state
  ├─ editor sync status
  ├─ accepted trace session
  ├─ live execution state
  ├─ visualizer state
  └─ baseline/diff state
          ↓
collectDiagnosticSnapshot(...)
          ↓
DiagnosticSnapshot
```

- [x] **Step 1: Inventory authoritative values already held by `bootstrap.ts`**

Map current variables/state to diagnostics before adding any new state.

At minimum locate:

- active LeetCode/non-LeetCode ownership;
- current problem slug;
- language;
- testcase/case index;
- editor trace status;
- live run status;
- accepted/current session;
- trace event count;
- baseline state;
- behavioral-diff availability.

- [x] **Step 2: Add a pure collector input**

Prefer:

```ts
interface DiagnosticRuntimeView {
  ...
}

export function collectDiagnosticSnapshot(
  runtime: DiagnosticRuntimeView,
  environment: DiagnosticEnvironment,
  now: Date
): DiagnosticSnapshot
```

This keeps Chrome globals out of formatter tests.

- [x] **Step 3: Read extension version from manifest at runtime**

Use:

```ts
chrome.runtime.getManifest()
```

or inject equivalent environment values for testability.

Do not separately hardcode `0.1.1` into UI source.

- [x] **Step 4: Keep browser/platform coarse**

Allowed examples:

```text
chrome: 153
platform: Windows
```

Do not add fingerprinting-oriented fields such as:

- hardware concurrency;
- screen dimensions;
- locale stack;
- installed extensions;
- GPU model.

If browser version cannot be obtained safely/reliably, emit `unavailable`.

- [x] **Step 5: Do not expose exception messages**

Execution status may be:

```text
exception
```

but no value-bearing exception message belongs in the default report.

- [x] **Step 6: Determine visualizer kind from existing typed state**

Do not scrape a DOM heading.

If a stable kind is not exposed by the current visualizer handle, add the smallest typed projection necessary.

- [x] **Step 7: Tests**

Cover:

1. active LeetCode + ready;
2. non-LeetCode active tab;
3. page bridge unavailable;
4. waiting editor;
5. waiting testcase;
6. unsupported language;
7. running;
8. completed;
9. exception;
10. timeout;
11. trace limit;
12. baseline compatible;
13. baseline incompatible;
14. editor sync stale/unavailable;
15. no visualizer.

- [x] **Step 8: Run**

```bash
npx vitest run   tests/sidepanel/diagnostics.test.ts   tests/sidepanel/bootstrap.test.ts
npm run typecheck
```

- [x] **Step 9: Commit**

```bash
git add   src/sidepanel/diagnostics.ts   src/sidepanel/bootstrap.ts   src/sidepanel/active-tab-source.ts   src/sidepanel/editor-trace-sync.ts   tests/sidepanel/diagnostics.test.ts   tests/sidepanel/bootstrap.test.ts

git commit -m "feat: collect runtime diagnostic status"
```

Omit unchanged files from the commit.

---

# Task 3: Add the Support Diagnostics UI

**Files:**
- Create: `src/sidepanel/components/SupportDiagnostics.ts`
- Create: `tests/sidepanel/support-diagnostics.test.ts`
- Modify: `src/sidepanel/bootstrap.ts`
- Modify: `src/sidepanel/styles.css`
- Modify if appropriate: `src/sidepanel/components/AboutPrivacy.ts`

Place diagnostics in the low-priority Settings/About/Support surface, not in the primary visualizer workspace.

## Target UX

```text
Support

Copy diagnostic info

Copies technical status only.
Your code, testcase, variables, stdout, and trace values are not included.
```

- [x] **Step 1: Create an isolated component**

Recommended API:

```ts
createSupportDiagnostics({
  getReport: () => string,
  copyText?: (text: string) => Promise<void>
})
```

Dependency-inject clipboard behavior for tests.

- [x] **Step 2: Implement explicit user-triggered copy**

Prefer:

```ts
navigator.clipboard.writeText(report)
```

when available under a user gesture.

Do not add `clipboardWrite` manifest permission solely for this feature unless browser testing proves the existing approach impossible.

- [x] **Step 3: Add fallback**

If clipboard copy fails:

- expose a selectable `textarea` or `pre`;
- populate it with the same safe report;
- do not silently fail;
- do not show source/testcase as an alternative.

- [x] **Step 4: Add transient success state**

Use a compact `Copied` status.

Do not create toast infrastructure for one button if the existing UI has no such abstraction.

- [x] **Step 5: Ensure diagnostics are generated at click time**

Do not cache a stale report when the component is first mounted.

- [x] **Step 6: Accessibility**

Verify:

- Copy is a real button;
- fallback text can be selected with keyboard;
- success/failure state has readable text;
- no status is color-only.

- [x] **Step 7: Tests**

Cover:

- successful copy;
- report regenerated after state change;
- rejected clipboard promise;
- missing clipboard API;
- fallback appears;
- repeated copy after failure;
- visualizer state is not reset by diagnostic interaction.

- [x] **Step 8: Run**

```bash
npx vitest run   tests/sidepanel/support-diagnostics.test.ts   tests/sidepanel/bootstrap.test.ts
npm run typecheck
```

- [x] **Step 9: Commit**

```bash
git add   src/sidepanel/components/SupportDiagnostics.ts   src/sidepanel/bootstrap.ts   src/sidepanel/styles.css   src/sidepanel/components/AboutPrivacy.ts   tests/sidepanel/support-diagnostics.test.ts   tests/sidepanel/bootstrap.test.ts

git commit -m "feat: add copyable support diagnostics"
```

Omit unchanged files.

---

# Task 4: Update Public Support Surfaces for Diagnostics

**Files:**
- Modify: `docs/store/support.md`
- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Modify: `.github/ISSUE_TEMPLATE/integration_issue.yml`
- Optional modify: `README.md`
- Optional modify: `README.zh-TW.md`

- [x] **Step 1: Add diagnostic instructions**

Support docs should tell users:

```text
Open Settings / Support
→ Copy diagnostic info
→ paste it into the issue
```

Use exact shipping UI wording.

- [x] **Step 2: Add optional diagnostic field to issue forms**

The field must remain optional because:

- older extension versions do not have it;
- users may be unable to open the panel;
- public issue content remains user-controlled.

- [x] **Step 3: Keep privacy warning**

Explicitly say the generated diagnostic report excludes code/testcase values by default.

Still tell users to review public issue content before submission.

- [x] **Step 4: Do not ask for duplicate metadata unnecessarily**

If diagnostics already contain extension version, Chrome version, problem slug, and status, issue forms may keep manual fields for fallback but should not imply both are mandatory.

- [x] **Step 5: Commit**

```bash
git add   docs/store/support.md   .github/ISSUE_TEMPLATE/bug_report.yml   .github/ISSUE_TEMPLATE/integration_issue.yml   README.md README.zh-TW.md

git commit -m "docs: integrate diagnostics into support flow"
```

Omit unchanged README files.

---

# Task 5: Establish the Compatibility Test Suite Entry Point

**Files:**
- Create directory: `tests/compatibility/`
- Create: `tests/compatibility/page-state-contract.test.ts`
- Create: `tests/compatibility/editor-replay-contract.test.ts`
- Create: `tests/compatibility/active-tab-contract.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

This task establishes one command that answers:

> Does the current build satisfy the LeetCode integration contract?

- [x] **Step 1: Add `test:compat`**

Recommended:

```json
"test:compat": "vitest run tests/compatibility"
```

Do not make it call the full `npm test`.

- [x] **Step 2: Build contract tests by importing production modules**

Use current production modules:

```text
src/content/leetcode-adapter.ts
src/content/leetcode-page-state.ts
src/content/content-script.ts
src/content/editor-trace-client.ts
src/page-bridge/leetcode-main-world.ts
src/page-bridge/editor-highlight.ts
src/sidepanel/active-tab-source.ts
src/sidepanel/editor-trace-sync.ts
```

Do not duplicate production parsing logic in test helpers.

- [x] **Step 3: Keep fixtures deterministic**

Use synthetic/recorded DOM and Monaco-like objects.

No network request to LeetCode.

- [x] **Step 4: Add CI step**

Order:

```text
Python fixtures
→ full Vitest
→ compatibility contract
→ typecheck
→ build
→ release package check
```

It is acceptable that compatibility tests are also included in full `npm test`; the explicit step is still valuable as a named contract gate.

- [x] **Step 5: Run**

```bash
npm run test:compat
npm test
npm run typecheck
```

- [x] **Step 6: Commit**

```bash
git add   tests/compatibility   package.json package-lock.json   .github/workflows/ci.yml

git commit -m "test: add leetcode compatibility contract suite"
```

`package-lock.json` should change only if the package command edit causes a legitimate lock metadata change; otherwise omit it.

---

# Task 6: Contract A–E — Page, Editor, Source, Testcase, Case Selection

**Files:**
- Modify: `tests/compatibility/page-state-contract.test.ts`
- Modify only if a regression is discovered:
  - `src/content/leetcode-adapter.ts`
  - `src/content/leetcode-page-state.ts`
  - `src/page-bridge/leetcode-main-world.ts`

The tests should lock the current supported behavior, not redesign it.

## Contract A — problem identity

- [x] LeetCode problem slug is extracted from supported problem-page identity.
- [x] missing/non-problem identity degrades to explicit unavailable/null state.
- [x] changing problem identity changes the page-state identity.

## Contract B — Python editor discovery

- [x] visible active Python Monaco model wins.
- [x] hidden/stale editor models are rejected when visibility is relevant.
- [x] unsupported language is represented explicitly.
- [x] multiple Monaco models do not silently select a non-Python editor.

## Contract C — source synchronization

- [x] changed source creates a changed page-state key/update.
- [x] identical source does not create unnecessary duplicate logical state.
- [x] source sync does not require LeetCode Run or Submit.

## Contract D — testcase discovery

- [x] available testcase produces a runnable snapshot.
- [x] missing testcase produces waiting/unavailable state without clearing valid source.
- [x] malformed/unavailable testcase does not fabricate input.

## Contract E — case selection

- [x] selected case index remains associated with its testcase.
- [x] switching Case changes execution identity.
- [x] stale/background Case state cannot overwrite current active page identity.

- [x] **Run**

```bash
npm run test:compat
```

- [x] **Commit**

If tests pass without production changes:

```bash
git add tests/compatibility/page-state-contract.test.ts
git commit -m "test: lock page state compatibility contracts"
```

If a current regression is discovered, include the smallest production fix and its regression case in the same commit.

---

# Task 7: Contract F–H — SPA Navigation, Tab Ownership, Editor Replay

**Files:**
- Modify: `tests/compatibility/active-tab-contract.test.ts`
- Modify: `tests/compatibility/editor-replay-contract.test.ts`
- Modify only if a regression is discovered:
  - `src/sidepanel/active-tab-source.ts`
  - `src/sidepanel/editor-trace-sync.ts`
  - `src/content/editor-trace-client.ts`
  - `src/content/content-script.ts`
  - `src/page-bridge/editor-highlight.ts`
  - `src/page-bridge/leetcode-main-world.ts`

## Contract F — SPA navigation

- [x] same browser tab can change from problem A to problem B without reload.
- [x] new slug/state replaces the old problem identity.
- [x] source/testcase state is requested/refreshed for the new problem.
- [x] old problem editor replay cannot remain authoritative.

## Contract G — active-tab ownership

- [x] current-window active LeetCode tab owns live state.
- [x] background LeetCode updates are ignored.
- [x] switching active LeetCode tabs refreshes exact-tab state.
- [x] switching to non-LeetCode pauses without fabricating ownership.
- [x] returning to LeetCode resumes from the newly active exact tab.

## Contract H — editor replay

- [x] matching problem + matching source + valid line → synced.
- [x] source mismatch → stale/cleared, never highlight wrong source.
- [x] problem mismatch → no highlight.
- [x] source edit clears existing decoration.
- [x] editor disposal/navigation fails safely.
- [x] `follow=false` does not force scroll.
- [x] `follow=true` scrolls only when required by current behavior.

- [x] **Run**

```bash
npm run test:compat
npm test
```

- [x] **Commit**

```bash
git add   tests/compatibility/active-tab-contract.test.ts   tests/compatibility/editor-replay-contract.test.ts

git commit -m "test: lock tab and editor replay compatibility"
```

Include production files only if fixing an observed regression.

---

# Task 8: Add the Public Integration Failure Classification

**Files:**
- Create: `docs/maintenance/issue-triage.md`
- Modify: `docs/store/support.md`
- Optional modify:
  - `.github/ISSUE_TEMPLATE/bug_report.yml`
  - `.github/ISSUE_TEMPLATE/integration_issue.yml`

Document the maintainer-side categories:

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

- [x] **Step 1: Define severity**

Use:

```text
P0 broad release/security/privacy blocker
P1 major supported workflow broken
P2 localized defect
P3 enhancement
```

- [x] **Step 2: Define maintenance loop**

```text
issue
→ diagnostic/reproduction
→ category + severity
→ regression test
→ smallest fix
→ changelog
→ validation
→ patch artifact
```

- [x] **Step 3: Keep category labels maintainer-facing**

No need to expose internal enum-style labels in the Side Panel.

- [x] **Step 4: Commit**

```bash
git add   docs/maintenance/issue-triage.md   docs/store/support.md   .github/ISSUE_TEMPLATE

git commit -m "docs: define public issue triage workflow"
```

Omit unchanged files.

---

# Task 9: Update the Real-LeetCode Smoke Gate

**Files:**
- Create or modify: `docs/release/v0.1.1-smoke-checklist.md`
- Reference existing smoke evidence under `docs/` rather than deleting it.

The smoke checklist is release evidence, not CI.

## Required integration matrix

- [ ] extension opens from toolbar/Side Panel;
- [ ] public LeetCode problem detected;
- [ ] Python editor source syncs before Run/Submit;
- [ ] testcase state appears;
- [ ] multiple Case switching works;
- [ ] local execution starts;
- [ ] trace visualization renders;
- [ ] switch between two open LeetCode problem tabs;
- [ ] background tab does not steal state;
- [ ] navigate problem A → B through LeetCode SPA;
- [ ] editor replay highlights the matching current line;
- [ ] source edit clears stale replay highlight;
- [ ] non-LeetCode tab pauses;
- [ ] returning to LeetCode resumes;
- [ ] diagnostic report can be copied;
- [ ] diagnostic report contains no code/testcase values.

## Suggested acceptance problems

Use small, stable examples:

```text
704 Binary Search
1 Two Sum
200 Number of Islands
104 Maximum Depth of Binary Tree
```

The smoke gate is not required to test every visualizer family on every patch.

For an integration-only patch, focus on the integration contracts.

- [x] **Step 1: Include environment fields**

Record:

- date;
- Chrome version;
- extension version;
- source commit;
- tested LeetCode problem URLs/slugs;
- pass/fail notes.

- [x] **Step 2: Do not put private source/testcase content into smoke docs**

Use public LeetCode examples and sanitized fixtures.

- [x] **Step 3: Commit**

```bash
git add docs/release/v0.1.1-smoke-checklist.md
git commit -m "docs: define v0.1.1 integration smoke gate"
```

---

# Task 10: Harden the Release ZIP Script for Artifact Automation

**Files:**
- Modify if necessary: `scripts/release-zip.mjs`
- Modify if necessary: `scripts/release-check.mjs`
- Create or modify: `tests/release/release-zip.test.ts`
- Modify: `tests/release/package-validation.test.ts`

First inspect the current `release:zip` behavior.

Do not rewrite working release code merely to fit the workflow.

## Required contract

A successful release build must expose a deterministic artifact path or print a machine-readable-enough final path that the workflow can consume safely.

Example target:

```text
release/leetyourbrain2code-v0.1.1.zip
```

- [x] **Step 1: Ensure output filename derives from package/manifest version**

No separate hardcoded workflow version.

- [x] **Step 2: Ensure release directory is ignored by git**

Do not commit generated ZIPs.

- [x] **Step 3: Ensure ZIP contains `dist/` contents at extension root**

Expected:

```text
manifest.json
sidepanel/...
worker/...
...
```

not:

```text
dist/manifest.json
```

unless the current Web Store package already intentionally uses another proven layout.

- [x] **Step 4: Test filename/version consistency**

A mismatched source manifest/package version must fail before packaging.

- [x] **Step 5: Test package exclusions**

No:

- source specs;
- tests;
- logs;
- `.git`;
- `node_modules` root;
- generated diagnostics;
- secrets.

- [x] **Step 6: Run**

```bash
npm run build
npm run release:check
npm run release:zip
npx vitest run tests/release
```

- [x] **Step 7: Commit**

```bash
git add   scripts/release-zip.mjs   scripts/release-check.mjs   tests/release

git commit -m "build: harden release artifact generation"
```

Omit unchanged files.

---

# Task 11: Add the GitHub Actions Release Artifact Workflow

**Files:**
- Create: `.github/workflows/release-artifact.yml`
- Modify if needed: `package.json`
- Create: `docs/release/release-process.md`

## Trigger

Use:

```yaml
on:
  workflow_dispatch:
  push:
    tags:
      - "v*"
```

The workflow must also be safe when manually dispatched from an exact branch/ref.

## Pipeline

```text
checkout
→ Node 22
→ Python 3.13
→ npm ci
→ Python fixture tests
→ npm test
→ npm run test:compat
→ npm run typecheck
→ npm run build
→ npm run release:check
→ npm run release:zip
→ SHA-256
→ upload ZIP + checksum
```

- [x] **Step 1: Reuse current CI runtime versions**

Do not create unnecessary CI/runtime skew.

- [x] **Step 2: Name artifact with version**

The uploaded GitHub Actions artifact should clearly contain:

```text
leetyourbrain2code-v<version>.zip
leetyourbrain2code-v<version>.zip.sha256
```

or the established release ZIP basename plus `.sha256`.

- [x] **Step 3: Generate SHA-256 outside the extension ZIP**

Linux example:

```bash
sha256sum "$ZIP" > "$ZIP.sha256"
```

- [x] **Step 4: Print release evidence**

Workflow log should show:

- package version;
- source commit SHA;
- ZIP path;
- SHA-256.

Do not inject these into runtime extension files.

- [x] **Step 5: Upload only after every gate is green**

No artifact upload after failed tests/release check.

- [x] **Step 6: Do not publish to Web Store**

No Chrome Web Store API secrets.

- [x] **Step 7: Document manual owner step**

`docs/release/release-process.md`:

```text
1. choose exact release commit/tag
2. run/observe release-artifact workflow
3. download ZIP + checksum
4. verify checksum
5. run final real-LeetCode smoke
6. upload the exact ZIP to Chrome Web Store
7. record Store submission/publication state
```

- [x] **Step 8: Commit**

```bash
git add   .github/workflows/release-artifact.yml   docs/release/release-process.md   package.json package-lock.json

git commit -m "ci: build validated chrome release artifacts"
```

Omit unchanged package files.

---

# Task 12: Add Release-Workflow Static Regression Checks

**Files:**
- Create: `tests/release/workflow.test.ts`
- Modify: `tests/release/package-validation.test.ts`

Do not attempt to execute GitHub Actions inside Vitest.

Test the repository contract statically.

- [x] **Step 1: Read `.github/workflows/release-artifact.yml` in the test**

Assert the workflow includes gates for:

- `npm ci`;
- Python fixtures;
- `npm test`;
- `npm run test:compat`;
- `npm run typecheck`;
- `npm run build`;
- `npm run release:check`;
- `npm run release:zip`;
- SHA-256 generation;
- artifact upload.

- [x] **Step 2: Assert artifact upload occurs after validation commands in workflow order**

A simple structured/textual test is sufficient if robust.

Do not build a YAML framework just for one workflow unless already available.

- [x] **Step 3: Assert no Web Store credentials are introduced**

Search workflow for unexpected publish/secrets patterns associated with automatic Web Store deployment.

Repository secrets in unrelated workflows are outside scope.

- [x] **Step 4: Run**

```bash
npx vitest run tests/release
npm test
```

- [x] **Step 5: Commit**

```bash
git add tests/release/workflow.test.ts tests/release/package-validation.test.ts
git commit -m "test: validate release artifact workflow"
```

---

# Task 13: Bump to v0.1.1 and Prepare the Changelog

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `public/manifest.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `README.zh-TW.md`

Do this only after Tasks 0–12 are green.

- [x] **Step 1: Set version to `0.1.1`**

Keep:

```text
package.json
package-lock.json
public/manifest.json
```

consistent.

- [x] **Step 2: Move relevant Unreleased entries to `0.1.1`**

Expected high-level entries:

```text
Added
- privacy-safe support diagnostics
- explicit LeetCode compatibility regression gate
- reproducible release artifact workflow/checksum

Changed
- repository/release lifecycle now reflects public maintenance

Fixed
- only actual defects discovered during implementation
```

Do not claim fixes that did not occur.

- [x] **Step 3: Update README stable release**

Use `v0.1.1`.

- [x] **Step 4: Run release consistency checks**

```bash
npm test
npm run test:compat
npm run typecheck
npm run build
npm run release:check
npm run release:zip
```

Expected: all pass and generated ZIP name contains `0.1.1`.

- [x] **Step 5: Commit**

```bash
git add   package.json package-lock.json   public/manifest.json   CHANGELOG.md   README.md README.zh-TW.md

git commit -m "chore: prepare v0.1.1 release"
```

---

# Task 14: Full v0.1.1 Regression Audit

No new feature code should be introduced during this task unless a release blocker is found.

- [x] **Step 1: Python fixtures**

```bash
python3 -m unittest discover -s tests/fixtures/python -p "test_*.py"
```

Expected: PASS.

- [x] **Step 2: Full Vitest**

```bash
npm test
```

Expected: PASS.

- [x] **Step 3: Compatibility contract**

```bash
npm run test:compat
```

Expected: PASS.

- [x] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [x] **Step 5: Production build**

```bash
npm run build
```

Expected: PASS.

- [x] **Step 6: Release package validation**

```bash
npm run release:check
```

Expected: PASS.

- [x] **Step 7: Release ZIP**

```bash
npm run release:zip
```

Expected: one v0.1.1 Web Store ZIP.

- [x] **Step 8: Verify generated package manually**

Check:

- root `manifest.json`;
- icons;
- Side Panel entry;
- worker;
- page/content bridge;
- local Pyodide assets;
- no source/test/docs leakage.

- [ ] **Step 9: Execute real-LeetCode smoke checklist**

Complete `docs/release/v0.1.1-smoke-checklist.md`.

Do not mark PASS based solely on unit tests.

- [ ] **Step 10: Verify diagnostic privacy manually**

On a real public problem:

1. use recognizable code/testcase values;
2. create execution state;
3. copy diagnostics;
4. confirm those recognizable values are absent;
5. confirm problem slug/status/version are present.

- [ ] **Step 11: Verify action/Side Panel lifecycle**

- fresh extension reload;
- toolbar action;
- Side Panel reopen;
- LeetCode reload;
- tab switch;
- non-LeetCode switch/back.

---

# Task 15: Record Implementation Completion

**Files:**
- Modify: `docs/superpowers/specs/2026-09-28-post-release-maintenance-design.md`
- Modify: `docs/superpowers/plans/2026-09-28-post-release-maintenance-implementation-plan.md`
- Modify if smoke was completed: `docs/release/v0.1.1-smoke-checklist.md`

After all acceptance gates pass, update the design spec:

```md
# Implementation Status

Implemented:
- post-release README/changelog lifecycle;
- privacy-safe copyable diagnostics;
- diagnostic support/issue workflow;
- explicit LeetCode compatibility contract suite;
- named test:compat CI gate;
- public issue triage guidance;
- v0.1.1 live integration smoke gate;
- reproducible release ZIP workflow;
- release ZIP SHA-256 artifact.

Deferred:
- automatic Chrome Web Store publishing;
- telemetry/crash analytics;
- persistent diagnostic history;
- automatic diagnostic uploads;
- new v0.2 debugging capability.
```

- [x] **Step 1: Mark implementation plan task checkboxes accurately**

Do not mark manual smoke items complete unless actually run.

- [x] **Step 2: Commit**

```bash
git add   docs/superpowers/specs/2026-09-28-post-release-maintenance-design.md   docs/superpowers/plans/2026-09-28-post-release-maintenance-implementation-plan.md   docs/release/v0.1.1-smoke-checklist.md

git commit -m "docs: record v0.1.1 maintenance completion"
```

Omit the smoke file if not changed.

## Current execution status

Tasks 0–13 and Task 14 Steps 1–8 are complete and have automated evidence.
Task 14 Steps 9–11 remain pending because this workspace has no Chrome or
Chromium binary and no interactive LeetCode session. The v0.1.1 smoke
checklist records those manual rows as `PENDING`; they must be completed before
Web Store upload. Task 15 records this state rather than treating automated
tests as live-browser evidence.

---

# Dependency Order

```text
Task 0  repository post-release baseline
   ↓
Task 1  diagnostic data contract
   ↓
Task 2  diagnostic runtime projection
   ↓
Task 3  diagnostic UI
   ↓
Task 4  support integration

Task 5  compatibility suite entry point
   ↓
Task 6  page/editor/testcase contracts
   ↓
Task 7  navigation/tab/replay contracts
   ↓
Task 8  issue triage
   ↓
Task 9  live smoke gate

Task 10 release ZIP automation contract
   ↓
Task 11 GitHub release artifact workflow
   ↓
Task 12 release workflow regression checks
   ↓
Task 13 version/changelog bump
   ↓
Task 14 full regression + live smoke
   ↓
Task 15 completion docs
```

Tasks 1–4 and Tasks 5–9 may proceed in parallel after Task 0 if implemented by separate branches, but do not merge a diagnostics UI before its safe data contract is stable.

Tasks 10–12 may proceed in parallel with diagnostics after Task 0 because they should not depend on Side Panel behavior.

Do not bump to v0.1.1 before the maintenance functionality is green.

---

# Recommended Commit Sequence

```text
docs: transition repository to post release maintenance
feat: define privacy safe diagnostic report
feat: collect runtime diagnostic status
feat: add copyable support diagnostics
docs: integrate diagnostics into support flow
test: add leetcode compatibility contract suite
test: lock page state compatibility contracts
test: lock tab and editor replay compatibility
docs: define public issue triage workflow
docs: define v0.1.1 integration smoke gate
build: harden release artifact generation
ci: build validated chrome release artifacts
test: validate release artifact workflow
chore: prepare v0.1.1 release
docs: record v0.1.1 maintenance completion
```

If implementation discovers no need to change release ZIP code, omit the corresponding production-code commit rather than manufacturing a change.

---

# Definition of Done

The milestone is complete only when all of the following are true:

1. README no longer describes v0.1.0 as a release candidate.
2. English and Traditional Chinese release state agree.
3. root `CHANGELOG.md` exists.
4. v0.1.0 has a concise public release baseline entry.
5. `0.1.x` maintenance scope is documented.
6. diagnostics are user-triggered only.
7. no diagnostics are transmitted automatically.
8. default diagnostics contain no source code.
9. default diagnostics contain no testcase text.
10. default diagnostics contain no stdout.
11. default diagnostics contain no raw trace.
12. default diagnostics contain no local/global variable names or values.
13. default diagnostics contain no expression/decision/mutation values.
14. default diagnostics contain no exception message.
15. default diagnostics contain no cookies/tokens/account identity.
16. default diagnostics contain no source/testcase hash.
17. diagnostics include extension version.
18. diagnostics include coarse active-context state.
19. diagnostics include public problem slug when available.
20. diagnostics include language/page-state status.
21. diagnostics include active-tab ownership status.
22. diagnostics include page-bridge/editor-sync status.
23. diagnostics include testcase readiness and selected Case index.
24. diagnostics include execution status.
25. diagnostics include bounded event count/duration when available.
26. diagnostics include visualization/baseline/diff status when available.
27. diagnostic formatting is deterministic.
28. diagnostics are projected from authoritative typed application state.
29. diagnostics do not scrape rendered DOM to infer runtime state.
30. collector tolerates unavailable subsystems.
31. clipboard success is visible.
32. clipboard failure exposes selectable safe text.
33. diagnostics require no new broad permission.
34. support docs explain how to copy diagnostics.
35. issue forms accept diagnostics as optional evidence.
36. `npm run test:compat` exists.
37. compatibility tests do not require live LeetCode network access.
38. problem identity contract is covered.
39. Python editor discovery contract is covered.
40. source synchronization contract is covered.
41. testcase discovery contract is covered.
42. Case selection contract is covered.
43. SPA navigation contract is covered.
44. active-tab ownership contract is covered.
45. editor replay contract is covered.
46. background tab updates cannot steal ownership in tests.
47. source mismatch cannot highlight stale editor code in tests.
48. compatibility suite runs in CI.
49. public triage categories are documented.
50. P0/P1/P2/P3 maintenance severity is documented.
51. real-LeetCode v0.1.1 smoke checklist exists.
52. smoke checklist includes diagnostics privacy.
53. smoke checklist includes SPA navigation.
54. smoke checklist includes active-tab switching.
55. smoke checklist includes editor replay stale-clearing.
56. release ZIP version derives from package/manifest version.
57. release ZIP contains extension files at the correct root.
58. release package validation still rejects unsafe/unexpected paths.
59. GitHub Actions release artifact workflow exists.
60. workflow supports manual dispatch.
61. workflow supports version tags.
62. workflow runs Python fixtures.
63. workflow runs full Vitest.
64. workflow runs compatibility tests.
65. workflow runs typecheck.
66. workflow runs production build.
67. workflow runs release check.
68. workflow generates release ZIP.
69. workflow generates SHA-256.
70. workflow uploads ZIP/checksum only after validation.
71. workflow does not auto-publish to Chrome Web Store.
72. workflow requires no Web Store credential.
73. release process documents the manual Store upload step.
74. `package.json` version is `0.1.1`.
75. `package-lock.json` version metadata is consistent.
76. manifest version is `0.1.1`.
77. README stable release says `v0.1.1`.
78. changelog contains v0.1.1 maintenance entries.
79. Python fixture suite passes.
80. full Vitest suite passes.
81. compatibility suite passes.
82. `npm run typecheck` passes.
83. `npm run build` passes.
84. `npm run release:check` passes.
85. `npm run release:zip` passes.
86. generated v0.1.1 ZIP is manually inspected.
87. real-LeetCode smoke is recorded before Web Store upload.
88. diagnostic privacy is manually verified with recognizable test values.
89. no new debugging capability was added under the maintenance milestone.
90. no telemetry/backend/persistence was introduced.

---

# Resulting Maintenance Architecture

```text
                    Public user
                        │
                 reports a problem
                        │
                        ▼
               Copy diagnostic info
                        │
        typed safe status projection only
                        │
                        ▼
                  GitHub issue
                        │
              category + severity
                        │
                        ▼
             compatibility fixture
                        │
                        ▼
               smallest safe fix
                        │
                        ▼
        npm test + npm run test:compat
                        │
                        ▼
             validated exact commit
                        │
                        ▼
               release:check
                        │
                        ▼
                release:zip
                        │
                        ▼
          ZIP + SHA-256 Actions artifact
                        │
                        ▼
              real LeetCode smoke
                        │
                        ▼
          manual Chrome Web Store upload
```

This milestone should be considered successful when LeetYourBrain2Code is not merely “published,” but can be maintained through a repeatable evidence-driven patch-release loop without weakening its local-processing privacy model.
