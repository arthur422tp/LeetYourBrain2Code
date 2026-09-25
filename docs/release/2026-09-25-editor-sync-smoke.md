# Editor replay synchronization smoke check

Date: 2026-09-25

The production build was exercised in an isolated Chrome for Testing profile on
the public LeetCode Number of Islands page. The live Monaco editor reported its
language as `python3`. A known recursive Python solution and a controlled grid
fixture were used; the harness supplied a hidden testcase element when the
native testcase input was unavailable.

The extension's production sidepanel page was opened in a normal extension tab.
This checks the rendered panel and messaging against a real LeetCode editor, but
does not check Chrome's native sidepanel container or toolbar entry point.

## Observed behavior

- Next and the trace slider updated the original editor's highlighted line to
  match the selected captured event.
- The original editor displayed the full-line marker and gutter arrow without
  moving its editing cursor.
- Editing the source immediately removed the stale marker and reopened the
  recorded-source fallback in the panel.
- Expanding Details retained space for the primary visualization.
- At a viewport height of 700 px, panel widths of 320, 400, and 640 px had no
  horizontal overflow. The playback controls ended at 690 px and remained visible.

| Panel width | Visualization height | Document width |
| --- | --- | --- |
| 320 px | 340.5 px | 320 px |
| 400 px | 357 px | 400 px |
| 640 px | 357 px | 640 px |

The successful replay check used a 66-event captured prefix from a run that hit
the execution time limit. It verifies synchronization and fallback behavior for
that prefix; it is not evidence of a completed algorithm run.

## Local evidence

The following ignored artifacts are available in the checkout used for testing:

- `output/playwright/editor-sync-smoke.mjs`: browser harness.
- `output/playwright/editor-sync-smoke-result.json`: layout measurements.
- `output/playwright/editor-sync-panel.png`: panel screenshot.
- `output/playwright/editor-sync-code.png`: live LeetCode editor screenshot.
- `output/playwright/editor-sync-validation.log`: automated validation output.

To check the native sidepanel in an existing Chrome installation, reload the
unpacked extension from `dist`, refresh the LeetCode page, and reopen its sidepanel.
