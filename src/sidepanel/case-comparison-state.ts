import type { RunRecord } from "./run-comparison-state";

export interface CaseComparisonSelection {
  left: RunRecord | null;
  right: RunRecord | null;
}

export interface CaseComparisonStateController {
  get(): CaseComparisonSelection;
  selectLeft(run: RunRecord): void;
  selectRight(run: RunRecord): void;
  clearLeft(): void;
  clearRight(): void;
  clear(): void;
  clearForProblemChange(): void;
}

export function createCaseComparisonState(): CaseComparisonStateController {
  let left: RunRecord | null = null;
  let right: RunRecord | null = null;

  return {
    get: () => ({ left, right }),
    selectLeft(run) {
      left = run;
    },
    selectRight(run) {
      right = run;
    },
    clearLeft() {
      left = null;
    },
    clearRight() {
      right = null;
    },
    clear() {
      left = null;
      right = null;
    },
    clearForProblemChange() {
      left = null;
      right = null;
    }
  };
}
