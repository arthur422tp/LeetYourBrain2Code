import { describe, expect, it, vi } from "vitest";

import { createSupportDiagnostics } from "../../src/sidepanel/components/SupportDiagnostics";

function mount(options: Parameters<typeof createSupportDiagnostics>[0]) {
  const handle = createSupportDiagnostics(options);
  document.body.append(handle.element);
  return handle;
}

function copyButton(element: HTMLElement): HTMLButtonElement {
  return element.querySelector<HTMLButtonElement>("button")!;
}

describe("SupportDiagnostics", () => {
  it("copies the current report and exposes an accessible success status", async () => {
    const copyText = vi.fn().mockResolvedValue(undefined);
    const handle = mount({ getReport: () => "REPORT_READY", copyText });

    expect(copyButton(handle.element).type).toBe("button");
    copyButton(handle.element).click();

    await vi.waitFor(() => expect(copyText).toHaveBeenCalledWith("REPORT_READY"));
    expect(handle.element.querySelector('[role="status"]')?.textContent).toBe("Copied");
    expect(handle.element.querySelector<HTMLTextAreaElement>("textarea")?.hidden).toBe(true);
  });

  it("generates a fresh report for every user-triggered copy", async () => {
    let report = "REPORT_FIRST";
    const copyText = vi.fn().mockResolvedValue(undefined);
    const handle = mount({ getReport: () => report, copyText });

    copyButton(handle.element).click();
    await vi.waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    report = "REPORT_SECOND";
    copyButton(handle.element).click();

    await vi.waitFor(() => expect(copyText).toHaveBeenCalledTimes(2));
    expect(copyText.mock.calls[1]?.[0]).toBe("REPORT_SECOND");
  });

  it("shows selectable safe report text when clipboard copy is rejected", async () => {
    const copyText = vi.fn().mockRejectedValue(new Error("denied"));
    const handle = mount({ getReport: () => "SAFE_REPORT", copyText });

    copyButton(handle.element).click();

    await vi.waitFor(() => expect(handle.element.querySelector("textarea")).not.toBeNull());
    const fallback = handle.element.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(fallback.value).toBe("SAFE_REPORT");
    expect(fallback.readOnly).toBe(false);
    expect(fallback.getAttribute("aria-label")).toBe("Diagnostic information");
    expect(handle.element.querySelector('[role="status"]')?.textContent)
      .toContain("Unable to copy");
  });

  it("uses a selectable fallback when the clipboard API is missing", async () => {
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined
    });

    try {
      const handle = mount({ getReport: () => "NO_CLIPBOARD_REPORT" });
      copyButton(handle.element).click();

      await vi.waitFor(() => expect(handle.element.querySelector("textarea")).not.toBeNull());
      expect(handle.element.querySelector<HTMLTextAreaElement>("textarea")?.value)
        .toBe("NO_CLIPBOARD_REPORT");
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard
      });
    }
  });

  it("can retry after a failed copy and reports the later success", async () => {
    let attempt = 0;
    const copyText = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("denied");
    });
    const handle = mount({ getReport: () => "RETRY_REPORT", copyText });

    copyButton(handle.element).click();
    await vi.waitFor(() => expect(handle.element.querySelector("textarea")).not.toBeNull());
    copyButton(handle.element).click();

    await vi.waitFor(() => expect(handle.element.querySelector('[role="status"]')?.textContent)
      .toBe("Copied"));
    expect(copyText).toHaveBeenCalledTimes(2);
  });
});
