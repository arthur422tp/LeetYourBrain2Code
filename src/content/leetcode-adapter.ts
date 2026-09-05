export interface ProblemMetadata {
  slug: string | null;
  title: string | null;
}

export interface LeetCodeSnapshot {
  code: string;
  language: string;
  testcase: string;
  metadata: ProblemMetadata;
}

export interface LeetCodeAdapter {
  getSnapshot(): Promise<LeetCodeSnapshot>;
}

export const LEETCODE_MESSAGE_SOURCE = "leetcode-python-visualizer";
export const LEETCODE_MESSAGE_TYPES = {
  requestSnapshot: "request_snapshot",
  responseSnapshot: "response_snapshot"
} as const;

export const LEETCODE_CONTENT_MESSAGE_TYPES = {
  requestSnapshot: "request_leetcode_snapshot"
} as const;

const MAX_SNAPSHOT_CODE_LENGTH = 1_000_000;
const MAX_SNAPSHOT_TESTCASE_LENGTH = 100_000;
const MAX_SNAPSHOT_LANGUAGE_LENGTH = 64;

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
  requestMainWorldSnapshot?: () => Promise<unknown>;
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
    return value.length > 0 ? value : null;
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

export function extractIsolatedSnapshot(doc: Document): LeetCodeSnapshot | null {
  const codeEditor = doc.querySelector<HTMLTextAreaElement>(LEETCODE_ACCESSORS.codeEditor);
  const testcase = readTestcaseFromDom(doc);
  const language = readLanguageFromDom(doc);

  if (!codeEditor || codeEditor.value.length === 0 || testcase === null || language === null) {
    return null;
  }

  return {
    code: codeEditor.value,
    language,
    testcase,
    metadata: extractMetadata(doc)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateSnapshot(value: unknown): value is LeetCodeSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  if (
    typeof value.code !== "string" ||
    value.code.length === 0 ||
    value.code.length > MAX_SNAPSHOT_CODE_LENGTH ||
    typeof value.language !== "string" ||
    value.language.length === 0 ||
    value.language.length > MAX_SNAPSHOT_LANGUAGE_LENGTH ||
    typeof value.testcase !== "string" ||
    value.testcase.length > MAX_SNAPSHOT_TESTCASE_LENGTH ||
    !isRecord(value.metadata)
  ) {
    return false;
  }

  return (
    (value.metadata.slug === null || typeof value.metadata.slug === "string") &&
    (value.metadata.title === null || typeof value.metadata.title === "string")
  );
}

let requestSequence = 0;

export function requestMainWorldSnapshot(
  pageWindow: Window,
  timeoutMs = 750
): Promise<LeetCodeSnapshot> {
  // The window message channel is visible to page scripts by design. Treat
  // every returned value as untrusted data: validate its shape and size, and
  // never use it for privileged extension operations.
  const randomUuid = pageWindow.crypto?.randomUUID?.();
  const requestId =
    randomUuid ?? `snapshot-${Date.now()}-${requestSequence++}-${Math.random().toString(36).slice(2)}`;
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
        !isRecord(event.data)
      ) {
        return;
      }
      if (
        event.data.source !== LEETCODE_MESSAGE_SOURCE ||
        event.data.type !== LEETCODE_MESSAGE_TYPES.responseSnapshot ||
        event.data.requestId !== requestId
      ) {
        return;
      }

      cleanup();
      if (validateSnapshot(event.data.snapshot)) {
        resolve(event.data.snapshot);
      } else {
        reject(new Error("LeetCode main-world bridge returned an invalid snapshot"));
      }
    };

    pageWindow.addEventListener("message", onMessage);
    pageWindow.postMessage(
      {
        source: LEETCODE_MESSAGE_SOURCE,
        type: LEETCODE_MESSAGE_TYPES.requestSnapshot,
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
  const requestSnapshot =
    options.requestMainWorldSnapshot ??
    (() => requestMainWorldSnapshot(pageWindow, options.bridgeTimeoutMs));

  return {
    async getSnapshot(): Promise<LeetCodeSnapshot> {
      const isolatedSnapshot = extractIsolatedSnapshot(pageDocument);
      if (isolatedSnapshot) {
        return isolatedSnapshot;
      }

      const bridgeSnapshot = await requestSnapshot();
      if (!validateSnapshot(bridgeSnapshot)) {
        throw new Error("LeetCode adapter received an invalid snapshot");
      }
      return bridgeSnapshot;
    }
  };
}
