# Chrome API Support Baseline

This release declares Chrome `114` as its minimum supported browser version.
The baseline is determined by the newest required shipping API, not by the
Manifest V3 introduction date alone.

## Shipping API inventory

| API | Shipping usage | Why it exists | Declared permission or access |
| --- | --- | --- | --- |
| `chrome.sidePanel.setPanelBehavior()` | `src/background/service-worker.ts` | Makes the toolbar action open the extension's Side Panel. | `sidePanel` |
| `chrome.tabs.query()` | `src/sidepanel/active-tab-source.ts` | Finds the active tab in the current window. | Extension page API; LeetCode host access is declared for the page integration. |
| `chrome.tabs.get()` | `src/sidepanel/active-tab-source.ts` | Reconciles the active tab after tab activation or a connection failure. | Extension page API; LeetCode host access is declared for the page integration. |
| `chrome.tabs.sendMessage()` | `src/sidepanel/active-tab-source.ts` | Requests the current LeetCode page state from the content script. | LeetCode host access via `https://leetcode.com/*`. |
| `chrome.tabs.onActivated` | `src/sidepanel/active-tab-source.ts` | Rebinds the Side Panel to the newly active tab. | Extension page API. |
| `chrome.tabs.onUpdated` | `src/sidepanel/active-tab-source.ts` | Detects navigation and completed reloads so page ownership and state can be refreshed. | Extension page API. |
| `chrome.runtime.onMessage` | `src/content/content-script.ts`, `src/sidepanel/active-tab-source.ts` | Receives page-state requests and forwards page-state updates between the content script and Side Panel. | Extension messaging API. |
| `chrome.runtime.sendMessage()` | `src/content/content-script.ts` | Publishes validated page-state updates to the extension. | Extension messaging API. |
| `chrome.runtime.lastError` | `src/content/content-script.ts`, `src/sidepanel/active-tab-source.ts` | Converts expected callback failures into user-visible recovery behavior without leaking stale state. | Extension messaging API. |
| `chrome.runtime.getURL()` | `src/sidepanel/bootstrap.ts` | Resolves the bundled Pyodide worker URL inside the extension package. | Extension runtime API. |
| `chrome.scripting.executeScript()` | `src/sidepanel/active-tab-source.ts` | Recovers a missing content-script receiver after a page navigation or reload. | `scripting` plus `https://leetcode.com/*` host access. |

The content scripts are restricted to `https://leetcode.com/*` in the
manifest. No `tabs`, `activeTab`, `storage`, or broader host permission is
added for these APIs.

## Why the baseline is 114

The official Side Panel API reference lists the API as available in Chrome
114+ for Manifest V3. This extension uses `setPanelBehavior()` from that API,
so Chrome 114 is the release floor.

Other required APIs are older than that floor:

- `chrome.scripting.executeScript()` is available from Chrome 88+ in Manifest
  V3.
- The `world: "MAIN"` execution-world option used by the recovery injection is
  available from Chrome 95+.
- The extension uses no later-only Side Panel methods such as `open()` (Chrome
  116+) or `onOpened`/`onClosed` events.

References:

- [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Manifest `minimum_chrome_version`](https://developer.chrome.com/docs/extensions/reference/manifest/minimum_chrome_version)

## Tested browser baseline

- Declared minimum: Chrome `114` (`public/manifest.json`)
- Primary manually tested version: pending the Task 13 Chrome smoke matrix;
  this document does not claim a manual browser pass before that task runs.
- Chromium assumption: Chrome/Chromium `114+`, Manifest V3 enabled, and a
  normal `https://leetcode.com/` tab. Browser forks are not part of the
  release guarantee unless they implement the same Side Panel and Scripting
  API contracts.

