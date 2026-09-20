# Chrome Web Store Screenshot Shot List

Status: shot list only. The final assets must be captured from the real Chrome
extension UI after the Task 13/14 smoke pass; no mockups or generated UI are
acceptable as store evidence.

## Global capture rules

- Canvas: `1280 × 800` pixels.
- Composition: the active LeetCode problem and editor occupy the main area;
  the LC Visualizer Side Panel is open and readable on the right.
- Use a clean browser profile and deterministic fixture data. Hide account
  identifiers, unrelated tabs, bookmarks, notifications, and personal code.
- Keep the Side Panel wide enough for the captioned evidence to remain legible.
- Capture the exact UI state after the trace has settled; do not imply that a
  screenshot shows a result that is not visible in the trace.
- Store the source capture outside the extension package. Only reviewed final
  PNGs belong in the store submission materials.

## Required shots

| # | Fixture and composition | Exact caption |
| ---: | --- | --- |
| 1 | LeetCode 704 Binary Search. Show the editor, current source line, ordered trace controls, and the core list/runtime-state view. | **See every step of your Python search.** |
| 2 | LeetCode 704 Binary Search. Show Decision Evidence for the branch condition alongside Mutation Evidence and the selected source line. | **Understand the branch and the state change.** |
| 3 | LeetCode 104 Maximum Depth of Binary Tree. Show the Call Tree / recursion story with nested frames and the synchronized trace cursor. | **Follow recursion as it unfolds.** |
| 4 | A supported matrix/grid fixture. Show the grid, focused cell, recorded predecessor/path evidence, and the code evidence that produced the change. | **Inspect grid updates with runtime evidence.** |
| 5 | Two compatible runs of the same testcase. Show the pinned baseline and the earliest safely aligned Behavioral Diff. | **Compare runs and find the first observed difference.** |

## Review checklist before upload

- [ ] Captured at exactly `1280 × 800`.
- [ ] Real Side Panel UI is visible and legible.
- [ ] Fixture is reproducible from a public LeetCode problem or a reviewed
      local test case.
- [ ] No personal data, user handle, private code, session information, or
      unrelated browser content is visible.
- [ ] Caption describes visible evidence and does not claim diagnosis,
      correctness, or LeetCode judge equivalence.
- [ ] The five screenshots are visually consistent in browser profile,
      Side Panel width, typography, and theme.

