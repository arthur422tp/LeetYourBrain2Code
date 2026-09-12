export interface InspectionDetails {
  title: string;
  fields: Array<[label: string, value: string]>;
}

export function inspectionButton(key: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "visualizer-select";
  button.dataset.inspectKey = key;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", "false");
  return button;
}

/** Selection belongs to a visual, and survives replacement of its diagram. */
export function createSelectionInspector(
  section: HTMLElement,
  getDetails: (key: string) => InspectionDetails | null
): { refresh(): void; dispose(): void } {
  let selectedKey: string | undefined;
  const hint = document.createElement("p");
  hint.className = "visualizer-inspector__hint";
  hint.textContent = "Select an item to inspect";
  const panel = document.createElement("div");
  panel.className = "visualizer-inspector";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Selected item details");
  const refresh = (): void => {
    const buttons = [...section.querySelectorAll<HTMLButtonElement>("button[data-inspect-key]")];
    if (!buttons.some((button) => button.dataset.inspectKey === selectedKey)) {
      selectedKey = buttons[0]?.dataset.inspectKey;
    }
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.inspectKey === selectedKey));
    }
    const details = selectedKey === undefined ? null : getDetails(selectedKey);
    panel.replaceChildren();
    if (details) {
      const title = document.createElement("h3");
      title.className = "visualizer-inspector__title";
      title.textContent = details.title;
      const fields = document.createElement("dl");
      for (const [label, value] of details.fields) {
        const row = document.createElement("div");
        const term = document.createElement("dt");
        term.textContent = label;
        const description = document.createElement("dd");
        description.textContent = value;
        row.append(term, description);
        fields.append(row);
      }
      panel.append(title, fields);
    } else {
      panel.textContent = "No items to inspect.";
    }
    // Reattach after a renderer replaces its diagram on a trace step.
    section.append(hint, panel);
  };
  const onClick = (event: MouseEvent): void => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("button[data-inspect-key]") : null;
    if (button && section.contains(button)) {
      selectedKey = button.dataset.inspectKey;
      refresh();
    }
  };
  section.addEventListener("click", onClick);
  refresh();
  return { refresh, dispose: () => section.removeEventListener("click", onClick) };
}
