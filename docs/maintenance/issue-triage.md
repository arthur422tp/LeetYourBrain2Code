# Public Issue Triage

This repository uses the public GitHub issue forms for reproducible bugs,
LeetCode integration failures, and feature requests. The labels below are
maintainer-facing classification vocabulary. They help us connect a report to
the smallest regression test and the correct release gate; users do not need
to know or select the internal category name.

## Maintenance loop

Every actionable report should move through the same loop:

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

The diagnostic report from **Settings / Support → Copy diagnostic info** is a
status summary only. It does not replace reproduction steps, and it must be
reviewed before being pasted into a public issue. If the report is unavailable,
use the manual browser, extension, problem, and visible-status fields in the
issue form.

## Severity

| Level | Maintainer meaning | Default response |
| --- | --- | --- |
| P0 | Broad release blocker, or a security/privacy issue affecting users at scale | Stop the release or patch immediately; confirm scope and publish a recovery path. |
| P1 | A major supported workflow is broken, such as opening a supported LeetCode problem or running Python visualization | Prioritize for the next maintenance patch and add a regression gate before release. |
| P2 | A localized defect with a workaround or a narrow set of affected pages | Schedule a focused fix and document the affected surface. |
| P3 | Enhancement, polish, or behavior outside the current supported contract | Triage for future work; do not present it as a release defect. |

Severity describes user impact, not implementation difficulty. A small code
change can still be P0 or P1 when it breaks a broad supported workflow.

## Maintainer-facing categories

| Category | Use when the report primarily concerns | Useful evidence |
| --- | --- | --- |
| `PAGE_IDENTITY` | Problem slug, title, or non-problem page identity is missing or wrong | Problem URL/slug, diagnostic `problem_slug`, page transition sequence |
| `EDITOR_DISCOVERY` | The Python editor/model is missing, stale, hidden, or the wrong language is selected | Language shown, visible editor state, diagnostic `language` and `page_state` |
| `SOURCE_SYNC` | Code changes are not mirrored, or an old source snapshot is used | Small source edit sequence and whether refresh/reopen changes it |
| `TESTCASE_DISCOVERY` | Testcase controls are unavailable, stale, or incorrectly grouped | Selected testcase state and the point at which controls appeared |
| `CASE_SELECTION` | The selected Case does not match the executed or visualized input | Case number, expected case, and whether switching Case changes the run |
| `SPA_NAVIGATION` | The same browser tab changes problems without a full reload and stale state remains | Problem A → problem B navigation sequence |
| `TAB_OWNERSHIP` | The wrong tab/window owns live state, or background updates leak into the panel | Active window/tab sequence and whether a non-LeetCode tab was selected |
| `PAGE_BRIDGE` | Cross-world messaging, content-script injection, or page-state requests fail | Refresh/reopen result, visible status, diagnostic `page_bridge` |
| `EDITOR_REPLAY` | A trace marker is stale, missing, on the wrong line, or follows incorrectly | Trace step, source/problem identity, follow setting, diagnostic `editor_sync` |
| `WORKER_RUNTIME` | Local Pyodide execution fails, times out, or reports an unexpected runtime status | Diagnostic execution status, whether the issue reproduces on a minimal case |
| `VISUALIZATION` | Execution succeeded but the visualization or evidence is wrong or incomplete | Trace status, visualizer kind/cursor, redacted screenshot |
| `RELEASE_PACKAGE` | Version metadata, manifest, build output, ZIP contents, or checksum is wrong | Extension version, artifact name, release-check output |
| `UNKNOWN` | Evidence does not yet identify a category, or multiple categories remain equally likely | Keep the original evidence and narrow the category during reproduction |

Assign one primary category first. Add a secondary note only when the report
clearly crosses subsystem boundaries; do not use multiple categories to avoid
choosing a likely root cause.

## From issue to patch

Before changing implementation, reproduce the report with a deterministic
fixture or a recorded page-state sequence. The regression test should fail
for the reported behavior and pass after the smallest fix. Then run the
relevant compatibility contract, the full test suite, typecheck, build, and
release-package checks. Update `CHANGELOG.md` when the user-visible behavior
changes, and retain the smoke/release evidence for the patch artifact.

If the report contains private code, testcase values, account information, or
tokens, ask for a redacted reproduction. Do not request credentials or rely
on a public issue to carry sensitive data.
