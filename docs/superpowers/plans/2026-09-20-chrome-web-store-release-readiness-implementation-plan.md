# Chrome Web Store Release Readiness Implementation Plan

> **Execution mode:** implement sequentially, keep each task independently testable, and do not add new debugger capabilities during this milestone.

**Goal:** Produce a release-candidate-quality Chrome extension package for `v0.1.0-rc1` that is installable, privacy-transparent, recoverable for unfamiliar users, reproducibly packaged, and ready for Chrome Web Store submission materials.

**Design spec:** `docs/superpowers/specs/2026-09-20-chrome-web-store-release-readiness-design.md`

**Feature policy:** major feature freeze. Changes to trace schema, Python instrumentation, Call-Frame semantics, Cross-Run Diff alignment, visualization registries, or live scheduling behavior require a confirmed release blocker.

---

# Current Starting Point

The current repository already has:

- a working Manifest V3 extension;
- Side Panel UI;
- local Pyodide execution in a Web Worker;
- LeetCode-only host permission;
- `sidePanel` + `scripting` permissions;
- strong regression coverage;
- green CI with Python tests, Vitest, typecheck, and build;
- `manifest.json` and `package.json` both at `0.1.0`.

Current release gaps:

```text
public/
└─ manifest.json
```

There are currently no:

- extension icons;
- toolbar action metadata;
- privacy policy;
- release packaging scripts;
- package validation gate;
- release checklist;
- store listing draft;
- public-user onboarding/recovery surface;
- support/release documentation.

---

# Global Constraints

- Preserve the product's single purpose.
- Keep host permission limited to `https://leetcode.com/*`.
- Do not add analytics, telemetry, backend calls, accounts, cloud storage, or remote executable code.
- Keep Pyodide packaged locally.
- Do not claim local `completed` means LeetCode Accepted.
- Do not claim local timeout means LeetCode TLE.
- Do not introduce correctness/root-cause/fix language.
- Do not persist user code/testcases in v0.1 unless separately designed and disclosed.
- Store/release copy must match shipping implementation exactly.
- Release ZIP must come from `dist/`, not source directories.
- Do not commit generated release ZIPs.
- License remains an explicit owner decision; do not silently add one.

---

# Task 0: Freeze v0.1 Release Scope and Add Release Checklist

**Files:**
- Create: `docs/release/v0.1.0-release-checklist.md`
- Modify: `README.md`
- Modify: `README.zh-TW.md`

- [ ] **Step 1: Add release checklist skeleton**

Sections:

```text
Engineering
Privacy / permissions
Fresh-install UX
Runtime smoke
Accessibility
Security
Store assets
Packaging
Submission
Post-submission
```

Each item must have a checkbox and explicit pass/fail criteria.

- [ ] **Step 2: Record feature freeze**

Add:

```text
Release freeze: no new major visualization/debugging capability before v0.1.0.
Only release blockers, correctness fixes, integration fixes, and release hardening are allowed.
```

- [ ] **Step 3: Add public release status near README development section**

Keep it factual:

```text
Current status: preparing v0.1.0 release candidate.
```

Do not claim Store availability yet.

- [ ] **Step 4: Run markdown/link sanity manually**

No broken repo-relative paths.

- [ ] **Step 5: Commit**

```bash
git add   docs/release/v0.1.0-release-checklist.md   README.md README.zh-TW.md
git commit -m "docs: add v0.1 release checklist"
```

---

# Task 1: Complete Manifest Product Identity

**Files:**
- Modify: `public/manifest.json`
- Create later in Task 2: `public/icons/*`
- Create: `tests/release/manifest.test.ts`

## Target manifest additions

```json
{
  "short_name": "LC Visualizer",
  "description": "Visualize how your Python code actually executes on LeetCode with local step-by-step runtime evidence.",
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "action": {
    "default_title": "Open LeetCode Python Execution Visualizer",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png"
    }
  }
}
```

Exact description wording may be tightened but must remain factual.

- [ ] **Step 1: Add short_name / description / icons / action declarations**

Do not add broad permissions.

- [ ] **Step 2: Add manifest tests**

Assert:

- manifest_version = 3;
- version matches semver expected format;
- host_permissions exactly LeetCode-only;
- permissions contain no unexpected permission;
- description non-empty;
- action exists;
- required icon declarations exist;
- side_panel path exists declaratively.

- [ ] **Step 3: Do not add minimum_chrome_version yet**

First complete API inventory in Task 7.

- [ ] **Step 4: Run**

