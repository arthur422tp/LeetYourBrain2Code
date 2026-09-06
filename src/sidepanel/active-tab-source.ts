import {
  LEETCODE_CONTENT_MESSAGE_TYPES,
  validateSnapshot,
  type LeetCodeSnapshot
} from "../content/leetcode-adapter";

export interface ActiveTabSnapshot {
  tabId: number;
  snapshot: LeetCodeSnapshot;
}

export type ActiveTabState =
  | { kind: "leetcode"; tabId: number }
  | { kind: "paused" };

export interface ActiveTabSourceOptions {
  onOwnershipInvalidated(): void;
  onStateChange(state: ActiveTabState): void;
  onSnapshot(value: ActiveTabSnapshot): void;
  onError(error: Error): void;
}

export interface ActiveTabSource {
  start(): Promise<void>;
  refresh(): Promise<ActiveTabSnapshot | null>;
  dispose(): void;
}

type ChromeApi = Pick<typeof chrome, "runtime" | "tabs" | "scripting">;

interface FetchContext {
  tabId: number;
  epoch: number;
  sequence: number;
}

type FailureReconciliation =
  | "ownership-changed"
  | "superseded"
  | "unchanged"
  | "unresolved";

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isMissingReceiverError(error: unknown): boolean {
  const message = normalizeError(error).message;
  return message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection");
}

function isLeetCodeUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).origin === "https://leetcode.com";
  } catch {
    return false;
  }
}

function queryCurrentActiveTab(api: ChromeApi): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve, reject) => {
    api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const runtimeError = api.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(tabs[0] ?? null);
    });
  });
}

function getTab(api: ChromeApi, tabId: number): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    api.tabs.get(tabId, (resolvedTab) => {
      const runtimeError = api.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (!resolvedTab) {
        reject(new Error("Unable to resolve the active Chrome tab"));
        return;
      }
      resolve(resolvedTab);
    });
  });
}

function requestSnapshotOnce(api: ChromeApi, tabId: number): Promise<LeetCodeSnapshot> {
  return new Promise((resolve, reject) => {
    api.tabs.sendMessage(
      tabId,
      { type: LEETCODE_CONTENT_MESSAGE_TYPES.requestSnapshot },
      (response: unknown) => {
        const runtimeError = api.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        if (
          typeof response !== "object" ||
          response === null ||
          !("ok" in response) ||
          response.ok !== true ||
          !("snapshot" in response) ||
          !validateSnapshot(response.snapshot)
        ) {
          reject(new Error("No valid LeetCode snapshot was returned"));
          return;
        }
        resolve(response.snapshot);
      }
    );
  });
}

async function injectLeetCodeContentScripts(api: ChromeApi, tabId: number): Promise<void> {
  const target = { tabId };
  await api.scripting.executeScript({
    target,
    files: ["page-bridge/leetcode-main-world.js"],
    world: "MAIN"
  });
  await api.scripting.executeScript({
    target,
    files: ["content/leetcode-adapter.js"]
  });
}

async function requestSnapshot(api: ChromeApi, tabId: number): Promise<LeetCodeSnapshot> {
  try {
    return await requestSnapshotOnce(api, tabId);
  } catch (error) {
    if (!isMissingReceiverError(error)) throw error;
    await injectLeetCodeContentScripts(api, tabId);
    return requestSnapshotOnce(api, tabId);
  }
}

