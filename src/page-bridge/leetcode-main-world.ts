import {
  LEETCODE_ACCESSORS,
  LEETCODE_MESSAGE_SOURCE,
  LEETCODE_MESSAGE_TYPES,
  extractMetadata,
  normalizeLanguage,
  validateSnapshot,
  type LeetCodeSnapshot
} from "../content/leetcode-adapter";

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
  return code.length > 0 && language ? { code, language } : null;
}

function readCodeFromDom(doc: Document): string | null {
  const editor = doc.querySelector<HTMLTextAreaElement>(LEETCODE_ACCESSORS.codeEditor);
  return editor && editor.value.length > 0 ? editor.value : null;
}

export function extractPageState(
  doc: Document,
  pageWindow: LeetCodePageWindow
): LeetCodeSnapshot | null {
  const selectedLanguage = readLanguageFromDom(doc);
  const monacoCode = readCodeFromMonaco(pageWindow, selectedLanguage);
  const code = monacoCode?.code ?? readCodeFromDom(doc);
  const language = monacoCode?.language ?? selectedLanguage;
  const testcase = readTestcase(doc);

  if (!code || !language || testcase === null) {
    return null;
  }

  const snapshot: LeetCodeSnapshot = {
    code,
    language,
    testcase,
    metadata: extractMetadata(doc)
  };
  return validateSnapshot(snapshot) ? snapshot : null;
}

export function installMainWorldBridge(
  pageWindow: LeetCodePageWindow,
  doc: Document,
  options: MainWorldBridgeOptions = {}
): () => void {
  const pageOrigin = pageWindow.location.origin;
  const targetOrigin = pageOrigin && pageOrigin !== "null" ? pageOrigin : "*";
  let lastSnapshotKey: string | null = null;

  const publishSnapshotUpdate = (): void => {
    const snapshot = extractPageState(doc, pageWindow);
    if (!snapshot) {
      return;
    }

    const snapshotKey = JSON.stringify(snapshot);
    if (snapshotKey === lastSnapshotKey) {
      return;
    }
    lastSnapshotKey = snapshotKey;
    pageWindow.postMessage(
      {
        source: LEETCODE_MESSAGE_SOURCE,
        type: LEETCODE_MESSAGE_TYPES.snapshotUpdated,
        snapshot
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
    if (
      message.source !== LEETCODE_MESSAGE_SOURCE ||
      message.type !== LEETCODE_MESSAGE_TYPES.requestSnapshot ||
      typeof message.requestId !== "string"
    ) {
      return;
    }

    pageWindow.postMessage(
      {
        source: LEETCODE_MESSAGE_SOURCE,
        type: LEETCODE_MESSAGE_TYPES.responseSnapshot,
        requestId: message.requestId,
        snapshot: extractPageState(doc, pageWindow)
      },
      targetOrigin
    );
  };

  pageWindow.addEventListener("message", onMessage);
  publishSnapshotUpdate();
  const watchInterval = pageWindow.setInterval(
    publishSnapshotUpdate,
    options.watchIntervalMs ?? DEFAULT_WATCH_INTERVAL_MS
  );

  return () => {
    pageWindow.removeEventListener("message", onMessage);
    pageWindow.clearInterval(watchInterval);
  };
}
