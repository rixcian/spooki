import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import rootPackage from '../package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The root package.json is the version of record (see README → Releases).
  define: { __APP_VERSION__: JSON.stringify(rootPackage.version) },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
