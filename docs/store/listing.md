# Chrome Web Store Listing Draft

Status: draft for v0.1.0

## Product identity

- Name: LeetYourBrain2Code
- Single purpose: **Visualize and compare the local execution behavior of
  Python solutions and testcases currently open on LeetCode.**
- Suggested category: Developer Tools
- Primary language: English

## Summary

The Chrome Web Store summary is kept below the current 132-character field
limit described in [Chrome's listing guidance](https://developer.chrome.com/docs/webstore/best-listing):

> Visualize Python execution on LeetCode step by step with local runtime evidence.

## Detailed description

See what your Python solution actually does while it runs on LeetCode. Open the
extension in Chrome's Side Panel, choose a visible testcase, and inspect a
step-by-step local execution trace instead of relying only on a final answer or
error message.

The v0.1 release provides:

- source-line, local-variable, return-value, exception, stdout, and container
  state evidence captured from the local run;
- focused visualizations for supported lists, matrices/grids, linked lists,
  binary trees, and graphs;
- a Call Tree / recursion story showing concrete function calls, arguments,
  parent/child relationships, recursion depth, returns, exceptions, and
  incomplete prefixes;
- Expression Evidence, Decision Evidence, mutation evidence, and a behavioral
  timeline for navigating the captured trace;
- a pinned behavioral diff for comparing later local runs of the same testcase;
- recovery states for missing page connections, local failures, timeouts, and
  trace limits while retaining any safely captured prefix.

Execution uses bundled Pyodide in a Web Worker in the browser. The extension
reads the active LeetCode Python editor, visible testcase, and problem metadata
to build the visualization; code, testcase, and trace data are not sent to a
backend. See the [privacy policy](../../PRIVACY.md) and [privacy dashboard
draft](privacy-dashboard.md).

This release visualizes Python solutions only. It is a visual debugger, not a
LeetCode solver, judge, correctness oracle, or replacement for LeetCode's
execution environment. `completed` means the local run returned normally; it
does not mean LeetCode Accepted. A local timeout does not mean LeetCode TLE.
Pyodide also does not perfectly reproduce the LeetCode judge environment.

## Support links

- [Support and issue reporting](support.md)
- [Bug report form](../../.github/ISSUE_TEMPLATE/bug_report.yml)
- [Integration issue form](../../.github/ISSUE_TEMPLATE/integration_issue.yml)
- [Feature request form](../../.github/ISSUE_TEMPLATE/feature_request.yml)

## Submission notes

- Do not submit a screenshot until it has been captured from the real extension
  UI and checked for personal data, account identifiers, and private code.
- Keep the listing, privacy dashboard, privacy policy, manifest permissions,
  and in-product privacy copy synchronized before submission.
- Do not describe unsupported languages, remote execution, automatic diagnosis,
  or judge-equivalent results as product capabilities.
