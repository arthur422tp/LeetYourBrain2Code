import {
  createLeetCodeAdapter,
  LEETCODE_MESSAGE_SOURCE,
  LEETCODE_MESSAGE_TYPES,
  LEETCODE_CONTENT_MESSAGE_TYPES,
  validateSnapshot,
  type LeetCodeAdapter,
  type LeetCodeSnapshot
} from "./leetcode-adapter";

export { LEETCODE_CONTENT_MESSAGE_TYPES } from "./leetcode-adapter";

export function createPageSnapshotUpdateHandler(
  pageWindow: Window,
  publish: (snapshot: LeetCodeSnapshot) => void
): (event: MessageEvent) => void {
  const pageOrigin = pageWindow.location.origin;

  return (event: MessageEvent): void => {
    if (
      (event.source !== null && event.source !== pageWindow) ||
      (event.origin !== "" && event.origin !== pageOrigin) ||
      typeof event.data !== "object" ||
      event.data === null
    ) {
      return;
    }

    const message = event.data as Record<string, unknown>;
    if (
      message.source !== LEETCODE_MESSAGE_SOURCE ||
      message.type !== LEETCODE_MESSAGE_TYPES.snapshotUpdated ||
      !validateSnapshot(message.snapshot)
    ) {
      return;
    }

    publish(message.snapshot);
  };
}

interface SnapshotResponse {
  ok: boolean;
  snapshot?: unknown;
  message?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSnapshotRequest(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === LEETCODE_CONTENT_MESSAGE_TYPES.requestSnapshot
  );
}

export function createSnapshotMessageHandler(
  adapter: Pick<LeetCodeAdapter, "getSnapshot">
): (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: SnapshotResponse) => void
) => boolean {
  return (message, _sender, sendResponse): boolean => {
    if (!isSnapshotRequest(message)) {
      return false;
    }

    void adapter
      .getSnapshot()
      .then((snapshot) => {
        sendResponse(validateSnapshot(snapshot) ? { ok: true, snapshot } : {
          ok: false,
          message: "LeetCode adapter returned an invalid snapshot"
        });
      })
      .catch((error: unknown) => {
        sendResponse({ ok: false, message: errorMessage(error) });
      });
    return true;
  };
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    createSnapshotMessageHandler(createLeetCodeAdapter({ preferMainWorldSnapshot: true }))
  );
}

if (typeof window !== "undefined") {
  const publishSnapshotUpdate = (snapshot: LeetCodeSnapshot): void => {
    if (typeof chrome === "undefined" || typeof chrome.runtime?.sendMessage !== "function") {
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: LEETCODE_CONTENT_MESSAGE_TYPES.snapshotUpdated,
        snapshot
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  };

  window.addEventListener(
    "message",
    createPageSnapshotUpdateHandler(window, publishSnapshotUpdate)
  );
}
