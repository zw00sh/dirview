import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // 'vscode' is provided by the VS Code runtime and doesn't exist as an npm package.
      // This alias provides a stub module so vite can resolve the import.
      // Tests that need vscode APIs must vi.mock('vscode') with a real mock.
      vscode: path.resolve(__dirname, 'src/test-utils/vscode-stub.ts'),
    },
  },
});
