import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const api = `http://localhost:${process.env.PORT || 8788}`;
export default defineConfig({
  plugins: [svelte()],
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': api, '/media': api, '/stream': api },
  },
  build: { target: 'safari16', outDir: 'dist', emptyOutDir: true },
});
