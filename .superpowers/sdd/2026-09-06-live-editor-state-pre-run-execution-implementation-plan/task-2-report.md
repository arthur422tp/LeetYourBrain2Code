# Task 2 Report: Add Partial Page-State Extraction and MAIN-World Transport

Status: DONE

## Summary

Implemented partial LeetCode page-state extraction and MAIN-world page-state transport while preserving the temporary runnable snapshot compatibility path.

Changed:

- `src/content/leetcode-adapter.ts`
  - Added `extractIsolatedPageState()`.
  - Added `requestMainWorldPageState()`.
  - Extended `LeetCodeAdapter` with `getPageState()`.
  - Extended MAIN-world and content-runtime message constants with page-state request/update names while retaining legacy snapshot names.
  - Kept `getSnapshot()` compatibility by projecting page state through `toRunnableSnapshot()` and falling back to the legacy snapshot request path where needed.

- `src/page-bridge/leetcode-main-world.ts`
  - Changed `extractPageState()` to return partial `LeetCodePageState`.
  - Preserved observed empty editor values as `""`.
  - Published `pageStateUpdated` for validated partial page state.
  - Published legacy `snapshotUpdated` only when `toRunnableSnapshot(state)` succeeds.
  - Handled both `requestPageState` and temporary legacy `requestSnapshot` messages.

- `tests/execution/leetcode-adapter.test.ts`
  - Added the requested pre-Run editor fixture without testcase fields.
  - Added tests for partial extraction, code-change updates without testcase, testcase-readiness updates without code changes, and observed empty editor values.

## TDD RED

Command:

```bash
npm test -- tests/execution/leetcode-adapter.test.ts
```

Output:

```text
> leetcode-python-execution-visualizer@0.1.0 test
> vitest run tests/execution/leetcode-adapter.test.ts

 RUN  v3.2.7 /Users/arthuryu/lc_plugin

 ❯ tests/execution/leetcode-adapter.test.ts (15 tests | 4 failed) 2148ms
   ✓ LeetCode adapter > extracts the current code, language, testcase, and metadata from the page 12ms
   ✓ LeetCode adapter > returns null for isolated extraction when a current editor value is unavailable 1ms
   ✓ LeetCode adapter > accepts code when testcase is not available yet 0ms
   ✓ LeetCode adapter > distinguishes an observed empty editor from an unavailable editor 0ms
   ✓ LeetCode adapter > projects only source-complete page state into a runnable snapshot candidate 0ms
   × LeetCode adapter > extracts editor state before testcase controls are available 4ms
     → expected null to deeply equal { …(4) }
   × LeetCode adapter > publishes code changes while testcase is still unavailable 1006ms
     → expected 0 to be greater than 0
   × LeetCode adapter > publishes testcase readiness even when code did not change 1004ms
     → expected undefined to be null
   × LeetCode adapter > reports an observed empty editor as an empty string 3ms
     → expected undefined to be '' // Object.is equality
   ✓ LeetCode adapter > prefers the current Python Monaco model in the main world 3ms
   ✓ LeetCode adapter > prefers the main-world snapshot for the live content-script path 3ms
   ✓ LeetCode adapter > falls back to a validated main-world snapshot 1ms
   ✓ LeetCode adapter > round-trips page extraction through the main-world message bridge 6ms
   ✓ LeetCode adapter > publishes a snapshot update when the LeetCode editor changes 105ms
   ✓ LeetCode adapter > rejects untrusted or malformed snapshots 0ms

 Test Files  1 failed (1)
      Tests  4 failed | 11 passed (15)
```

RED was the expected failure mode: current complete-snapshot extraction returned `null` before testcase controls existed, `pageStateUpdated` did not exist, and an observed empty editor was treated as unavailable.

## TDD GREEN

Focused command:

```bash
npm test -- tests/execution/leetcode-adapter.test.ts
```

Output:

```text
> leetcode-python-execution-visualizer@0.1.0 test
> vitest run tests/execution/leetcode-adapter.test.ts

 RUN  v3.2.7 /Users/arthuryu/lc_plugin

 ✓ tests/execution/leetcode-adapter.test.ts (15 tests) 1097ms
   ✓ LeetCode adapter > falls back to a validated main-world snapshot  754ms

 Test Files  1 passed (1)
      Tests  15 passed (15)
```

## Verification

Typecheck command:

```bash
npm run typecheck
```

Output:

```text
> leetcode-python-execution-visualizer@0.1.0 typecheck
> tsc --noEmit
```

Full project test command:

```bash
npm test
```

Output:

