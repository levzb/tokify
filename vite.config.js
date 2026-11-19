import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The app lives in src/, iPhone Home Screen files in iphone/public/, the build goes to dist/.
const api = `http://localhost:${process.env.PORT || 8788}`;
export default defineConfig({
  root: 'src',
  publicDir: '../iphone/public',
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: { '/api': api, '/media': api, '/stream': api },
  },
  build: { target: 'safari16', outDir: '../dist', emptyOutDir: true },
});
