export type ReleaseOnboardingState =
  | "no_active_leetcode"
  | "waiting_for_editor"
  | "waiting_for_language"
  | "unsupported_language"
  | "waiting_for_testcase"
  | "ready";

export interface ReleaseOnboardingHandle {
  element: HTMLDivElement;
  update(state: ReleaseOnboardingState, options?: { stale?: boolean }): void;
}

function paragraph(className: string, text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.className = className;
  element.textContent = text;
  return element;
}

function heading(text: string): HTMLHeadingElement {
  const element = document.createElement("h2");
  element.textContent = text;
  return element;
}

export function createReleaseOnboarding(): ReleaseOnboardingHandle {
  const element = document.createElement("div");
  element.className = "release-onboarding trace-placeholder";

  const update = (
    state: ReleaseOnboardingState,
    options: { stale?: boolean } = {}
  ): void => {
    element.dataset.state = state;
    if (options.stale) {
      element.dataset.stale = "true";
    } else {
      delete element.dataset.stale;
    }

    const content: HTMLElement[] = [];
    switch (state) {
      case "no_active_leetcode":
        content.push(paragraph("release-onboarding__message", "Open a LeetCode problem to start visualizing Python execution."));
        break;
      case "waiting_for_editor":
        content.push(heading("Waiting for the LeetCode editor to load…"));
        break;
      case "waiting_for_language":
        content.push(heading("Waiting for LeetCode to identify the editor language…"));
        break;
      case "unsupported_language":
        content.push(heading("Python required"));
        content.push(paragraph("release-onboarding__message", "This release visualizes Python solutions only."));
        content.push(paragraph("release-onboarding__message", "Switch the LeetCode editor language to Python to continue."));
        break;
      case "waiting_for_testcase":
        content.push(heading("Code synced"));
        content.push(paragraph("release-onboarding__message", "Open or enter a testcase on LeetCode to start visualization."));
        break;
      case "ready": {
        content.push(heading("Ready to visualize"));
        const steps = document.createElement("ol");
        for (const text of [
          "Use Python.",
          "Choose or enter a testcase.",
          "Start typing.",
          "The visualization updates automatically."
        ]) {
          const item = document.createElement("li");
          item.textContent = text;
          steps.append(item);
        }
        content.push(steps);
        content.push(paragraph("release-onboarding__local", "Runs locally in your browser."));
        break;
      }
    }

    if (options.stale) {
      content.push(paragraph(
        "release-onboarding__stale",
        "Showing the last captured visualization while this page state is waiting."
      ));
    }

    element.replaceChildren(...content);
  };

  update("ready");
  return { element, update };
}
