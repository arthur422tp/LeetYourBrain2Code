import {
  LEETCODE_ACCESSORS,
  LEETCODE_MESSAGE_SOURCE,
  LEETCODE_MESSAGE_TYPES,
  extractMetadata,
  normalizeLanguage,
  validatePageState
} from "../content/leetcode-adapter";
import type { LeetCodePageState } from "../content/leetcode-adapter";

interface MonacoModelLike {
  getLanguageId(): string;
  getValue(): string;
}

interface MonacoLike {
  editor?: {
    getModels?: () => MonacoModelLike[];
  };
}

export type LeetCodePageWindow = Window & { monaco?: MonacoLike };

export interface MainWorldBridgeOptions {
  watchIntervalMs?: number;
}

const DEFAULT_WATCH_INTERVAL_MS = 300;

function readLanguageFromDom(doc: Document): string | null {
  const buttons = Array.from(
    doc.querySelectorAll<HTMLButtonElement>(LEETCODE_ACCESSORS.languageButtons)
  );
  for (const button of buttons) {
    const language = normalizeLanguage(button.textContent ?? "");
    if (language) {
      return language;
    }
  }
  return null;
}

function readTestcase(doc: Document): string | null {
  const fields = Array.from(
    doc.querySelectorAll<HTMLElement>(LEETCODE_ACCESSORS.testcaseFields)
  );
  if (fields.length > 0) {
    return fields.map((field) => field.textContent ?? "").join("\n");
  }

  const codeMirror = doc.querySelector<HTMLElement>(LEETCODE_ACCESSORS.testcaseCodeMirror);
  if (codeMirror) {
    const value = codeMirror.innerText ?? codeMirror.textContent ?? "";
    return value.length > 0 ? value : null;
  }
  return null;
}

function readCodeFromMonaco(
  pageWindow: LeetCodePageWindow,
  selectedLanguage: string | null
): { code: string; language: string } | null {
  const models = pageWindow.monaco?.editor?.getModels?.() ?? [];
  const candidate =
    models.find((model) => normalizeLanguage(model.getLanguageId()) === selectedLanguage) ??
    models.find((model) => normalizeLanguage(model.getLanguageId()) === "python") ??
    models[0];

  if (!candidate) {
    return null;
  }

  const code = candidate.getValue();
  const language = normalizeLanguage(candidate.getLanguageId()) ?? selectedLanguage;
  return language ? { code, language } : null;
}

function readCodeFromDom(doc: Document): string | null {
  const editor = doc.querySelector<HTMLTextAreaElement>(LEETCODE_ACCESSORS.codeEditor);
  return editor ? editor.value : null;
}

export function extractPageState(
  doc: Document,
  pageWindow: LeetCodePageWindow
): LeetCodePageState {
  const selectedLanguage = readLanguageFromDom(doc);
  const monacoCode = readCodeFromMonaco(pageWindow, selectedLanguage);

  return {
    code: monacoCode?.code ?? readCodeFromDom(doc),
    language: monacoCode?.language ?? selectedLanguage,
    testcase: readTestcase(doc),
    metadata: extractMetadata(doc)
  };
}

export function installMainWorldBridge(
  pageWindow: LeetCodePageWindow,
  doc: Document,
  options: MainWorldBridgeOptions = {}
): () => void {
  const pageOrigin = pageWindow.location.origin;
  const targetOrigin = pageOrigin && pageOrigin !== "null" ? pageOrigin : "*";
  let lastPageStateKey: string | null = null;

  const publishPageStateUpdate = (): void => {
    const state = extractPageState(doc, pageWindow);
    if (!validatePageState(state)) {
      return;
    }

    const key = JSON.stringify(state);
    if (key === lastPageStateKey) {
      return;
    }
    lastPageStateKey = key;
    pageWindow.postMessage(
      {
        source: LEETCODE_MESSAGE_SOURCE,
        type: LEETCODE_MESSAGE_TYPES.pageStateUpdated,
        state
      },
      targetOrigin
    );
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

    const message = event.data as Record<string, unknown>;
    if (message.source !== LEETCODE_MESSAGE_SOURCE || typeof message.requestId !== "string") {
      return;
    }

    const state = extractPageState(doc, pageWindow);
    if (message.type === LEETCODE_MESSAGE_TYPES.requestPageState) {
      pageWindow.postMessage(
        {
          source: LEETCODE_MESSAGE_SOURCE,
          type: LEETCODE_MESSAGE_TYPES.responsePageState,
          requestId: message.requestId,
          state
        },
        targetOrigin
      );
    }
  };

  pageWindow.addEventListener("message", onMessage);
  publishPageStateUpdate();
  const watchInterval = pageWindow.setInterval(
    publishPageStateUpdate,
    options.watchIntervalMs ?? DEFAULT_WATCH_INTERVAL_MS
  );

  return () => {
    pageWindow.removeEventListener("message", onMessage);
    pageWindow.clearInterval(watchInterval);
  };
}
