const panelBehavior = {
  openPanelOnActionClick: true
} as const;

export function configureSidePanelBehavior(): Promise<void> {
  return chrome.sidePanel.setPanelBehavior(panelBehavior);
}

void configureSidePanelBehavior().catch((error: unknown) => {
  console.warn("Unable to configure Side Panel toolbar behavior.", error);
});
