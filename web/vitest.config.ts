import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    // Only the UI smoke tests need a DOM; the simulation tests run far faster without one.
    environmentMatchGlobs: [['src/__tests__/**', 'jsdom']],
    testTimeout: 30_000,
  },
});
