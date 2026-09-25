import { extractMetadata, normalizeLanguage } from "../content/leetcode-adapter";
import { sameEditorSource, type EditorTraceLocation, type EditorTraceStatus } from "../shared/editor-trace";

interface Disposable { dispose(): void }
export interface MonacoModelLike {
  getLanguageId(): string;
  getValue(): string;
  onDidChangeContent?(listener: () => void): Disposable;
}
interface Decoration {
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  options: { isWholeLine: boolean; className: string; linesDecorationsClassName: string };
}
interface MonacoEditorLike {
  getModel(): MonacoModelLike | null;
  getDomNode(): HTMLElement | null;
  deltaDecorations(oldIds: string[], decorations: Decoration[]): string[];
  getVisibleRanges?(): Array<{ startLineNumber: number; endLineNumber: number }>;
  revealLineInCenterIfOutsideViewport?(line: number): void;
  onDidChangeModel?(listener: () => void): Disposable;
}
export type MonacoTraceWindow = Window & {
  monaco?: { editor?: {
    getModels?: () => MonacoModelLike[];
    getEditors?: () => MonacoEditorLike[];
  } };
};

const HIGHLIGHT_LEASE_MS = 6_000;

function isVisibleEditor(node: HTMLElement | null): boolean {
  if (!node?.isConnected || node.closest("[hidden]")) return false;
  if (!Array.from(node.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)) return false;
  for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(ancestor);
    if (style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse" || style?.opacity === "0") return false;
  }
  return true;
}

export function createEditorHighlighter(pageWindow: MonacoTraceWindow, doc: Document) {
  let editor: MonacoEditorLike | null = null;
  let model: MonacoModelLike | null = null;
  let ids: string[] = [];
  let subscriptions: Disposable[] = [];
  let location: EditorTraceLocation | null = null;
  let renewedAt = 0;
  let style: HTMLStyleElement | null = null;

  const clear = (): void => {
    subscriptions.splice(0).forEach(subscription => subscription.dispose());
    try { if (editor && ids.length) editor.deltaDecorations(ids, []); } catch { /* Editor may have been disposed by navigation. */ }
    editor = null;
    model = null;
    ids = [];
    location = null;
  };

  const isMatching = (candidate: MonacoModelLike, target: EditorTraceLocation): boolean =>
    normalizeLanguage(candidate.getLanguageId()) === "python"
    && sameEditorSource(candidate.getValue(), target.sourceCode)
    && extractMetadata(doc).slug === target.problemSlug;

  const ensureStyle = (): void => {
    if (style?.isConnected) return;
    style = doc.createElement("style");
    style.dataset.leetybEditorTrace = "true";
    style.textContent = `
      .monaco-editor .leetyb-trace-line { background: rgba(59,130,246,.17); box-shadow: inset 3px 0 #3b82f6; }
      .monaco-editor .leetyb-trace-arrow::before { content: "▶"; color: #3b82f6; font: bold 12px/1.5 sans-serif; }
    `;
    (doc.head ?? doc.documentElement).append(style);
  };

  const set = (next: EditorTraceLocation | null): EditorTraceStatus => {
    if (next === null) { clear(); return "cleared"; }
    try {
      const editors = (pageWindow.monaco?.editor?.getEditors?.() ?? []).filter(item => isVisibleEditor(item.getDomNode()));
      const candidate = editors.find(item => {
        const candidateModel = item.getModel();
        return candidateModel && isMatching(candidateModel, next);
      });
      if (!candidate) {
        clear();
        return editors.length ? "stale" : "unavailable";
      }
      const candidateModel = candidate.getModel()!;
      if (editor !== candidate || model !== candidateModel) {
        clear();
        editor = candidate;
        model = candidateModel;
        const contentSubscription = model.onDidChangeContent?.(clear);
        const modelSubscription = editor.onDidChangeModel?.(clear);
        subscriptions = [contentSubscription, modelSubscription].filter((item): item is Disposable => !!item);
      }
      ensureStyle();
      ids = editor!.deltaDecorations(ids, [{
        range: { startLineNumber: next.line, startColumn: 1, endLineNumber: next.line, endColumn: 1 },
        options: { isWholeLine: true, className: "leetyb-trace-line", linesDecorationsClassName: "leetyb-trace-arrow" }
      }]);
      const moved = location?.line !== next.line || location?.follow !== next.follow;
      location = next;
      renewedAt = Date.now();
      if (next.follow && moved) {
        const visible = editor!.getVisibleRanges?.().some(range => next.line >= range.startLineNumber && next.line <= range.endLineNumber);
        if (!visible) editor!.revealLineInCenterIfOutsideViewport?.(next.line);
      }
      return "synced";
    } catch {
      clear();
      return "unavailable";
    }
  };

  const revalidate = (): void => {
    if (!location) return;
    try {
      if (Date.now() - renewedAt > HIGHLIGHT_LEASE_MS || !editor || !isVisibleEditor(editor.getDomNode())
        || !model || editor.getModel() !== model || !isMatching(model, location)) clear();
    } catch { clear(); }
  };

  return { set, revalidate, dispose: () => { clear(); style?.remove(); } };
}
