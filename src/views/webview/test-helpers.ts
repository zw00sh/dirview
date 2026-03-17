// Shared test helpers for webview tests
import { vi, afterEach } from 'vitest';
import { createState, createRenderer } from './index';

afterEach(() => { document.body.innerHTML = ''; });

// Mock acquireVsCodeApi for webview tests
(globalThis as any).acquireVsCodeApi = () => ({
  postMessage: () => {},
  getState: () => null,
  setState: () => {},
});

export function makeDir(path: string, name: string, { children = [], files = [], totalFiles = 0, sizeBytes = 0, stats = [] }: { children?: any[]; files?: any[]; totalFiles?: number; sizeBytes?: number; stats?: any[] } = {}) {
  return { path, name, children, files, totalFiles, sizeBytes, stats };
}

export function makeRenderer(state: any, { onExpandChanged }: { onExpandChanged?: any } = {}) {
  const vscode = { postMessage: vi.fn() };
  const rootEl = document.createElement('div');
  document.body.appendChild(rootEl);
  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'bar-tooltip';
  tooltipEl.style.display = 'none';
  document.body.appendChild(tooltipEl);
  const renderer = createRenderer(state, {
    vscode,
    root: rootEl,
    tooltip: tooltipEl,
    options: { skipDepthZeroGuides: false, barFactor: 0.4, barMaxWidth: 200, barFallbackWidth: 300 },
    onExpandChanged,
  }) as any;
  // Expose rootEl and vscode so tests can append rendered elements and verify messages.
  renderer._rootEl = rootEl;
  renderer._vscode = vscode;
  return renderer;
}

/** Await two animation frames (matches state.rerender's double-rAF pattern). */
export async function awaitRerender() {
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));
}
