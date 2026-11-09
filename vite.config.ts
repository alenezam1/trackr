import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = Number(process.env.TRACKR_PORT ?? 4317);

export default defineConfig({
  plugins: [react()],
  root: 'src',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: { '/api': `http://127.0.0.1:${API_PORT}` },
  },
});
