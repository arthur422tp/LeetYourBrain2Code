import { LEETCODE_MESSAGE_SOURCE, LEETCODE_MESSAGE_TYPES } from "./leetcode-adapter";
import { isEditorTraceStatus, type EditorTraceLocation, type EditorTraceStatus } from "../shared/editor-trace";

export function requestEditorTrace(
  pageWindow: Window,
  location: EditorTraceLocation | null,
  timeoutMs = 750
): Promise<EditorTraceStatus> {
  const requestId = pageWindow.crypto.randomUUID();
  const origin = pageWindow.location.origin;
  return new Promise(resolve => {
    const finish = (status: EditorTraceStatus): void => {
      pageWindow.clearTimeout(timeout);
      pageWindow.removeEventListener("message", onMessage);
      resolve(status);
    };
    const onMessage = (event: MessageEvent): void => {
      if ((event.source !== null && event.source !== pageWindow)
        || (event.origin !== "" && event.origin !== origin)) return;
      const message = event.data;
      if (message?.source === LEETCODE_MESSAGE_SOURCE
        && message?.type === LEETCODE_MESSAGE_TYPES.editorTraceResult
        && message?.requestId === requestId && isEditorTraceStatus(message.status)) finish(message.status);
    };
    const timeout = pageWindow.setTimeout(() => finish("unavailable"), timeoutMs);
    pageWindow.addEventListener("message", onMessage);
    pageWindow.postMessage({
      source: LEETCODE_MESSAGE_SOURCE,
      type: LEETCODE_MESSAGE_TYPES.setEditorTrace,
      requestId,
      location
    }, origin && origin !== "null" ? origin : "*");
  });
}
