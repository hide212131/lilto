/**
 * Left/right layout constraint shared by the renderer (design 5.2). Pure so it is
 * testable. Returns the effective widths and what to do when space is short.
 */
export function resolvePanelLayout(input: {
  bodyWidth: number;
  sidebarOpen: boolean;
  sidebarWidth: number;
  handleWidth: number;
  preferredPanelWidth: number;
  panelMin: number;
  panelMax: number;
  chatMin: number;
}): { panelWidth: number; closeSidebar: boolean; tooNarrow: boolean } {
  const preferred = Math.min(input.panelMax, Math.max(input.panelMin, input.preferredPanelWidth));
  const handles = input.handleWidth * (input.sidebarOpen ? 2 : 1);
  const withSidebar = input.sidebarOpen ? input.sidebarWidth : 0;
  const availableWithSidebar = input.bodyWidth - withSidebar - handles - input.chatMin;
  if (availableWithSidebar >= input.panelMin) {
    return { panelWidth: Math.min(preferred, availableWithSidebar), closeSidebar: false, tooNarrow: false };
  }
  const availableWithout = input.bodyWidth - input.handleWidth - input.chatMin;
  if (availableWithout >= input.panelMin) {
    return { panelWidth: Math.min(preferred, availableWithout), closeSidebar: input.sidebarOpen, tooNarrow: false };
  }
  return { panelWidth: 0, closeSidebar: input.sidebarOpen, tooNarrow: true };
}