```bash
npx vitest run tests/release/manifest.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add public/manifest.json tests/release/manifest.test.ts
git commit -m "feat: complete release manifest identity"
```

---

# Task 2: Create Release Icon Assets

**Files:**
- Create:
  - `public/icons/icon16.png`
  - `public/icons/icon32.png`
  - `public/icons/icon48.png`
  - `public/icons/icon128.png`
- Optional source asset:
  - `docs/store/icon-source.png`

**Design requirement:** use one original, simple icon identity. Do not imitate LeetCode's logo.

Recommended concept:

```text
minimal debugger / execution-flow symbol
+
code bracket or node/step motif
```

The 16px version must remain recognizable.

- [ ] **Step 1: Generate/design one original 1024px source icon**

Use transparent background.

- [ ] **Step 2: Export exact required PNG sizes**

No SVG-only manifest asset.

- [ ] **Step 3: Add asset validation test/script**

Check:

- files exist;
- PNG signature;
- exact dimensions;
- 128px icon not accidentally upscaled from a tiny raster.

- [ ] **Step 4: Build extension and verify icons land in `dist/icons/`**

- [ ] **Step 5: Manual Chrome toolbar/extension-page visual check**

- [ ] **Step 6: Commit**

```bash
git add public/icons docs/store/icon-source.png tests/release
git commit -m "feat: add extension release icons"
```

If source artwork is not intended for the repo, omit it.

---

# Task 3: Make Toolbar Click Open the Side Panel

**Files:**
- Create: `src/background/service-worker.ts`
- Create: `vite.background.config.ts`
- Modify: `public/manifest.json`
- Modify: `package.json`
- Create: `tests/background/service-worker.test.ts`
- Modify: release manifest/package tests

## Target behavior

On extension service-worker initialization:

```ts
void chrome.sidePanel.setPanelBehavior({
  openPanelOnActionClick: true
});
```

No polling, no data handling, no additional host access.

- [ ] **Step 1: Add minimal service worker**

Fail softly if Chrome rejects the setting, but do not hide programming errors in tests.

- [ ] **Step 2: Add background manifest declaration**

```json
"background": {
  "service_worker": "background/service-worker.js",
  "type": "module"
}
```

Use whichever module format the final build reliably emits; keep manifest/build consistent.

- [ ] **Step 3: Add Vite background build**

Output exactly:

```text
dist/background/service-worker.js
```

- [ ] **Step 4: Include background build in `npm run build`**

- [ ] **Step 5: Test API call**

Mock `chrome.sidePanel.setPanelBehavior` and assert one call with:

```ts
{ openPanelOnActionClick: true }
```

- [ ] **Step 6: Manual acceptance**

Toolbar icon click opens the Side Panel on:

- LeetCode tab;
- non-LeetCode tab.

The second case should show actionable paused onboarding, not fail.

- [ ] **Step 7: Commit**

```bash
git add   src/background/service-worker.ts   vite.background.config.ts   public/manifest.json   package.json   tests/background/service-worker.test.ts
git commit -m "feat: open side panel from toolbar action"
```

---

# Task 4: Add Privacy Policy and In-Product Privacy Disclosure

**Files:**
- Create: `PRIVACY.md`
- Create: `docs/store/privacy-dashboard.md`
- Create: `src/sidepanel/components/AboutPrivacy.ts`
- Create: `tests/sidepanel/about-privacy.test.ts`
- Modify: `src/sidepanel/bootstrap.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `README.md`
- Modify: `README.zh-TW.md`

## Privacy policy must document

```text
Data accessed:
- active LeetCode Python editor source
- visible testcase text
- problem metadata

Derived locally:
- runtime trace
- snapshots
- evidence
- pinned baseline/current comparison state

Transmission:
- no backend
- no developer collection
- no third-party analytics

Persistence:
- no intentional persistent user-code history in v0.1
- baseline state is in-memory only

Runtime:
- bundled Pyodide

