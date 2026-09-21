import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rollupOptions: {
      output: {
        // The fitted model and historical evidence change only when the ml/ pipeline is
        // re-run, so they cache separately from application code.
        manualChunks: { data: ['./src/models/context.json', './src/models/circuits.json'] },
      },
    },
  },
  server: { port: 5173 },
});
