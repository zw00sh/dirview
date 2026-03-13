import { vi, describe, it, expect, beforeEach } from 'vitest';

const registeredCommands: Record<string, (...args: unknown[]) => unknown> = {};

vi.mock('vscode', () => ({
  commands: {
    registerCommand: vi.fn((name: string, cb: (...args: unknown[]) => unknown) => {
      registeredCommands[name] = cb;
      return { dispose: vi.fn() };
    }),
  },
  workspace: {
    workspaceFolders: [],
    getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }),
  },
  env: { clipboard: { writeText: vi.fn() } },
}));

import { registerCommands } from './commands';

describe('registerCommands — truncation isolation', () => {
  const mockConfig = {
    setTruncationEnabled: vi.fn().mockResolvedValue(undefined),
    setShowIgnored: vi.fn().mockResolvedValue(undefined),
    cycleSortMode: vi.fn().mockResolvedValue('files'),
  };

  const mockSidebar = {
    updateTruncateThreshold: vi.fn(),
    updateSortMode: vi.fn(),
    expandAll: vi.fn(),
    collapseAll: vi.fn(),
  };

  const mockTab = {
    updateTruncation: vi.fn(),
    openOrFocus: vi.fn(),
  };

  const mockContext = {
    subscriptions: { push: vi.fn() },
  };

  const getTruncateThreshold = vi.fn().mockReturnValue(4);

  beforeEach(() => {
    vi.clearAllMocks();
    getTruncateThreshold.mockReturnValue(4);
    registerCommands(
      mockContext as never,
      mockConfig as never,
      { sidebar: mockSidebar as never, tab: mockTab as never },
      vi.fn(),
      getTruncateThreshold,
    );
  });

  it('toggleTruncation updates sidebar but not tab', async () => {
    await registeredCommands['dirview.toggleTruncation']();
    expect(mockSidebar.updateTruncateThreshold).toHaveBeenCalledWith(4);
    expect(mockTab.updateTruncation).not.toHaveBeenCalled();
  });

  it('toggleTruncationOff updates sidebar but not tab', async () => {
    await registeredCommands['dirview.toggleTruncationOff']();
    expect(mockSidebar.updateTruncateThreshold).toHaveBeenCalledWith(0);
    expect(mockTab.updateTruncation).not.toHaveBeenCalled();
  });
});
