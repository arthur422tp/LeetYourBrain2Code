# Privacy Policy

Effective date: 2026-09-20

LeetCode Python Execution Visualizer is a Chrome extension that visualizes the local execution behavior of Python code and visible testcases on the active LeetCode page.

## Data accessed

When the extension is active on `leetcode.com`, it reads only the page data required for the visualization:

- the active Python editor source;
- visible testcase text and testcase selection state; and
- problem metadata needed to associate a run with the active problem.

The extension does not ask users for account credentials, and it does not intentionally read unrelated websites.

## Derived locally

The extension derives the following data in the browser:

- execution traces and captured prefixes;
- runtime snapshots and state changes;
- expression, decision, control-flow, mutation, and call-frame evidence; and
- the pinned baseline/current comparison state for the current session.

These derived values are used to render the Side Panel visualization.

## Transmission

The extension does not send LeetCode code, testcase content, runtime traces, comparison data, or support diagnostics to a developer-operated backend. It does not include developer collection, third-party analytics, or telemetry in v0.1.

The extension's packaged runtime may load the locally bundled Pyodide files needed to execute Python in the extension's Web Worker. No CDN-hosted executable runtime is required.

## Persistence

The extension does not intentionally store a persistent history of user code or testcases in v0.1. The current baseline/current comparison state is held in memory for the active Side Panel session. The extension does not use `chrome.storage`, `localStorage`, or IndexedDB for user-code history.

## Permissions and access

- `sidePanel` displays the visualizer beside the active LeetCode problem.
- `scripting` re-establishes the exact-tab page bridge when the LeetCode page needs recovery.
- `https://leetcode.com/*` limits page access to LeetCode pages whose editor and testcase are being visualized.

## Support and contact

For support or privacy questions, use [GitHub Issues](https://github.com/arthur422tp/LeetYourBrain2Code/issues). Before sharing code or testcase content in a public issue, remove anything you do not want to disclose publicly.

If this policy changes, the updated policy will be committed with the release that changes the relevant behavior.
