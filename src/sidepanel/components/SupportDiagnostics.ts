export interface SupportDiagnosticsOptions {
  getReport: () => string;
  copyText?: (text: string) => Promise<void>;
}

export interface SupportDiagnosticsHandle {
  element: HTMLElement;
}

export function createSupportDiagnostics(
  options: SupportDiagnosticsOptions
): SupportDiagnosticsHandle {
  const element = document.createElement("section");
  element.className = "support-diagnostics";

  const heading = document.createElement("h3");
  heading.className = "support-diagnostics__heading";
  heading.textContent = "Support";

  const description = document.createElement("p");
  description.className = "support-diagnostics__copy";
  description.textContent =
    "Copies technical status only. Your code, testcase, variables, stdout, and trace values are not included.";

  const button = document.createElement("button");
  button.className = "support-diagnostics__button";
  button.type = "button";
  button.textContent = "Copy diagnostic info";

  const status = document.createElement("p");
  status.className = "support-diagnostics__status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const fallback = document.createElement("textarea");
  fallback.className = "support-diagnostics__fallback";
  fallback.setAttribute("aria-label", "Diagnostic information");
  fallback.rows = 8;
  fallback.hidden = true;

  const writeText = options.copyText ?? ((text: string): Promise<void> => {
    if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error("Clipboard API is unavailable"));
  });

  button.addEventListener("click", () => {
    const report = options.getReport();
    status.textContent = "";
    void Promise.resolve(writeText(report)).then(
      () => {
        fallback.hidden = true;
        fallback.value = "";
        status.textContent = "Copied";
      },
      () => {
        fallback.value = report;
        fallback.hidden = false;
        status.textContent = "Unable to copy diagnostic info. Select the text below and copy it manually.";
      }
    );
  });

  element.append(heading, description, button, status, fallback);
  return { element };
}
