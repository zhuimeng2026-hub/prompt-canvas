import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const API_PORT = process.env.PROMPT_CANVAS_PORT || '47321';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'canvas'),
  base: '/canvas/',
  build: {
    outDir: resolve(__dirname, 'canvas', 'dist'),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
      '/generated': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
      '/events': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
