// Vite config for Prism.
// GitHub Pages serves at https://<user>.github.io/prism/, so `base` matches.
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/prism/',
  build: { rollupOptions: { input: { main: 'index.html' } } },
});
