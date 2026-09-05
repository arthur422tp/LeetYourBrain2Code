import {
  createLeetCodeAdapter,
  LEETCODE_CONTENT_MESSAGE_TYPES,
  validateSnapshot,
  type LeetCodeAdapter
} from "./leetcode-adapter";

export { LEETCODE_CONTENT_MESSAGE_TYPES } from "./leetcode-adapter";

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
    createSnapshotMessageHandler(createLeetCodeAdapter())
  );
}
