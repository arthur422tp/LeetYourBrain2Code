import { describe, expect, it } from "vitest";

import {
  createRecoveryNotice,
  type RecoveryNoticeState
} from "../../src/sidepanel/components/RecoveryNotice";

describe("RecoveryNotice", () => {
  it.each([
    ["connection", "Unable to connect to this LeetCode tab.", "Refresh the LeetCode page, then reopen the Side Panel."],
    ["execution", "Local visualization failed.", "Your LeetCode submission was not changed."],
    ["timeout", "Local visualization timed out.", "This is not a LeetCode TLE result."],
    ["trace_limit", "Visualization trace limit reached.", "The captured prefix remains available for inspection."]
  ] as const)("renders factual %s recovery guidance", (state, title, detail) => {
    const handle = createRecoveryNotice();
    handle.update(state as RecoveryNoticeState);

    expect(handle.element.dataset.state).toBe(state);
    expect(handle.element.textContent).toContain(title);
    expect(handle.element.textContent).toContain(detail);
  });

  it("keeps a stable element while switching recovery states", () => {
    const handle = createRecoveryNotice();
    const element = handle.element;

    handle.update("connection");
    handle.update("execution");

    expect(handle.element).toBe(element);
    expect(element.dataset.state).toBe("execution");
  });
});
