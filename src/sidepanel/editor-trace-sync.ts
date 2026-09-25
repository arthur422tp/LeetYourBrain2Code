import { LEETCODE_CONTENT_MESSAGE_TYPES } from "../content/leetcode-adapter";
import { isEditorTraceStatus, type EditorTraceLocation, type EditorTraceStatus } from "../shared/editor-trace";

export type EditorTraceTransport = (tabId: number, location: EditorTraceLocation | null) => Promise<EditorTraceStatus>;

export const sendEditorTrace: EditorTraceTransport = (tabId, location) => new Promise(resolve => {
  if (typeof chrome === "undefined" || !chrome.tabs?.sendMessage) { resolve("unavailable"); return; }
  chrome.tabs.sendMessage(tabId, { type: LEETCODE_CONTENT_MESSAGE_TYPES.setEditorTrace, location }, response => {
    if (chrome.runtime.lastError || !isEditorTraceStatus(response?.status)) resolve("unavailable");
    else resolve(response.status);
  });
});

/** Owns one tab's marker; obsolete asynchronous replies cannot update the current UI. */
export function createEditorTraceSync(
  onStatus: (status: EditorTraceStatus) => void,
  transport: EditorTraceTransport = sendEditorTrace
) {
  let tabId: number | null = null;
  let location: EditorTraceLocation | null = null;
  let revision = 0;
  let disposed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const send = (target: number, value: EditorTraceLocation | null): Promise<EditorTraceStatus> =>
    Promise.resolve().then(() => transport(target, value)).catch(() => "unavailable");

  const publish = (): void => {
    if (disposed || tabId === null || location === null) return;
    const requestRevision = ++revision;
    void send(tabId, location).then(status => {
      if (!disposed && revision === requestRevision) onStatus(status);
    });
  };

  const update = (target: number | null, value: EditorTraceLocation | null): void => {
    if (disposed) return;
    ++revision;
    if (tabId !== null && (tabId !== target || value === null)) void send(tabId, null);
    tabId = target;
    location = value;
    if (heartbeat !== undefined) clearInterval(heartbeat);
    heartbeat = undefined;
    if (tabId !== null && location !== null) {
      publish();
      heartbeat = setInterval(publish, 2_000);
    }
  };

  return {
    update,
    dispose: () => { update(null, null); disposed = true; }
  };
}
