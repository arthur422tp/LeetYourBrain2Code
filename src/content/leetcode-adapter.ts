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

function readTestcaseFromDom(doc: Document): string | null {
  const fields = Array.from(
    doc.querySelectorAll<HTMLElement>(LEETCODE_ACCESSORS.testcaseFields)
  );
  if (fields.length > 0) {
    const values = fields.map((field) => field.textContent ?? "");
    return values.join("\n");
  }

  const codeMirror = doc.querySelector<HTMLElement>(LEETCODE_ACCESSORS.testcaseCodeMirror);
  if (codeMirror) {
    const value = codeMirror.innerText ?? codeMirror.textContent ?? "";
    return value;
  }

  return null;
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
