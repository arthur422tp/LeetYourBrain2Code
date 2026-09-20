# Chrome Web Store Support Draft

## Support channel

Use the public [GitHub Issues](https://github.com/arthur422tp/LeetYourBrain2Code/issues)
page for reproducible bugs, LeetCode integration failures, and feature
requests. Choose the closest issue form:

- [Bug report](../../.github/ISSUE_TEMPLATE/bug_report.yml)
- [Integration issue](../../.github/ISSUE_TEMPLATE/integration_issue.yml)
- [Feature request](../../.github/ISSUE_TEMPLATE/feature_request.yml)

## What to include in a bug report

Please provide:

- the problem slug or URL;
- Chrome version and operating system;
- extension version;
- issue category;
- the smallest reproduction sequence, including the selected testcase when
  relevant;
- an optional screenshot of the visible UI;
- whether the same behavior occurs after refreshing the LeetCode page and
  reopening the Side Panel.

Optional code and testcase fields are useful for local reproduction, but redact
them when they contain private or sensitive material.

## Privacy warning

**Before attaching code or testcase content to a public issue, remove anything
you do not want to share publicly.** GitHub issues are public unless the
repository owner provides a separate private support channel. Do not attach
account credentials, session tokens, private repository code, or personal
data.

The extension itself processes the active LeetCode Python editor, visible
testcase, and trace locally in the browser. See the [privacy policy](../../PRIVACY.md)
and [Chrome Web Store privacy dashboard draft](privacy-dashboard.md) for the
data-access and retention description.

## Scope and response expectations

Support triage can investigate extension behavior, page integration, local
Pyodide execution, visualization evidence, and recovery states. The extension
does not determine whether a solution is correct, reproduce every LeetCode
judge detail, or provide a private channel through a public issue.

