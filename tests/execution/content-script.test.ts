import { describe, expect, it, vi } from "vitest";

import type { LeetCodeSnapshot } from "../../src/content/leetcode-adapter";
import {
  createSnapshotMessageHandler,
  createPageSnapshotUpdateHandler,
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
