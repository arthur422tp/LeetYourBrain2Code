# Task 2: Add `TraceOutline`

## Implementation summary

Added the persistent `TraceOutline` side-panel component. It renders the supplied `TraceFoldModel`, starts repeated-transition folds collapsed, expands and collapses motif repetitions locally, emits raw indexes through `onNavigate`, and updates active classes through `setCurrentIndex` without rebuilding the DOM. Empty models render the required neutral state. All interactive controls are native buttons with button types and required accessibility attributes, including `aria-expanded` and `aria-current`.

The component does not own raw cursor/autoplay state and does not call analyzer or runtime code.

## Files changed

- `src/sidepanel/components/TraceOutline.ts`
- `tests/sidepanel/trace-outline.test.ts`
- `.superpowers/sdd/2026-09-09-behavioral-trace-folding-implementation-plan/task-2-report.md`

## TDD evidence

### RED

Command:

```bash
npx vitest run tests/sidepanel/trace-outline.test.ts
```

Output/result:

```text
FAIL  tests/sidepanel/trace-outline.test.ts
Error: Failed to resolve import "../../src/sidepanel/components/TraceOutline"
Tests: no tests
EXIT_CODE=1
```

This was the expected missing-module failure before implementation.

### GREEN

Focused command:

```bash
npx vitest run tests/sidepanel/trace-folding.test.ts tests/sidepanel/trace-outline.test.ts
```

Output/result:

```text
✓ tests/sidepanel/trace-folding.test.ts (9 tests)
✓ tests/sidepanel/trace-outline.test.ts (6 tests)
Test Files  2 passed (2)
Tests  15 passed (15)
EXIT_CODE=0
```

Typecheck command:

```bash
npm run typecheck
```

Result: `tsc --noEmit` completed with `EXIT_CODE=0`.

Full-suite command:

```bash
npm test
```

Result: 37 test files passed, 313 tests passed, `EXIT_CODE=0`.

## Self-review

- Verified the exact exported interfaces and requested file paths.
- Verified the exact fold title, range formatting, captured-step metadata, iteration text, selectors, and neutral-state text.
- Verified expansion is local and persistent across `setCurrentIndex` calls.
- Verified only owning top-level segments receive `aria-current="step"`; iteration rows receive active classes without competing `aria-current` ownership.
- Verified inspect actions emit segment or iteration start indexes only, and toggling never navigates.
- Verified no analyzer, runtime, raw cursor, or autoplay dependency was introduced.
- `git diff --check` completed without errors.

## Concerns

This task intentionally does not wire the new component into side-panel bootstrap or styling beyond the component's required class names; the task brief requested the component boundary and tests only. Integration can be handled by a later task without changing this component's ownership model.

## Commit

The implementation commit is recorded after this report is added.