```text
> leetcode-python-execution-visualizer@0.1.0 test
> vitest run

 RUN  v3.2.7 /Users/arthuryu/lc_plugin

 ✓ tests/sidepanel/list-visualizer.test.ts (5 tests) 25ms
 ✓ tests/execution/content-script.test.ts (3 tests) 54ms
 ✓ tests/execution/trace-session-collector.test.ts (5 tests) 49ms
 ✓ tests/sidepanel/trace-visualizer.test.ts (7 tests) 60ms
 ✓ tests/execution/live-execution-scheduler.test.ts (15 tests) 16ms
 ✓ tests/core/state-diff.test.ts (6 tests) 13ms
 ✓ tests/execution/pyodide-worker.test.ts (4 tests) 6ms
 ✓ tests/execution/execution-controller.test.ts (6 tests) 7ms
 ✓ tests/execution/testcase-selection.test.ts (4 tests) 2ms
 ✓ tests/sidepanel/active-tab-source.test.ts (17 tests) 642ms
 ✓ tests/execution/pyodide-runtime.test.ts (7 tests) 5ms
 ✓ tests/execution/testcase-parser.test.ts (5 tests) 3ms
 ✓ tests/core/trace-interpreter.test.ts (5 tests) 4ms
 ✓ tests/execution/execution-request.test.ts (4 tests) 2ms
 ✓ tests/core/visual-model.test.ts (6 tests) 7ms
 ✓ tests/core/state-reconstructor.test.ts (3 tests) 3ms
 ✓ tests/sidepanel/bootstrap.test.ts (17 tests) 930ms
 ✓ tests/execution/entrypoint-resolver.test.ts (5 tests) 3ms
 ✓ tests/execution/leetcode-adapter.test.ts (15 tests) 1109ms
   ✓ LeetCode adapter > falls back to a validated main-world snapshot  755ms
 ✓ tests/core/binding-resolver.test.ts (6 tests) 2ms
 ✓ tests/core/value-snapshot.test.ts (1 test) 1ms
 ✓ tests/protocol/worker-protocol.test.ts (4 tests) 2ms
 ✓ tests/core/primary-container-resolver.test.ts (5 tests) 2ms

 Test Files  23 passed (23)
      Tests  155 passed (155)
```

Whitespace check:

```bash
git diff --check
```

Output: no output, exit code 0.

## Self-Review

- Verified the requested message type values are present verbatim.
- Verified partial page state allows `code`, `language`, and `testcase` to be `null` according to Task 1 validation.
- Verified observed empty editor values are represented as `""`, not `null`.
- Verified MAIN-world updates dedupe on complete page state, so testcase readiness publishes even when code is unchanged.
- Verified legacy snapshot update/request support remains present during the migration and only emits runnable snapshots when projection succeeds.
- No concerns identified.

## Review Fix: Non-runnable Page State Must Not Fall Back To Legacy Snapshot

Status: DONE

Review finding addressed:

- In `preferMainWorldSnapshot` mode, a valid page-state response whose `toRunnableSnapshot()` projection returns `null` must throw `No valid LeetCode snapshot was returned`.
- The adapter must not invoke the temporary legacy snapshot request to recover fields missing from the current page state.
- Legacy snapshot fallback remains available only when page-state transport itself fails or is unavailable.

Added regression test:

- `does not recover a non-runnable page state with a legacy snapshot`

### TDD RED

Command:

```bash
npm test -- tests/execution/leetcode-adapter.test.ts
```

Relevant output:

```text
> leetcode-python-execution-visualizer@0.1.0 test
> vitest run tests/execution/leetcode-adapter.test.ts

 RUN  v3.2.7 /Users/arthuryu/lc_plugin

 ❯ tests/execution/leetcode-adapter.test.ts (16 tests | 1 failed) 1102ms
   × LeetCode adapter > does not recover a non-runnable page state with a legacy snapshot 8ms
     → promise resolved "{ …(4) }" instead of rejecting

 FAIL  tests/execution/leetcode-adapter.test.ts > LeetCode adapter > does not recover a non-runnable page state with a legacy snapshot
AssertionError: promise resolved "{ …(4) }" instead of rejecting

 Test Files  1 failed (1)
      Tests  1 failed | 15 passed (16)
```

RED confirmed the reviewed bug: `getSnapshot()` resolved with the stale legacy snapshot instead of rejecting after receiving valid non-runnable page state.

### TDD GREEN

Command:

```bash
npm test -- tests/execution/leetcode-adapter.test.ts
```

Output:

```text
> leetcode-python-execution-visualizer@0.1.0 test
> vitest run tests/execution/leetcode-adapter.test.ts

 RUN  v3.2.7 /Users/arthuryu/lc_plugin

 ✓ tests/execution/leetcode-adapter.test.ts (16 tests) 1097ms
   ✓ LeetCode adapter > falls back to a validated main-world snapshot  754ms

 Test Files  1 passed (1)
      Tests  16 passed (16)
```

Typecheck command:

```bash
npm run typecheck
```

Output:

```text
> leetcode-python-execution-visualizer@0.1.0 typecheck
> tsc --noEmit
```

Whitespace check:

```bash
git diff --check
```

Output: no output, exit code 0.

Self-review:

- Confirmed projection failure now happens after page-state transport succeeds and outside the transport fallback `catch`.
- Confirmed injected legacy snapshot fallback is skipped when an explicit page-state transport returns valid non-runnable state.
- Confirmed the existing legacy-only compatibility test still passes for the migration path where page-state transport is unavailable.
