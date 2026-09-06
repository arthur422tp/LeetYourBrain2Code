import { describe, expect, it, vi } from "vitest";

import type { LeetCodeSnapshot } from "../../src/content/leetcode-adapter";
import type { LeetCodePageState } from "../../src/content/leetcode-page-state";
import {
  createPageSnapshotUpdateHandler,
  createPageStateMessageHandler,
  createPageStateUpdateHandler,
  createSnapshotMessageHandler,
  LEETCODE_CONTENT_MESSAGE_TYPES
} from "../../src/content/content-script";
import {
  LEETCODE_MESSAGE_SOURCE,
  LEETCODE_MESSAGE_TYPES
} from "../../src/content/leetcode-adapter";

const snapshot: LeetCodeSnapshot = {
  code: "class Solution:\n    def one(self, value):\n        return value\n",
  language: "python",
  testcase: "7",
  metadata: { slug: "one", title: "One" }
};

const partialState: LeetCodePageState = {
  code: "class Solution:\n    def one(self, value):",
  language: "python",
  testcase: null,
  metadata: { slug: "one", title: "One" }
};

describe("content script snapshot handler", () => {
  it("responds with the adapter's current snapshot", async () => {
    const adapter = { getSnapshot: vi.fn(async () => snapshot) };
    const sendResponse = vi.fn();
    const handler = createSnapshotMessageHandler(adapter);

    expect(
      handler({ type: LEETCODE_CONTENT_MESSAGE_TYPES.requestSnapshot }, {}, sendResponse)
    ).toBe(true);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, snapshot })
    );
  });

  it("ignores unrelated runtime messages", () => {
    const adapter = { getSnapshot: vi.fn() };
    const sendResponse = vi.fn();
    const handler = createSnapshotMessageHandler(adapter);

    expect(handler({ type: "other-message" }, {}, sendResponse)).toBe(false);
    expect(adapter.getSnapshot).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("forwards only validated page snapshot updates", () => {
    const publish = vi.fn();
    const handler = createPageSnapshotUpdateHandler(window, publish);

    handler({
      source: window,
      origin: window.location.origin,
      data: {
        source: LEETCODE_MESSAGE_SOURCE,
        type: LEETCODE_MESSAGE_TYPES.snapshotUpdated,
        snapshot
      }
    } as unknown as MessageEvent);

    handler({
      source: window,
      origin: window.location.origin,
      data: {
        source: LEETCODE_MESSAGE_SOURCE,
        type: LEETCODE_MESSAGE_TYPES.snapshotUpdated,
        snapshot: { ...snapshot, code: "" }
      }
    } as unknown as MessageEvent);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(snapshot);
  });
});

describe("content script page-state handler", () => {
  it("responds with partial page state before testcase is available", async () => {
    const adapter = { getPageState: vi.fn(async () => partialState) };
    const sendResponse = vi.fn();
    const handler = createPageStateMessageHandler(adapter);

    expect(
      handler({ type: LEETCODE_CONTENT_MESSAGE_TYPES.requestPageState }, {}, sendResponse)
    ).toBe(true);

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, state: partialState })
    );
  });

  it("ignores unrelated runtime messages", () => {
    const adapter = { getPageState: vi.fn() };
    const sendResponse = vi.fn();
    const handler = createPageStateMessageHandler(adapter);

    expect(handler({ type: "other-message" }, {}, sendResponse)).toBe(false);
    expect(adapter.getPageState).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("forwards validated partial page-state updates", () => {
    const publish = vi.fn();
    const handler = createPageStateUpdateHandler(window, publish);

    handler({
      source: window,
      origin: window.location.origin,
      data: {
        source: LEETCODE_MESSAGE_SOURCE,
        type: LEETCODE_MESSAGE_TYPES.pageStateUpdated,
        state: partialState
      }
    } as unknown as MessageEvent);

    expect(publish).toHaveBeenCalledWith(partialState);
  });

  it("does not forward oversized or malformed page-state updates", () => {
    const publish = vi.fn();
    const handler = createPageStateUpdateHandler(window, publish);

    handler({
      source: window,
      origin: window.location.origin,
      data: {
        source: LEETCODE_MESSAGE_SOURCE,
        type: LEETCODE_MESSAGE_TYPES.pageStateUpdated,
        state: {
          ...partialState,
          code: "x".repeat(1_000_001)
        }
      }
    } as unknown as MessageEvent);

    handler({
      source: window,
      origin: window.location.origin,
      data: {
        source: LEETCODE_MESSAGE_SOURCE,
        type: LEETCODE_MESSAGE_TYPES.pageStateUpdated,
        state: {
          code: partialState.code,
          language: partialState.language
        }
      }
    } as unknown as MessageEvent);

    expect(publish).not.toHaveBeenCalled();
  });
});
