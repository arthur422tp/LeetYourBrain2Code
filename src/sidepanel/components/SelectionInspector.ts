export interface InspectionDetails {
  title: string;
  fields: Array<[label: string, value: string]>;
}

export type InspectableElement = HTMLElement | SVGElement;

export function inspectionTarget<T extends InspectableElement>(
  element: T,
  key: string,
  label: string
): T {
  element.dataset.inspectKey = key;
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", label);
  element.setAttribute("aria-pressed", "false");
  if (!(element instanceof HTMLButtonElement)) {
    element.setAttribute("tabindex", "0");
  }
  return element;
}

export function inspectionButton(key: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "visualizer-select";
  return inspectionTarget(button, key, label);
}

/** Selection belongs to a visual, and survives replacement of its diagram. */
export function createSelectionInspector(
  section: HTMLElement,
  getDetails: (key: string) => InspectionDetails | null,
  options: { preferredFallbackKey?: () => string | undefined } = {}
): {
  refresh(): void;
  select(key: string | undefined): void;
  selectedKey(): string | undefined;
  dispose(): void;
} {
  let selectedKey: string | undefined;
  const hint = document.createElement("p");
  hint.className = "visualizer-inspector__hint";
  hint.textContent = "Select an item to inspect";
  const panel = document.createElement("div");
  panel.className = "visualizer-inspector";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Selected item details");
  const refresh = (): void => {
    const targets = [...section.querySelectorAll<InspectableElement>("[data-inspect-key]")];
    if (!targets.some((target) => target.dataset.inspectKey === selectedKey)) {
      const preferred = options.preferredFallbackKey?.();
      selectedKey = preferred && targets.some((target) => target.dataset.inspectKey === preferred)
        ? preferred
        : targets[0]?.dataset.inspectKey;
    }
    for (const target of targets) {
      target.setAttribute("aria-pressed", String(target.dataset.inspectKey === selectedKey));
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
  const select = (key: string | undefined): void => {
    selectedKey = key;
    refresh();
  };
  const onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element
      ? event.target.closest<InspectableElement>("[data-inspect-key]") : null;
    if (target && section.contains(target)) {
      select(target.dataset.inspectKey);
    }
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const target = event.target instanceof Element
      ? event.target.closest<InspectableElement>("[data-inspect-key]") : null;
    if (target && section.contains(target)) {
      event.preventDefault();
      select(target.dataset.inspectKey);
    }
  };
  section.addEventListener("click", onClick);
  section.addEventListener("keydown", onKeyDown);
  refresh();
  return {
    refresh,
    select,
    selectedKey: () => selectedKey,
    dispose: () => {
      section.removeEventListener("click", onClick);
      section.removeEventListener("keydown", onKeyDown);
    }
  };
}
