import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import fs from 'fs';

function loadCanvasEnv() {
  const root = process.cwd();
  for (const file of ['.env', '.env.example']) {
    const p = resolve(root, file);
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8');
      const env = {};
      for (const raw of content.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const idx = line.indexOf('=');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (key && !(key in process.env)) {
          process.env[key] = value;
        }
      }
      break;
    }
  }
}

loadCanvasEnv();

const API_PORT = process.env.PROMPT_CANVAS_PORT || '52846';

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
        rewrite: (path) => path.replace(/^\/generated/, '/page-assets'),
      },
      '/events': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
