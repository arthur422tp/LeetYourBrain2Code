import { afterEach, describe, expect, it, vi } from "vitest";

import { requestEditorTrace } from "../../src/content/editor-trace-client";
import { installMainWorldBridge } from "../../src/page-bridge/leetcode-main-world";
import {
  createEditorTraceSync,
  type EditorTraceTransport
} from "../../src/sidepanel/editor-trace-sync";
import type { EditorTraceLocation, EditorTraceStatus } from "../../src/shared/editor-trace";

const sourceCode = "class Solution:\n    def solve(self, n):\n        return n + 1";
const location: EditorTraceLocation = {
  sourceCode,
  problemSlug: "playground",
  line: 3,
  follow: true
};

afterEach(() => {
  delete (window as Window & { monaco?: unknown }).monaco;
  document.body.replaceChildren();
  vi.useRealTimers();
});

function installMonacoEditor(): {
  editor: {
    deltaDecorations: ReturnType<typeof vi.fn>;
    revealLineInCenterIfOutsideViewport: ReturnType<typeof vi.fn>;
  };
} {
  document.title = "Playground - LeetCode";
  window.history.replaceState({}, "", "/problems/playground/");
  document.body.innerHTML = '<div id="editor-host"></div>';
  const node = document.querySelector<HTMLElement>("#editor-host")!;
  node.getClientRects = () => [{ width: 800, height: 500 }] as unknown as DOMRectList;

  const model = {
    getValue: () => sourceCode,
    getLanguageId: () => "python"
  };
  const editor = {
    getModel: () => model,
    getDomNode: () => node,
    deltaDecorations: vi.fn((_old: string[], _next: unknown[]) => ["trace-decoration"]),
    getVisibleRanges: () => [{ startLineNumber: 1, endLineNumber: 5 }],
    revealLineInCenterIfOutsideViewport: vi.fn()
  };

  Object.defineProperty(window, "monaco", {
    configurable: true,
    value: { editor: { getModels: () => [model], getEditors: () => [editor] } }
  });
  return { editor };
}

describe("LeetCode compatibility: editor replay", () => {
  it("replays and clears a trace through the real message client and page bridge", async () => {
    const { editor } = installMonacoEditor();
    const cleanup = installMainWorldBridge(window, document);

    try {
      await expect(requestEditorTrace(window, location)).resolves.toBe("synced");
      expect(editor.deltaDecorations).toHaveBeenCalledWith(
        [],
        [expect.objectContaining({
          range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1 }
        })]
      );
      await expect(requestEditorTrace(window, null)).resolves.toBe("cleared");
      expect(editor.deltaDecorations).toHaveBeenLastCalledWith(["trace-decoration"], []);
    } finally {
      cleanup();
    }
  });

  it("keeps the side-panel replay owner bounded to the newest request", async () => {
    let resolveOld!: (status: EditorTraceStatus) => void;
    const status = vi.fn();
    const transport = vi.fn<EditorTraceTransport>((tabId, value) => {
      if (tabId === 11 && value !== null) {
        return new Promise((resolve) => { resolveOld = resolve; });
      }
      return Promise.resolve("unavailable");
    });
    const sync = createEditorTraceSync(status, transport);

    sync.update(11, location);
    await Promise.resolve();
    sync.update(22, location);
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith("unavailable"));
    resolveOld("synced");
    await Promise.resolve();

    expect(status).not.toHaveBeenCalledWith("synced");
    expect(transport).toHaveBeenCalledWith(11, null);
    sync.dispose();
  });
});
