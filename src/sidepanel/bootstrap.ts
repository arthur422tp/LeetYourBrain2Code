export function renderSidePanel(root: HTMLElement): void {
  const title = document.createElement("h1");
  title.textContent = "LeetCode Python Visualizer";

  const status = document.createElement("p");
  status.textContent = "Runtime: not started";

  root.replaceChildren(title, status);
}

if (typeof document !== "undefined") {
  renderSidePanel(document.body);
}
