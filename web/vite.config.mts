import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/app/',
  build: { outDir: '../dist/web', emptyOutDir: true, sourcemap: false },
  server: { host: '127.0.0.1', port: 43128, strictPort: true, proxy: { '/api': 'http://127.0.0.1:43127' } }
});