export function createActiveTabSource(
  options: ActiveTabSourceOptions,
  chromeApi: ChromeApi = chrome
): ActiveTabSource {
  let currentWindowId: number | null = null;
  let currentActiveTabId: number | null = null;
  let activeLeetCodeTabId: number | null = null;
  let activeTabEpoch = 0;
  let currentTabUrl: string | undefined;
  let fetchSequence = 0;
  let started = false;
  let disposed = false;

  const isCurrent = (tabId: number, epoch: number): boolean =>
    !disposed && activeLeetCodeTabId === tabId && activeTabEpoch === epoch;

  const beginFetch = (tabId: number, epoch: number): FetchContext => ({
    tabId,
    epoch,
    sequence: ++fetchSequence
  });

  const isCurrentFetch = (context: FetchContext): boolean =>
    isCurrent(context.tabId, context.epoch) && context.sequence === fetchSequence;

  const fetchCurrent = async (
    context: FetchContext
  ): Promise<ActiveTabSnapshot | null> => {
    const currentSnapshot = await requestSnapshot(chromeApi, context.tabId);
    return isCurrentFetch(context)
      ? { tabId: context.tabId, snapshot: currentSnapshot }
      : null;
  };

  const refreshAndEmit = async (tabId: number, epoch: number): Promise<void> => {
    const context = beginFetch(tabId, epoch);
    try {
      const value = await fetchCurrent(context);
      if (value) options.onSnapshot(value);
    } catch (error) {
      if (!isCurrentFetch(context)) return;
      options.onError(normalizeError(error));
      await reconcileAfterFailure(epoch, false, context);
    }
  };

  const enterPaused = (
    url: string | undefined,
    clearCurrentActiveTab: boolean
  ): void => {
    activeLeetCodeTabId = null;
    currentTabUrl = url;
    if (clearCurrentActiveTab) currentActiveTabId = null;
    ++activeTabEpoch;
    options.onOwnershipInvalidated();
    options.onStateChange({ kind: "paused" });
  };

  const applyResolvedTab = async (
    resolvedTab: chrome.tabs.Tab,
    epoch: number
  ): Promise<void> => {
    if (
      disposed ||
      epoch !== activeTabEpoch ||
      resolvedTab.id === undefined ||
      resolvedTab.id !== currentActiveTabId
    ) {
      return;
    }

    currentTabUrl = resolvedTab.url;

    if (!isLeetCodeUrl(resolvedTab.url)) {
      activeLeetCodeTabId = null;
      options.onStateChange({ kind: "paused" });
      return;
    }

    activeLeetCodeTabId = resolvedTab.id;
    options.onStateChange({ kind: "leetcode", tabId: resolvedTab.id });
    await refreshAndEmit(resolvedTab.id, epoch);
  };

  const activate = async (tabId: number, windowId: number): Promise<void> => {
    if (
      disposed ||
      currentWindowId === null ||
      windowId !== currentWindowId
    ) {
      return;
    }

    currentActiveTabId = tabId;
    activeLeetCodeTabId = null;
    const epoch = ++activeTabEpoch;
    options.onOwnershipInvalidated();

    try {
      await applyResolvedTab(await getTab(chromeApi, tabId), epoch);
    } catch (error) {
      if (!disposed && epoch === activeTabEpoch) {
        options.onError(normalizeError(error));
        await reconcileAfterFailure(epoch, true);
      }
    }
  };

  const reconcileAfterFailure = async (
    epoch: number,
    retrySameTab: boolean,
    fetchContext?: FetchContext
  ): Promise<FailureReconciliation> => {
    if (
      disposed ||
      epoch !== activeTabEpoch ||
      (fetchContext !== undefined && !isCurrentFetch(fetchContext))
    ) {
      return "superseded";
    }

    let active: chrome.tabs.Tab | null;
    try {
      active = await queryCurrentActiveTab(chromeApi);
    } catch {
      return "unresolved";
    }

    if (
      disposed ||
      epoch !== activeTabEpoch ||
      (fetchContext !== undefined && !isCurrentFetch(fetchContext))
    ) {
      return "superseded";
    }

    if (active === null || active.id === undefined) {
      enterPaused(undefined, true);
      return "ownership-changed";
    }

    if (active.windowId !== currentWindowId) return "unresolved";

    if (active.id !== currentActiveTabId) {
      void activate(active.id, active.windowId);
      return "ownership-changed";
    }

    if (!isLeetCodeUrl(active.url)) {
      enterPaused(active.url, false);
      return "ownership-changed";
    }

    if (active.url !== currentTabUrl) {
      const nextEpoch = invalidateForUpdatedTab(active);
      void applyResolvedTab(active, nextEpoch);
      return "ownership-changed";
    }

    if (retrySameTab) {
      await applyResolvedTab(active, epoch);
    }
    return "unchanged";
  };

  const onActivated = (info: chrome.tabs.TabActiveInfo): void => {
    void activate(info.tabId, info.windowId);
  };

  const onRuntimeMessage = (
    message: unknown,
    sender: chrome.runtime.MessageSender
  ): void => {
    if (
      disposed ||
      sender.tab?.id !== activeLeetCodeTabId ||
      typeof message !== "object" ||
      message === null ||
      !("type" in message) ||
      message.type !== LEETCODE_CONTENT_MESSAGE_TYPES.snapshotUpdated ||
      !("snapshot" in message) ||
      !validateSnapshot(message.snapshot)
    ) {
      return;
    }

    options.onSnapshot({
      tabId: activeLeetCodeTabId,
      snapshot: message.snapshot
    });
  };

  const attachCoreListeners = (): void => {
    chromeApi.runtime.onMessage.addListener(onRuntimeMessage);
    chromeApi.tabs.onActivated.addListener(onActivated);
    chromeApi.tabs.onUpdated.addListener(onUpdated);
  };

  const start = async (): Promise<void> => {
    if (started || disposed) return;
    started = true;

    const initialTab = await queryCurrentActiveTab(chromeApi);
    if (disposed) return;
    if (!initialTab?.id) {
      activeTabEpoch += 1;
      options.onStateChange({ kind: "paused" });
      return;
    }

    currentWindowId = initialTab.windowId;
    attachCoreListeners();

    const epoch = ++activeTabEpoch;
    const currentTab = await queryCurrentActiveTab(chromeApi);
    if (disposed || epoch !== activeTabEpoch) return;
    if (!currentTab?.id || currentTab.windowId !== currentWindowId) {
      currentActiveTabId = null;
      activeLeetCodeTabId = null;
      options.onStateChange({ kind: "paused" });
      return;
    }

    currentActiveTabId = currentTab.id;
    await applyResolvedTab(currentTab, epoch);
  };

  const invalidateForUpdatedTab = (
    updatedTab: chrome.tabs.Tab
  ): number => {
    activeLeetCodeTabId = null;
    currentTabUrl = updatedTab.url;
    const epoch = ++activeTabEpoch;
    options.onOwnershipInvalidated();
    return epoch;
  };

  const onUpdated = (
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    updatedTab: chrome.tabs.Tab
  ): void => {
    if (disposed || tabId !== currentActiveTabId) return;

    const urlChanged =
      changeInfo.url !== undefined && changeInfo.url !== currentTabUrl;

    if (urlChanged) {
      const epoch = invalidateForUpdatedTab(updatedTab);
      void applyResolvedTab(updatedTab, epoch);
      return;
    }

    if (changeInfo.status !== "complete") return;

    if (updatedTab.url !== currentTabUrl) {
      const epoch = invalidateForUpdatedTab(updatedTab);
      void applyResolvedTab(updatedTab, epoch);
      return;
    }

    if (activeLeetCodeTabId === tabId) {
      void refreshAndEmit(tabId, activeTabEpoch);
    }
  };

  const refresh = async (): Promise<ActiveTabSnapshot | null> => {
    if (disposed || activeLeetCodeTabId === null) return null;
    const context = beginFetch(activeLeetCodeTabId, activeTabEpoch);
    try {
      return await fetchCurrent(context);
    } catch (error) {
      if (!isCurrentFetch(context)) return null;
      const reconciliation = await reconcileAfterFailure(
        context.epoch,
        false,
        context
      );
      if (
        reconciliation === "ownership-changed" ||
        reconciliation === "superseded"
      ) {
        return null;
      }
      throw error;
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    ++activeTabEpoch;
    chromeApi.runtime.onMessage.removeListener(onRuntimeMessage);
    chromeApi.tabs.onActivated.removeListener(onActivated);
    chromeApi.tabs.onUpdated.removeListener(onUpdated);
  };

  return { start, refresh, dispose };
}
