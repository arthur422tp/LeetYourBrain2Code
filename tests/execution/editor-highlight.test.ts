import { afterEach, describe, expect, it, vi } from "vitest";
import { installMainWorldBridge } from "../../src/page-bridge/leetcode-main-world";
import { LEETCODE_MESSAGE_SOURCE } from "../../src/content/leetcode-adapter";
import { requestEditorTrace } from "../../src/content/editor-trace-client";

const sourceCode = "class Solution:\n    def solve(self, n):\n        n += 1\n        return n";
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose());
  delete (window as any).monaco;
  document.body.replaceChildren();
  vi.useRealTimers();
});

function setup() {
  let code = sourceCode;
  const listeners = new Set<() => void>();
  const node = document.createElement("div");
  node.getClientRects = () => [{ width: 800, height: 500 }] as unknown as DOMRectList;
  document.body.append(node);
  const model = {
    getValue: () => code,
    getLanguageId: () => "python",
    onDidChangeContent: (callback: () => void) => {
      listeners.add(callback);
      return { dispose: () => listeners.delete(callback) };
    }
  };
  const editor = {
    getModel: () => model,
    getDomNode: () => node,
    deltaDecorations: vi.fn((_old: string[], _next: unknown[]) => ["trace-decoration"]),
    getVisibleRanges: () => [{ startLineNumber: 1, endLineNumber: 3 }],
    revealLineInCenterIfOutsideViewport: vi.fn(),
    setPosition: vi.fn(), focus: vi.fn(), setValue: vi.fn()
  };
  (window as any).monaco = { editor: { getModels: () => [model], getEditors: () => [editor] } };
  cleanup.push(installMainWorldBridge(window, document));
  const send = (overrides: Record<string, unknown> = {}) => {
    window.dispatchEvent(new MessageEvent("message", { source: window, origin: window.location.origin, data: {
      source: LEETCODE_MESSAGE_SOURCE, type: "set_editor_trace", requestId: "highlight-test",
      location: { sourceCode, problemSlug: null, line: 3, follow: true, ...overrides }
    } }));
  };
  return { editor, model, node, send, edit: (next: string) => { code = next; listeners.forEach(listener => listener()); } };
}

describe("editor trace highlight through the page bridge", () => {
  it("acknowledges highlighting and clearing through the real correlated message client", async () => {
    const { editor } = setup();
    const status = await requestEditorTrace(window, { sourceCode, problemSlug: null, line: 3, follow: true });
    expect(status).toBe("synced");
    expect(editor.deltaDecorations).toHaveBeenCalledTimes(1);
    expect(await requestEditorTrace(window, null)).toBe("cleared");
    expect(editor.deltaDecorations).toHaveBeenLastCalledWith(["trace-decoration"], []);
  });
  it("selects the visible editor instead of a hidden matching model and clears when hidden", () => {
    vi.useFakeTimers();
    const { editor, node, send } = setup();
    const hiddenNode = node.cloneNode() as HTMLElement;
    hiddenNode.hidden = true;
    hiddenNode.getClientRects = node.getClientRects;
    document.body.prepend(hiddenNode);
    const hidden = { ...editor, getDomNode: () => hiddenNode, deltaDecorations: vi.fn() };
    (window as any).monaco.editor.getEditors = () => [hidden, editor];
    send();
    expect(hidden.deltaDecorations).not.toHaveBeenCalled();
    expect(editor.deltaDecorations).toHaveBeenCalledTimes(1);
    node.hidden = true;
    vi.advanceTimersByTime(300);
    expect(editor.deltaDecorations).toHaveBeenLastCalledWith(["trace-decoration"], []);
  });
  it("marks the source line without changing code, focus or the editing cursor", () => {
    const { editor, send } = setup();
    send();
    expect(editor.deltaDecorations).toHaveBeenLastCalledWith([], [expect.objectContaining({
      range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1 },
      options: expect.objectContaining({ isWholeLine: true, linesDecorationsClassName: "leetyb-trace-arrow" })
    })]);
    expect(editor.revealLineInCenterIfOutsideViewport).not.toHaveBeenCalled();
    send({ line: 4 });
    expect(editor.revealLineInCenterIfOutsideViewport).toHaveBeenCalledWith(4);
    expect(editor.setPosition).not.toHaveBeenCalled();
    expect(editor.setValue).not.toHaveBeenCalled();
    expect(editor.focus).not.toHaveBeenCalled();
  });

  it("removes the marker immediately when source changes and rejects an old trace", () => {
    const { editor, send, edit } = setup();
    send();
    edit(sourceCode + "\n# edited");
    expect(editor.deltaDecorations).toHaveBeenLastCalledWith(["trace-decoration"], []);
    editor.deltaDecorations.mockClear();
    send();
    expect(editor.deltaDecorations).not.toHaveBeenCalled();
  });

  it("does not scroll when following is off or keep highlighting after cleanup", () => {
    const { editor, send } = setup();
    send({ line: 4, follow: false });
    expect(editor.revealLineInCenterIfOutsideViewport).not.toHaveBeenCalled();
    cleanup.pop()!();
    expect(editor.deltaDecorations).toHaveBeenLastCalledWith(["trace-decoration"], []);
  });

  it("rejects mismatched problems and invalid source line numbers", () => {
    const { editor, send } = setup();
    send({ problemSlug: "another-problem" });
    send({ line: 500 });
    send({ line: -1 });
    send({ line: 1.5 });
    expect(editor.deltaDecorations).not.toHaveBeenCalled();
  });

  it("expires abandoned highlights if the side panel stops renewing them", () => {
    vi.useFakeTimers();
    const { editor, send } = setup();
    send();
    vi.advanceTimersByTime(7_000);
    expect(editor.deltaDecorations).toHaveBeenLastCalledWith(["trace-decoration"], []);
  });
});
