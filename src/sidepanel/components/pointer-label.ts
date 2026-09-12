// Explicit lines keep the DOM label and reserved tree geometry in agreement.
function nameLines(name: string): string[] {
  const lines: string[] = [];
  let line = "";
  let width = 0;
  for (const character of name) {
    const units = character.codePointAt(0)! > 127 ? 2 : 1;
    if (width + units > 8) {
      lines.push(line);
      line = "";
      width = 0;
    }
    line += character;
    width += units;
  }
  lines.push(line);
  return lines;
}

export function appendPointerName(badge: HTMLElement, name: string): void {
  badge.title = name;
  badge.setAttribute("aria-label", name);
  for (const text of nameLines(name)) {
    const line = document.createElement("span");
    line.className = "pointer-name-line";
    line.textContent = text;
    badge.append(line);
  }
}

export function pointerLabelHeight(names: string[], minimum: number): number {
  return Math.max(minimum, names.reduce((height, name) => height + nameLines(name).length * 14 + 4, 0)
    + Math.max(0, names.length - 1) * 3 + 6);
}
