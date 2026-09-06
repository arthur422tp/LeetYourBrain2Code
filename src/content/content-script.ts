import {
  createLeetCodeAdapter,
  LEETCODE_MESSAGE_SOURCE,
  LEETCODE_MESSAGE_TYPES,
  LEETCODE_CONTENT_MESSAGE_TYPES,
  validatePageState,
  type LeetCodeAdapter,
  type LeetCodePageState
} from "./leetcode-adapter";

export { LEETCODE_CONTENT_MESSAGE_TYPES } from "./leetcode-adapter";

export function createPageStateUpdateHandler(
  pageWindow: Window,
  publish: (state: LeetCodePageState) => void
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
      message.type !== LEETCODE_MESSAGE_TYPES.pageStateUpdated ||
      !validatePageState(message.state)
    ) {
      return;
    }

    publish(message.state);
  };
}

interface PageStateResponse {
  ok: boolean;
  state?: unknown;
  message?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPageStateRequest(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === LEETCODE_CONTENT_MESSAGE_TYPES.requestPageState
  );
}

export function createPageStateMessageHandler(
  adapter: Pick<LeetCodeAdapter, "getPageState">
): (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: PageStateResponse) => void
) => boolean {
  return (message, _sender, sendResponse): boolean => {
    if (!isPageStateRequest(message)) {
      return false;
    }

    void adapter
      .getPageState()
      .then((state) => {
        sendResponse(validatePageState(state) ? { ok: true, state } : {
          ok: false,
          message: "LeetCode adapter returned an invalid page state"
        });
      })
      .catch((error: unknown) => {
        sendResponse({ ok: false, message: errorMessage(error) });
      });
    return true;
  };
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(createPageStateMessageHandler(createLeetCodeAdapter()));
}

if (typeof window !== "undefined") {
  const publishPageStateUpdate = (state: LeetCodePageState): void => {
    if (typeof chrome === "undefined" || typeof chrome.runtime?.sendMessage !== "function") {
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: LEETCODE_CONTENT_MESSAGE_TYPES.pageStateUpdated,
        state
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  };

  window.addEventListener(
    "message",
    createPageStateUpdateHandler(window, publishPageStateUpdate)
  );
}
