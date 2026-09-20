# Chrome Web Store Privacy Dashboard Draft

Status: submission preparation draft. These answers are not a claim that the Chrome Web Store dashboard has already been submitted.

## Single purpose

Visualize and compare the local runtime behavior of Python solutions and testcases currently open on LeetCode.

## Permission justifications

### `sidePanel`

Displays the execution visualizer alongside the active LeetCode problem so users can inspect code execution without leaving the problem page.

### `scripting`

Re-establishes the LeetCode page bridge for the exact active tab when needed so the extension can read the current editor/testcase state reliably.

### `https://leetcode.com/*`

Reads the active LeetCode problem's Python editor, visible testcase controls, and problem metadata required for the user-facing visualization. The host permission is limited to LeetCode.

## Data handling statement

The extension processes the required editor, testcase, problem metadata, and derived runtime evidence locally in the browser. It does not transmit this data to the developer, a remote backend, or third-party analytics. Pyodide is bundled with the extension and runs in a Web Worker.

## Data categories to declare

| Category | Data used | Purpose | Transmission / retention |
| --- | --- | --- | --- |
| Website content | Current LeetCode problem metadata and visible editor/testcase state | Associate a local run with the active problem and render the visualization | Processed locally; no developer or third-party transmission; no intentional persistent user-code history in v0.1 |
| User-provided content | Python source and visible testcase text typed by the user on LeetCode | Execute the selected local draft and show runtime evidence | Processed locally in the browser; baseline/current comparison is memory-only for the active session |
| Derived runtime data | Trace, snapshots, evidence, and pinned comparison state | Display execution behavior and supported behavioral differences | Kept in the active Side Panel session; not sent to a backend |

## Product boundaries

- The extension is Python-only in v0.1.
- Local `completed` does not mean LeetCode Accepted.
- Local `timeout` does not mean LeetCode TLE.
- The extension is not a solver, judge replacement, or correctness diagnosis service.
