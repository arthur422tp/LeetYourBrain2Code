import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorTraceSync, type EditorTraceTransport } from "../../src/sidepanel/editor-trace-sync";
import type { EditorTraceLocation, EditorTraceStatus } from "../../src/shared/editor-trace";

const location: EditorTraceLocation = { sourceCode: "pass\npass", problemSlug: "one", line: 1, follow: true };
afterEach(() => vi.useRealTimers());

describe("editor trace ownership", () => {
  it("clears the old tab and ignores its delayed reply after ownership changes", async () => {
    let resolveOld!: (status: EditorTraceStatus) => void;
    const status = vi.fn();
    const transport = vi.fn<EditorTraceTransport>((tab, value) => tab === 11 && value !== null
      ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve("unavailable"));
    const sync = createEditorTraceSync(status, transport);
    sync.update(11, location);
    await Promise.resolve();
    sync.update(22, location);
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith("unavailable"));
    resolveOld("synced");
    await Promise.resolve();
    expect(status).not.toHaveBeenCalledWith("synced");
    expect(transport).toHaveBeenCalledWith(11, null);
    sync.dispose();
    await Promise.resolve();
    expect(transport).toHaveBeenLastCalledWith(22, null);
  });

  it("renews paused playback and stops renewing after clearing the trace", async () => {
    vi.useFakeTimers();
    const transport = vi.fn<EditorTraceTransport>().mockResolvedValue("synced");
    const sync = createEditorTraceSync(vi.fn(), transport);
    sync.update(11, location);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(transport).toHaveBeenCalledTimes(3);
    sync.update(null, null);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(transport).toHaveBeenCalledTimes(4);
    expect(transport).toHaveBeenLastCalledWith(11, null);
    sync.dispose();
  });
});