Support/contact:
- GitHub Issues/project contact path
```

- [ ] **Step 1: Verify implementation before making claims**

Search for:

```text
fetch(
XMLHttpRequest
WebSocket
chrome.storage
localStorage
indexedDB
analytics
telemetry
```

Every runtime hit must be reviewed.

- [ ] **Step 2: Write `PRIVACY.md`**

Do not use vague “we collect nothing” language.

Use precise local-processing language.

- [ ] **Step 3: Add Store dashboard draft**

`docs/store/privacy-dashboard.md` should include:

- single-purpose statement;
- sidePanel justification;
- scripting justification;
- host permission justification;
- local-processing statement;
- data categories to declare.

This is submission preparation, not a claim that Dashboard fields were already submitted.

- [ ] **Step 4: Add collapsed About & privacy block**

Copy:

```text
Runs locally

This extension reads the Python code and testcase on the active LeetCode page
to build the visualization. Execution uses bundled Pyodide in your browser.
Your code and testcase are not sent to a backend.
```

Add link/copy reference to Privacy Policy where feasible in extension UI.

- [ ] **Step 5: Add README privacy section near installation/use area**

- [ ] **Step 6: Tests**

Assert disclosure text exists and is collapsed/non-blocking by default.

- [ ] **Step 7: Commit**

```bash
git add   PRIVACY.md   docs/store/privacy-dashboard.md   src/sidepanel/components/AboutPrivacy.ts   tests/sidepanel/about-privacy.test.ts   src/sidepanel/bootstrap.ts   src/sidepanel/styles.css   README.md README.zh-TW.md
git commit -m "docs: add release privacy disclosures"
```

---

# Task 5: Add Public-User Onboarding and Explicit Waiting States

**Files:**
- Create: `src/sidepanel/components/ReleaseOnboarding.ts`
- Create: `tests/sidepanel/release-onboarding.test.ts`
- Modify: `src/sidepanel/bootstrap.ts`
- Modify: `tests/sidepanel/bootstrap.test.ts`
- Modify: `src/sidepanel/styles.css`

## Required public states

### No active LeetCode tab

```text
Open a LeetCode problem to start visualizing Python execution.
```

### Waiting for editor

```text
Waiting for the LeetCode editor to load…
```

### Unsupported language

```text
Python required

This release visualizes Python solutions only.
Switch the LeetCode editor language to Python to continue.
```

### Waiting for testcase

```text
Code synced

Open or enter a testcase on LeetCode to start visualization.
```

### Ready, no accepted trace yet

```text
1. Use Python.
2. Choose or enter a testcase.
3. Start typing.
4. The visualization updates automatically.

Runs locally in your browser.
```

- [ ] **Step 1: Separate readiness from status text**

Do not overload only `#runtime-status`.

Render a user-facing onboarding/recovery body in the visualization area when no trace is available.

- [ ] **Step 2: Preserve latest useful trace where appropriate**

If an existing trace belongs to the same problem and current page temporarily waits for testcase/editor, do not wipe it unless existing product semantics require invalidation.

Never display old trace as if it were current.

Use status/onboarding text to make staleness explicit when needed.

- [ ] **Step 3: Unsupported language must be explicit**

Current `waiting_for_language` behavior must distinguish:

```text
language missing
vs
known non-Python language
```

Do not run non-Python code.

- [ ] **Step 4: Tests**

Required:

- no LeetCode tab;
- editor missing;
- language missing;
- Java/C++ known language;
- testcase missing;
- fresh Python runnable state;
- onboarding disappears after accepted trace;
- existing trace is not unnecessarily destroyed.

- [ ] **Step 5: Commit**

```bash
git add   src/sidepanel/components/ReleaseOnboarding.ts   tests/sidepanel/release-onboarding.test.ts   src/sidepanel/bootstrap.ts   tests/sidepanel/bootstrap.test.ts   src/sidepanel/styles.css
git commit -m "feat: add public release onboarding states"
```

---

# Task 6: Harden Recovery and Retry UX

**Files:**
- Create: `src/sidepanel/components/RecoveryNotice.ts`
- Create: `tests/sidepanel/recovery-notice.test.ts`
- Modify: `src/sidepanel/bootstrap.ts`
- Modify: `tests/sidepanel/bootstrap.test.ts`
- Modify: `src/sidepanel/styles.css`

## Recoverable states

```text
content-script connection failure
worker/internal execution failure
testcase/editor not mounted
local timeout / trace limit
```

- [ ] **Step 1: Standardize recovery copy**

Connection failure:

```text
Unable to connect to this LeetCode tab.
Refresh the LeetCode page, then reopen the Side Panel.
```

Execution/internal failure:

```text
Local visualization failed.
Your LeetCode submission was not changed.
```

- [ ] **Step 2: Reuse Run now as Retry where possible**

Do not invent a second execution path.

If current snapshot is runnable:

```text
Retry
→ existing immediate/forced scheduler path
```

- [ ] **Step 3: Preserve captured prefix for timeout / trace limit**

No regression to Failure-First or trace prefix.

- [ ] **Step 4: Preserve last stable visualization on transient sync errors where safe**

Do not replace entire result DOM with a generic error if a valid prior trace can remain visible with a stale/recovery banner.

- [ ] **Step 5: Tests**

Required:

- connection error;
- worker rejection;
- retry invokes existing run path;
- prior stable visualization remains where expected;
- fatal problem switch does not retain misleading previous-problem trace.

- [ ] **Step 6: Commit**

```bash
git add   src/sidepanel/components/RecoveryNotice.ts   tests/sidepanel/recovery-notice.test.ts   src/sidepanel/bootstrap.ts   tests/sidepanel/bootstrap.test.ts   src/sidepanel/styles.css
git commit -m "feat: harden side panel recovery states"
```

---

# Task 7: Inventory Chrome APIs and Set Supported Chrome Baseline

**Files:**
- Create: `docs/release/chrome-api-support.md`
- Modify: `public/manifest.json`
- Modify: `tests/release/manifest.test.ts`

- [ ] **Step 1: Inventory all shipping `chrome.*` usage**

At minimum inspect:

```text
chrome.sidePanel
chrome.tabs
chrome.runtime
chrome.scripting
```

List each API and why it exists.

- [ ] **Step 2: Determine minimum supported Chrome version**

Use the newest required shipping API, not only initial Side Panel availability.

- [ ] **Step 3: Add `minimum_chrome_version` only after verification**

Example only:

```json
"minimum_chrome_version": "114"
```

Do not copy this value blindly.

- [ ] **Step 4: Document tested browser baseline**

Record:

- minimum declared;
- primary manually tested version;
- known Chromium assumption.

- [ ] **Step 5: Test manifest field format**

- [ ] **Step 6: Commit**

```bash
git add   docs/release/chrome-api-support.md   public/manifest.json   tests/release/manifest.test.ts
git commit -m "docs: define Chrome release baseline"
```

---

# Task 8: Add Deterministic Release Validation and ZIP Packaging

**Files:**
- Create: `scripts/release-check.mjs`
- Create: `scripts/release-zip.mjs`
- Create: `tests/release/package-validation.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `.github/workflows/ci.yml`

## Scripts

Recommended:

```json
{
  "scripts": {
    "validate": "npm test && npm run typecheck && npm run build",
    "release:check": "node scripts/release-check.mjs",
    "release:zip": "node scripts/release-zip.mjs"
  }
}
```

Do not make `release:zip` silently skip validation.

Preferred:

```text
npm run build
npm run release:check
npm run release:zip
```

- [ ] **Step 1: Validate source manifest/package consistency**

Assert:

```text
manifest.version == package.version
manifest_version == 3
required permissions exact
LeetCode-only host permission
required icons declared
action declared
sidepanel path declared
service worker declared if Task 3 ships
```

- [ ] **Step 2: Validate built package**

Assert files exist:

```text
dist/manifest.json
dist/sidepanel/index.html
dist/worker/pyodide-worker.js
dist/content/leetcode-adapter.js
dist/page-bridge/leetcode-main-world.js
dist/background/service-worker.js
dist/icons/*
dist/pyodide/*
```

Adjust exact Pyodide required entries to actual package output.

- [ ] **Step 3: Remote executable-code guard**

Scan release HTML/JS/manifest for obvious executable remote URLs:

```text
<script src="https://...">
import("https://...")
importScripts("https://...")
```

Allow ordinary documentation strings only if not executable.

Keep guard conservative enough not to false-fail on source text shown in tests.

- [ ] **Step 4: Validate release root contents**

Fail if release archive/package root contains:

```text
src/
tests/
docs/
node_modules/
.git/
*.log
```

- [ ] **Step 5: Generate ZIP from dist only**

Filename:

```text
release/leetcode-python-execution-visualizer-v0.1.0.zip
```

Sort archive entries for deterministic content order.

- [ ] **Step 6: Print release summary**

At minimum:

```text
version
source commit if available
file count
ZIP byte size
SHA-256
```

- [ ] **Step 7: Ignore generated release artifacts**

Add:

```text
release/*.zip
```

- [ ] **Step 8: CI**

After existing build step:

```text
npm run release:check
```

Do not create/upload a ZIP on every PR unless desired; validation is enough.

- [ ] **Step 9: Tests**

```bash
npx vitest run tests/release
npm run build
npm run release:check
npm run release:zip
```

- [ ] **Step 10: Commit**

```bash
git add   scripts   tests/release   package.json   package-lock.json   .gitignore   .github/workflows/ci.yml
git commit -m "build: add release package validation"
```

---

# Task 9: Audit Release Package and Dependencies

**Files:**
- Create: `docs/release/package-audit.md`
- Modify if needed: `vite.config.ts`
- Modify if needed: `scripts/release-check.mjs`

- [ ] **Step 1: Build clean**

```bash
rm -rf dist release
npm ci
npm run build
```

- [ ] **Step 2: Inspect `dist/pyodide`**

Record:

- total size;
- largest files;
- runtime-required package assets;
- obviously unnecessary docs/tests/package metadata if any.

Do not aggressively prune before proving runtime requirements.

- [ ] **Step 3: Measure release ZIP**

Record:

```text
uncompressed dist size
ZIP size
SHA-256
```

- [ ] **Step 4: Run `npm audit`**

Classify findings:

```text
runtime reachable
build/dev only
transitive
no known fix
fix available
```

Do not do risky major dependency upgrades solely to get a zero count.

- [ ] **Step 5: Search secrets/debug artifacts**

Examples:

```text
API_KEY
TOKEN
password
localhost debug endpoints
console debug dumps
source maps
```

Review hits, do not mechanically remove legitimate strings.

- [ ] **Step 6: Commit audit doc and only safe package changes**

```bash
git add docs/release/package-audit.md vite.config.ts scripts
git commit -m "docs: audit release package"
```

---

# Task 10: Add Store Listing and Support Drafts

**Files:**
- Create: `docs/store/listing.md`
- Create: `docs/store/screenshots.md`
- Create: `docs/store/support.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/integration_issue.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Modify: `README.md`
- Modify: `README.zh-TW.md`

## Listing draft

Include:

### Single purpose

```text
Visualize and compare the local execution behavior of Python solutions and
testcases currently open on LeetCode.
```

### Short description

Keep within current Chrome Web Store field limit when implementing.

### Long description

Include only:

- value proposition;
- step-by-step runtime visualization;
- structures;
- recursion/call tree;
- evidence;
- pinned behavioral diff;
- local execution/privacy;
- Python-only boundary;
- not a solver/judge disclaimer.

- [ ] **Step 1: Draft listing**

No unsupported marketing claims.

- [ ] **Step 2: Screenshot shot list**

Use real UI:

1. 704 Binary Search core execution;
2. 704 Decision/Mutation evidence;
3. 104 Call Tree;
4. matrix/grid;
5. Behavioral Diff.

Document desired 1280×800 composition and exact caption.

- [ ] **Step 3: Add support doc**

Explain bug report fields and privacy warning:

```text
Before attaching code or testcase content to a public issue, remove anything
you do not want to share publicly.
```

- [ ] **Step 4: Add issue templates**

Bug report should request:

- problem slug/URL;
- Chrome version;
- extension version;
- category;
- reproduction;
- optional code/testcase;
- screenshot;
- refreshed-page reproduction.

- [ ] **Step 5: Add README support link**

- [ ] **Step 6: Commit**

```bash
git add   docs/store   .github/ISSUE_TEMPLATE   README.md README.zh-TW.md
git commit -m "docs: prepare Chrome Web Store listing"
```

---

# Task 11: License Decision Gate

**Owner decision required.**

This task must not silently choose for the user.

Options:

## A. MIT

Recommended if the goal is permissive open-source reuse with minimal conditions.

## B. Apache-2.0

Permissive plus explicit patent grant/terms.

## C. No open-source license for v0.1

Repository remains publicly viewable but reuse is not broadly licensed.

- [ ] **Step 1: Record explicit owner choice**

- [ ] **Step 2: If A/B, add matching `LICENSE`**

Use canonical license text.

- [ ] **Step 3: Update README license section**

- [ ] **Step 4: Do not affect Store package unless desired**

The extension ZIP does not need the GitHub repo license file unless intentionally included.

- [ ] **Step 5: Commit if changed**

```bash
git add LICENSE README.md README.zh-TW.md
git commit -m "docs: add project license"
```

If option C, document the decision in release checklist and do not create a LICENSE file.

---

# Task 12: Perform Security and Accessibility Release Audit

**Files:**
- Create: `docs/release/security-accessibility-audit.md`
- Modify code/tests only for concrete findings

## Security audit

- [ ] No remote executable code.
- [ ] No unnecessary permissions.
- [ ] Host permission remains LeetCode-only.
- [ ] MAIN-world bridge message surface is minimal.
- [ ] Content-script message handling validates expected shape/source assumptions.
- [ ] User Python runs in worker, not privileged extension UI context.
- [ ] Worker cannot directly access privileged Chrome extension APIs.
- [ ] No credentials/secrets.
- [ ] CSP remains constrained to required WASM support.
- [ ] Hardened sandbox is **not** claimed.

## Accessibility audit

- [ ] Toolbar entry understandable.
- [ ] Onboarding/recovery controls keyboard reachable.
- [ ] Visible focus.
- [ ] `button` used for actions.
- [ ] `details/summary` remains keyboard usable.
- [ ] status messages are textual.
- [ ] diff Baseline/Current is not color-only.
- [ ] Call Tree disclosure remains accessible.
- [ ] Side Panel scrolling does not trap keyboard focus.

- [ ] **Step 1: Add focused automated regressions for concrete failures**

Do not create empty tests merely to tick checklist boxes.

- [ ] **Step 2: Commit**

```bash
git add   docs/release/security-accessibility-audit.md   src tests
git commit -m "test: audit release security and accessibility"
```

---

# Task 13: Run the Fixed Manual Chrome Smoke Matrix

**Files:**
- Modify: `docs/release/v0.1.0-release-checklist.md`
- Create: `docs/release/v0.1.0-smoke-results.md`

Use a production build loaded from `dist/`.

## Lifecycle

- [ ] fresh unpacked install;
- [ ] toolbar click opens Side Panel;
- [ ] close/reopen Side Panel;
- [ ] extension reload;
- [ ] LeetCode page reload;
- [ ] LeetCode tab A → tab B;
- [ ] LeetCode → non-LeetCode → LeetCode.

## Public-user states

- [ ] no active LeetCode;
- [ ] editor not mounted;
- [ ] Python;
- [ ] unsupported language;
- [ ] empty editor;
- [ ] syntax error;
- [ ] missing testcase;
- [ ] multiple Cases;
- [ ] connection failure/reload recovery.

## Fixed problem set

### 704 Binary Search

Verify:

- live sync;
- list visualization;
- Decision Evidence;
- mutation;
- Cross-Run Behavioral Diff;
- Inspect current.

### 206 Reverse Linked List

Verify linked-list state/reference behavior.

### 104 Maximum Depth of Binary Tree

Verify:

- testcase decoding;
- tree;
- recursion;
- Call Path;
- Call Tree;
- returns.

### Matrix / DP fixture

Use one already known-good rectangular grid problem.

Verify matrix viewport/focus and supported overlays/path.

### Graph fixture

Use standard `Node(val, neighbors)`.

Verify graph components/edges/inspection.

## Failure modes

- [ ] runtime exception;
- [ ] trace limit;
- [ ] hard timeout;
- [ ] captured prefix preserved;
- [ ] Failure-First remains optional;
- [ ] local timeout is not described as LeetCode TLE.

## Navigation

- [ ] Previous;
- [ ] Next;
- [ ] Play/Pause;
- [ ] timeline scrub;
- [ ] Call Tree navigation;
- [ ] Behavioral Diff Inspect current.

For each checklist item record:

```text
PASS
FAIL + issue link
N/A + reason
```

No silent unchecked release blockers.

---

# Task 14: Create Store Screenshot Assets From Real UI

**Files:**
- Create: `docs/store/assets/` or another explicitly chosen store-artifact folder
- Modify: `docs/store/screenshots.md`

Do not use fabricated/mock product behavior.

- [ ] **Step 1: Capture real product screenshots**

Target 1280×800 where possible.

- [ ] **Step 2: Select 4–5 strongest images**

Recommended:

```text
704 core execution
704 evidence/diff
104 recursion
matrix
behavioral diff
```

Graph may substitute if visually stronger.

- [ ] **Step 3: Check privacy**

No personal account information, unrelated browser tabs, private testcase/code, or sensitive data.

- [ ] **Step 4: Check readability**

At Store thumbnail scale:

- code/UI legible;
- one clear feature per shot;
- avoid overstuffed panel.

- [ ] **Step 5: Finalize captions**

Captions describe what is shown, not unsupported outcomes.

- [ ] **Step 6: Commit only assets intended to be public repo material**

Large raw capture files may be excluded if not useful to repository users.

---

# Task 15: Cut v0.1.0-rc1

**Prerequisites:** Tasks 0–14 Gate A items green.

- [ ] **Step 1: Clean install**

```bash
rm -rf node_modules dist release
npm ci
```

- [ ] **Step 2: Full automated validation**

```bash
python3 -m unittest discover -s tests/fixtures/python -p "test_*.py"
npm test
npm run typecheck
npm run build
npm run release:check
npm run release:zip
```

- [ ] **Step 3: Verify exact release ZIP**

Record:

```text
filename
version
source SHA
SHA-256
ZIP size
```

- [ ] **Step 4: Load the exact generated ZIP contents/unpacked equivalent**

Run abbreviated final smoke.

- [ ] **Step 5: Mark RC checklist**

```text
v0.1.0-rc1
```

Do not tag stable `v0.1.0` yet.

- [ ] **Step 6: Fix-only RC policy**

Any RC defect:

```text
fix
→ rebuild
→ rerun affected + full release gates
→ rc2
```

No feature additions between RCs.

---

# Task 16: Final v0.1.0 Release and Store Submission Prep

This task starts only after RC acceptance.

**Files:**
- Create: `docs/release/v0.1.0-release-notes.md`
- Modify release checklist
- Optional GitHub Release metadata

- [ ] **Step 1: Final release notes**

Keep concise:

```text
What it does
Main visualization capabilities
Call Tree
Pinned Behavioral Diff
Runs locally
Python-only
Local runtime != LeetCode judge
Known boundaries
```

- [ ] **Step 2: Final package from release commit**

No code change after package unless RC is invalidated.

- [ ] **Step 3: Tag exact source commit**

```text
v0.1.0
```

- [ ] **Step 4: Create GitHub Release**

Attach release notes.

ZIP attachment is optional according to chosen distribution workflow; Chrome Web Store upload remains canonical end-user distribution.

- [ ] **Step 5: Complete Chrome Web Store dashboard**

Use prepared docs for:

- listing;
- screenshots;
- privacy;
- permission justifications;
- distribution settings.

- [ ] **Step 6: Upload exact validated ZIP**

Do not rebuild a different ZIP after Store metadata is entered.

- [ ] **Step 7: Record submission artifact**

In release checklist record:

```text
source SHA
ZIP SHA-256
submitted version
submission date
```

Review approval is external and does not change code-completeness status.

---

# Dependency Order

```text
Task 0  release freeze/checklist
   ↓
Task 1  manifest identity
   ↓
Task 2  icons
   ↓
Task 3  toolbar → Side Panel

Task 4  privacy
   ↓
Task 5  onboarding
   ↓
Task 6  recovery

Task 7  Chrome API baseline

Task 8  package validation/ZIP
   ↓
Task 9  package/dependency audit

Task 10 store/support docs

Task 11 license decision        ← owner decision gate

Task 12 security/accessibility audit
   ↓
Task 13 manual smoke
   ↓
Task 14 screenshots
   ↓
Task 15 v0.1.0-rc1
   ↓
Task 16 v0.1.0 + Store submission
```

Tasks 4, 7, and 10 may proceed in parallel after Task 1.

Do not perform Task 15 until all Gate A checklist items are explicitly green.

---

# Recommended Commit Sequence

```text
docs: add v0.1 release checklist
feat: complete release manifest identity
feat: add extension release icons
feat: open side panel from toolbar action
docs: add release privacy disclosures
feat: add public release onboarding states
feat: harden side panel recovery states
docs: define Chrome release baseline
build: add release package validation
docs: audit release package
docs: prepare Chrome Web Store listing
docs: add project license              # only if owner chooses one
test: audit release security and accessibility
docs: record v0.1 release smoke results
docs: prepare v0.1 release assets
docs: prepare v0.1 release candidate
docs: release v0.1.0
```

---

# Release Blockers vs Non-Blockers

## Must block RC

```text
manifest/file mismatch
missing icons
broken toolbar entry
privacy copy contradicts behavior
unexpected remote executable code
broad/unjustified permissions
release ZIP cannot be reproduced
CI failure
fresh-install failure
unsupported-language silent failure
problem-switch stale trace
worker/runtime crash with no usable recovery
security P0
fixed smoke suite failure
```

## Does not block RC by itself

```text
minor visual spacing
missing post-v0.1 feature
no telemetry
no Firefox port
no AI
no persistent baseline
no Case-to-Case Diff
no automated full-browser E2E
README prose polish beyond correctness
```

---

# Definition of Done

Release Readiness is complete when:

1. v0.1 feature scope is frozen.
2. release checklist exists.
3. manifest description exists.
4. manifest short identity exists.
5. 16/32/48/128 icons exist.
6. manifest icon declarations point to valid files.
7. toolbar action exists.
8. toolbar click opens Side Panel.
9. service worker performs no unrelated work.
10. no new permission was required for toolbar opening.
11. host permission remains LeetCode-only.
12. manifest permission allowlist test passes.
13. privacy policy exists.
14. privacy policy matches actual source/testcase access.
15. privacy policy matches actual local trace processing.
16. privacy policy accurately states transmission behavior.
17. privacy policy accurately states persistence behavior.
18. Store privacy draft exists.
19. sidePanel permission justification exists.
20. scripting permission justification exists.
21. LeetCode host permission justification exists.
22. in-product local-processing disclosure exists.
23. disclosure is non-blocking.
24. no analytics/telemetry is added.
25. no backend is added.
26. no remote executable code is added.
27. Pyodide remains locally bundled.
28. no active LeetCode state is actionable.
29. waiting-for-editor state is explicit.
30. waiting-for-testcase state is explicit.
31. unsupported language is explicit.
32. Python-only boundary is visible.
33. fresh runnable state explains how visualization starts.
34. onboarding disappears after accepted execution.
35. connection failure has recovery instructions.
36. local worker/runtime failure has factual copy.
37. retry reuses existing scheduler/controller path.
38. timeout/trace-limit retains captured prefix.
39. transient sync failure does not unnecessarily erase useful prior context.
40. problem switch cannot leave a misleading prior-problem trace.
41. Chrome API inventory exists.
42. minimum Chrome version is verified or intentionally omitted with documented rationale.
43. package/manifest versions match.
44. release-check script exists.
45. release ZIP script exists.
46. ZIP is built from dist only.
47. ZIP filename includes v0.1.0.
48. release ZIP generation is deterministic in file order/content source.
49. release validation checks manifest existence.
50. release validation checks declared entry files.
51. release validation checks icons.
52. release validation checks Side Panel entry.
53. release validation checks content script.
54. release validation checks page bridge.
55. release validation checks service worker if shipped.
56. release validation checks Pyodide required assets.
57. release validation rejects source/test/docs/node_modules at archive root.
58. release validation checks version consistency.
59. release validation has a remote executable-code guard.
60. release validation runs in CI.
61. generated ZIP is gitignored.
62. package audit records dist size.
63. package audit records ZIP size.
64. package audit records major bundled Pyodide footprint.
65. npm audit findings are classified.
66. no unresolved runtime-critical dependency advisory remains.
67. no secrets are found in shipping package.
68. no unintended debug artifact remains.
69. Store listing draft exists.
70. Store single-purpose statement is concise.
71. Store short description is factual.
72. Store long description is factual.
73. listing states local execution/privacy.
74. listing states Python-only v0.1.
75. listing does not claim solver/judge correctness.
76. support doc exists.
77. public issue privacy warning exists.
78. bug template exists.
79. integration issue template exists.
80. feature request template exists.
81. owner explicitly decides license status.
82. security audit has no unresolved P0.
83. accessibility smoke has no unresolved P0.
84. fresh install smoke passes.
85. toolbar open smoke passes.
86. extension reload smoke passes.
87. LeetCode reload smoke passes.
88. Side Panel reopen smoke passes.
89. tab ownership smoke passes.
90. non-LeetCode pause/resume smoke passes.
91. 704 smoke passes.
92. 206 smoke passes.
93. 104 smoke passes.
94. matrix smoke passes.
95. graph smoke passes.
96. runtime exception smoke passes.
97. trace-limit smoke passes.
98. hard-timeout smoke passes.
99. Cross-Run Behavioral Diff smoke passes.
100. multi-Case smoke passes.
101. Previous/Next navigation smoke passes.
102. Play/Pause smoke passes.
103. Timeline smoke passes.
104. Call Tree navigation smoke passes.
105. Behavioral Diff Inspect current smoke passes.
106. real Store screenshot set is prepared.
107. screenshots contain no private data.
108. release notes exist.
109. exact RC source SHA is recorded.
110. exact RC ZIP SHA-256 is recorded.
111. exact RC ZIP can be loaded and smoke-tested.
112. Python fixture suite passes.
113. full Vitest suite passes.
114. typecheck passes.
115. production build passes.
116. release:check passes.
117. no known release P0 remains.
118. `v0.1.0-rc1` is accepted before stable release.
119. stable `v0.1.0` comes from an accepted RC/fix-only lineage.
120. Store submission ZIP is the exact validated artifact.

---

# Expected Result

After this plan, the project should not merely be “good enough for the author to use.”

It should be:

```text
discoverable
+ understandable
+ privacy-transparent
+ recoverable
+ reproducibly packaged
+ manually acceptance-tested
+ Store-submission ready
```

without destabilizing the debugger core that is already working well.
