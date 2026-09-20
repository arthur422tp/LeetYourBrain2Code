export type RecoveryNoticeState = "connection" | "execution" | "timeout" | "trace_limit";

export interface RecoveryNoticeHandle {
  element: HTMLDivElement;
  update(state: RecoveryNoticeState): void;
}

export function createRecoveryNotice(): RecoveryNoticeHandle {
  const element = document.createElement("div");
  element.className = "recovery-notice";

  const update = (state: RecoveryNoticeState): void => {
    element.dataset.state = state;
    const title = document.createElement("h2");
    const detail = document.createElement("p");

    switch (state) {
      case "connection":
        title.textContent = "Unable to connect to this LeetCode tab.";
        detail.textContent = "Refresh the LeetCode page, then reopen the Side Panel.";
        break;
      case "execution":
        title.textContent = "Local visualization failed.";
        detail.textContent = "Your LeetCode submission was not changed.";
        break;
      case "timeout":
        title.textContent = "Local visualization timed out.";
        detail.textContent = "The captured prefix remains available. This is not a LeetCode TLE result.";
        break;
      case "trace_limit":
        title.textContent = "Visualization trace limit reached.";
        detail.textContent = "The captured prefix remains available for inspection.";
        break;
    }

    title.className = "recovery-notice__title";
    detail.className = "recovery-notice__detail";
    element.replaceChildren(title, detail);
  };

  update("execution");
  return { element, update };
}
