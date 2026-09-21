import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    // Only the UI smoke tests need a DOM; the simulation tests run far faster without one.
    environmentMatchGlobs: [['src/__tests__/**', 'jsdom']],
    testTimeout: 30_000,
  },
});
