export {
  toRunnableSnapshot,
  validatePageState,
  validateSnapshot,
  type LeetCodePageState,
  type LeetCodeSnapshot,
  type ProblemMetadata
} from "./leetcode-page-state";

import { validatePageState } from "./leetcode-page-state";
import type { LeetCodePageState, ProblemMetadata } from "./leetcode-page-state";

export interface LeetCodeAdapter {
  getPageState(): Promise<LeetCodePageState>;
}

export const LEETCODE_MESSAGE_SOURCE = "leetcode-python-visualizer";
export const LEETCODE_MESSAGE_TYPES = {
  requestPageState: "request_page_state",
  responsePageState: "response_page_state",
  pageStateUpdated: "page_state_updated"
} as const;

export const LEETCODE_CONTENT_MESSAGE_TYPES = {
  requestPageState: "request_leetcode_page_state",
  pageStateUpdated: "leetcode_page_state_updated"
} as const;

/**
 * All page-specific selectors live here so the rest of the extension does not
 * need to know about LeetCode's editor implementation.
 */
export const LEETCODE_ACCESSORS = {
  codeEditor: 'textarea[aria-label="Code editor"]',
  testcaseFields: 'div[contenteditable="true"].cursor-text',
  testcaseCodeMirror: '.cm-content[contenteditable="true"]',
  testcaseRegionCandidates: '[data-testid], [data-test-id], [aria-label], [aria-labelledby], [role="tabpanel"], [role="region"]',
  testcaseControls: 'input, textarea, select, [role="textbox"], [contenteditable="true"]',
  languageButtons: "button",
  problemLinks: 'a[href^="/problems/"]'
} as const;

const LANGUAGE_ALIASES: Record<string, string> = {
  c: "c",
  "c++": "cpp",
  cpp: "cpp",
  csharp: "csharp",
  "c#": "csharp",
  go: "go",
  java: "java",
  javascript: "javascript",
  js: "javascript",
  kotlin: "kotlin",
  php: "php",
  python: "python",
  python2: "python",
  python3: "python",
  ruby: "ruby",
  rust: "rust",
  scala: "scala",
  swift: "swift",
  typescript: "typescript",
  ts: "typescript"
};

const LANGUAGE_BUTTON_LABELS = new Set(Object.keys(LANGUAGE_ALIASES));

export interface AdapterOptions {
  document?: Document;
  window?: Window;
  requestMainWorldPageState?: () => Promise<unknown>;
  bridgeTimeoutMs?: number;
}

function normalizeLanguageKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function normalizeLanguage(value: string): string | null {
  const key = normalizeLanguageKey(value);
  return LANGUAGE_ALIASES[key] ?? (key.length > 0 ? key : null);
}

function readLanguageFromDom(doc: Document): string | null {
  const buttons = Array.from(
    doc.querySelectorAll<HTMLButtonElement>(LEETCODE_ACCESSORS.languageButtons)
  );

  for (const button of buttons) {
    const language = normalizeLanguage(button.textContent ?? "");
    if (language && LANGUAGE_BUTTON_LABELS.has(normalizeLanguageKey(button.textContent ?? ""))) {
      return language;
    }
  }

  return null;
}

function isTestcaseSemanticText(value: string): boolean {
  return /test[\s_-]*case/i.test(value);
}

function readLabelledByText(element: HTMLElement, doc: Document): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (!labelledBy) return "";

  return labelledBy
    .split(/\s+/)
    .map((id) => doc.getElementById(id)?.textContent ?? "")
    .join(" ");
}

function hasTestcaseSemantics(element: HTMLElement, doc: Document): boolean {
  const attributes = [
    element.getAttribute("data-testid") ?? "",
    element.getAttribute("data-test-id") ?? "",
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? "",
    element.id,
    readLabelledByText(element, doc)
  ];

  return attributes.some(isTestcaseSemanticText);
}

function isCodeEditorElement(doc: Document, element: Element): boolean {
  const editor = doc.querySelector<HTMLElement>(LEETCODE_ACCESSORS.codeEditor);
  if (!editor) return false;
  if (editor === element || editor.contains(element)) return true;

  const editorContainer = editor.closest<HTMLElement>(".monaco-editor, .cm-editor");
  return editorContainer?.contains(element) === true;
}

