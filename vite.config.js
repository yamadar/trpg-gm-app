import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.js'],
    // git worktrees (manual under .worktrees/ or harness-created under .claude/worktrees/)
    // are full repo checkouts on disk; excluding them keeps `vitest run` from discovering
    // and double-counting their copies of the test files.
    exclude: [...configDefaults.exclude, '**/.worktrees/**', '**/.claude/**'],
  },
});
