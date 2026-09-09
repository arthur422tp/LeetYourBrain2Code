# Task 1 Report: Pure TraceFoldModel

## Implementation summary

Implemented the pure `TraceFoldModel` projection in `src/sidepanel/trace-folding.ts`.

- Only `repeated_transition` patterns are eligible for folding.
- Evidence identity, complete evidence-step length/content, contiguous indexes, period/repeat dimensions, and raw-trace bounds are validated.
- Valid evidence is partitioned into deterministic repeated-transition iterations.
- Overlapping candidates are selected with weighted interval dynamic programming: maximize total folded raw coverage, then prefer fewer folds, earlier starts, longer spans, smaller periods, and stable pattern IDs.
- Output segments cover the raw trace in ascending order exactly once, with raw gaps represented as `raw:start:end` segments.
- Empty traces return the specified empty model.

## Files changed

- `src/sidepanel/trace-folding.ts` — new pure fold-model interfaces, eligibility validation, overlap selection, and segment emission.
- `tests/sidepanel/trace-folding.test.ts` — new focused tests for eligibility, evidence validation, empty/raw output, overlap optimization, deterministic ties, and exact partitioning.

No raw trace data, core analyzer, or schema files were changed.

## TDD evidence

### RED

Command:

```bash
npx vitest run tests/sidepanel/trace-folding.test.ts
```

Relevant output:

```text
Failed Suites 1
Error: Failed to resolve import "../../src/sidepanel/trace-folding"
... does the file exist?
Tests no tests
```

This was the expected missing-module failure before production implementation.

### GREEN

Focused command:

```bash
npx vitest run tests/sidepanel/trace-folding.test.ts
```

Output:

```text
✓ tests/sidepanel/trace-folding.test.ts (8 tests)
Test Files 1 passed (1)
Tests 8 passed (8)
```

Task gates:

```bash
npm run typecheck
npm run test
```

Results:

```text
tsc --noEmit: passed
Test Files 36 passed (36)
Tests 306 passed (306)
```

## Self-review

- Confirmed the implementation does not mutate input patterns, evidence maps, or raw trace data.
- Confirmed non-transition patterns are ignored.
- Confirmed invalid, missing, partial, gapped, mismatched, duplicate-derived, and out-of-bounds evidence cannot produce folds.
- Confirmed selected candidates are non-overlapping and emitted with raw gaps, so each raw index is represented exactly once.
- Confirmed overlap selection is independent of input pattern order for the specified tie cases.
- Ran `git diff --check` successfully.

## Concerns

No known concerns for the requirements in Task 1. The implementation intentionally exposes only the pure projection API; later outline and visualizer integration remains outside this task.

## Fix report: endpoint and raw-index validation

### Finding addressed

Validated that `firstIndex` and `lastIndex` are integer values bound exactly to the first and last entries of `evidenceIndexes`. Also validated every raw evidence index is an integer. Added a regression test using manually inconsistent endpoint fields, plus a fractional-index case.

### RED

Command:

```bash
npx vitest run tests/sidepanel/trace-folding.test.ts
```

Relevant output before the fix:

```text
tests/sidepanel/trace-folding.test.ts (9 tests | 1 failed)
FAIL ... rejects evidence whose endpoints do not bind the contiguous indexes
expected [ 'p' ] to deeply equal []
Tests 1 failed | 8 passed (9)
```

### GREEN

Commands:

```bash
npx vitest run tests/sidepanel/trace-folding.test.ts
npm run typecheck
```

Output:

```text
✓ tests/sidepanel/trace-folding.test.ts (9 tests)
Test Files 1 passed (1)
Tests 9 passed (9)

tsc --noEmit: passed
```

### Files changed for the fix

- `src/sidepanel/trace-folding.ts` — added integer and endpoint-binding validation.
- `tests/sidepanel/trace-folding.test.ts` — added malformed endpoint and fractional raw-index regression coverage.
- `.superpowers/sdd/2026-09-09-behavioral-trace-folding-implementation-plan/task-1-report.md` — appended this fix report.