function readControlValue(element: HTMLElement): string {
  if (
    "value" in element &&
    typeof (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value ===
      "string"
  ) {
    return (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
  }

  return element.innerText ?? element.textContent ?? "";
}

const NON_VALUE_INPUT_TYPES = new Set([
  "hidden",
  "button",
  "submit",
  "reset",
  "checkbox",
  "radio"
]);

function isUsableTestcaseControl(doc: Document, element: HTMLElement): boolean {
  if (isCodeEditorElement(doc, element)) return false;

  if (element.tagName.toLowerCase() === "input") {
    return !NON_VALUE_INPUT_TYPES.has((element as HTMLInputElement).type);
  }

  return true;
}

function testcaseRegions(doc: Document): HTMLElement[] {
  const regions = Array.from(
    doc.querySelectorAll<HTMLElement>(LEETCODE_ACCESSORS.testcaseRegionCandidates)
  ).filter((element) => hasTestcaseSemantics(element, doc));

  const labelledTabs = Array.from(
    doc.querySelectorAll<HTMLElement>('[role="tab"], button')
  ).filter((element) => isTestcaseSemanticText(element.textContent ?? ""));

  for (const tab of labelledTabs) {
    const controlledId = tab.getAttribute("aria-controls");
    const controlledRegion = controlledId ? doc.getElementById(controlledId) : null;
    if (controlledRegion instanceof HTMLElement && !regions.includes(controlledRegion)) {
      regions.push(controlledRegion);
    }

    const siblingRegion = tab.parentElement?.querySelector<HTMLElement>(
      '[role="tabpanel"], [data-testid], [data-test-id]'
    );
    if (
      siblingRegion &&
      hasTestcaseSemantics(siblingRegion, doc) &&
      !regions.includes(siblingRegion)
    ) {
      regions.push(siblingRegion);
    }
  }

  const plainLabels = Array.from(doc.querySelectorAll<HTMLElement>("div, span, p, strong"))
    .filter((element) => element.children.length === 0)
    .filter((element) => isTestcaseSemanticText(element.textContent?.trim() ?? ""));

  for (const label of plainLabels) {
    let ancestor = label.parentElement;
    let depth = 0;
    while (ancestor && depth < 6) {
      const controls = Array.from(
        ancestor.querySelectorAll<HTMLElement>(LEETCODE_ACCESSORS.testcaseControls)
      ).filter((element) => isUsableTestcaseControl(doc, element));
      if (controls.length > 0) {
        if (!regions.includes(ancestor)) regions.push(ancestor);
        break;
      }
      ancestor = ancestor.parentElement;
      depth += 1;
    }
  }

  return regions;
}

function readStructuredTestcaseFromDom(doc: Document): string | null {
  const controls: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const region of testcaseRegions(doc)) {
    const candidates = region.matches(LEETCODE_ACCESSORS.testcaseControls)
      ? [region]
      : Array.from(region.querySelectorAll<HTMLElement>(LEETCODE_ACCESSORS.testcaseControls));

    for (const candidate of candidates) {
      if (!seen.has(candidate) && isUsableTestcaseControl(doc, candidate)) {
        seen.add(candidate);
        controls.push(candidate);
      }
    }
  }

  return controls.length > 0 ? controls.map(readControlValue).join("\n") : null;
}

export function readTestcaseFromDom(doc: Document): string | null {
  const fields = Array.from(
    doc.querySelectorAll<HTMLElement>(LEETCODE_ACCESSORS.testcaseFields)
  ).filter((field) => !isCodeEditorElement(doc, field));
  if (fields.length > 0) {
    const values = fields.map(readControlValue);
    return values.join("\n");
  }

  const codeMirror = Array.from(
    doc.querySelectorAll<HTMLElement>(LEETCODE_ACCESSORS.testcaseCodeMirror)
  ).find((element) => !isCodeEditorElement(doc, element));
  if (codeMirror) {
    return readControlValue(codeMirror);
  }

  return readStructuredTestcaseFromDom(doc);
}

function extractSlug(pathname: string): string | null {
  const match = pathname.match(/\/problems\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function extractTitle(doc: Document, slug: string | null): string | null {
  if (slug) {
    const link = Array.from(
      doc.querySelectorAll<HTMLAnchorElement>(LEETCODE_ACCESSORS.problemLinks)
    ).find((candidate) => {
      try {
        return new URL(candidate.href, doc.baseURI).pathname === `/problems/${slug}/`;
      } catch {
        return false;
      }
    });
    const linkTitle = link?.textContent?.trim().replace(/^\d+\.\s*/, "");
    if (linkTitle) {
      return linkTitle;
    }
  }

  const documentTitle = doc.title.replace(/\s*[-|]\s*LeetCode.*$/i, "").trim();
  return documentTitle || null;
}

export function extractMetadata(doc: Document): ProblemMetadata {
  const slug = extractSlug(doc.location?.pathname ?? "");
  return { slug, title: extractTitle(doc, slug) };
}

export function extractIsolatedPageState(doc: Document): LeetCodePageState {
  const editor = doc.querySelector<HTMLTextAreaElement>(LEETCODE_ACCESSORS.codeEditor);
  return {
    code: editor ? editor.value : null,
    language: readLanguageFromDom(doc),
    testcase: readTestcaseFromDom(doc),
    metadata: extractMetadata(doc)
  };
}

let requestSequence = 0;

function createRequestId(pageWindow: Window, prefix: string): string {
  const randomUuid = pageWindow.crypto?.randomUUID?.();
  return (
    randomUuid ??
    `${prefix}-${Date.now()}-${requestSequence++}-${Math.random().toString(36).slice(2)}`
  );
}

export function requestMainWorldPageState(
  pageWindow: Window,
  timeoutMs = 750
): Promise<LeetCodePageState> {
  // The window message channel is visible to page scripts by design. Treat
  // every returned value as untrusted data: validate its shape and size, and
  // never use it for privileged extension operations.
  const requestId = createRequestId(pageWindow, "page-state");
  const pageOrigin = pageWindow.location.origin;
  const targetOrigin = pageOrigin && pageOrigin !== "null" ? pageOrigin : "*";

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      pageWindow.removeEventListener("message", onMessage);
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };

    const onMessage = (event: MessageEvent): void => {
      if (
        (event.source !== null && event.source !== pageWindow) ||
        (event.origin !== "" && event.origin !== pageOrigin) ||
        typeof event.data !== "object" ||
        event.data === null
      ) {
        return;
      }
      if (
        event.data.source !== LEETCODE_MESSAGE_SOURCE ||
        event.data.type !== LEETCODE_MESSAGE_TYPES.responsePageState ||
        event.data.requestId !== requestId
      ) {
        return;
      }

      cleanup();
      if (validatePageState(event.data.state)) {
        resolve(event.data.state);
      } else {
        reject(new Error("LeetCode main-world bridge returned an invalid page state"));
      }
    };

    pageWindow.addEventListener("message", onMessage);
    pageWindow.postMessage(
      {
        source: LEETCODE_MESSAGE_SOURCE,
        type: LEETCODE_MESSAGE_TYPES.requestPageState,
        requestId
      },
      targetOrigin
    );

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the LeetCode main-world bridge"));
    }, timeoutMs);
  });
}

export function createLeetCodeAdapter(options: AdapterOptions = {}): LeetCodeAdapter {
  const pageDocument = options.document ?? document;
  const pageWindow = options.window ?? window;
  const requestPageState =
    options.requestMainWorldPageState ??
    (() => requestMainWorldPageState(pageWindow, options.bridgeTimeoutMs));

  const getBridgePageState = async (): Promise<LeetCodePageState> => {
    const bridgeState = await requestPageState();
    if (!validatePageState(bridgeState)) {
      throw new Error("LeetCode adapter received an invalid page state");
    }
    return bridgeState;
  };

  return {
    async getPageState(): Promise<LeetCodePageState> {
      try {
        return await getBridgePageState();
      } catch (bridgeError) {
        const isolatedState = extractIsolatedPageState(pageDocument);
        if (validatePageState(isolatedState)) {
          return isolatedState;
        }
        throw bridgeError;
      }
    }
  };
}
