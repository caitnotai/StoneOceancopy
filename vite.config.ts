import { defineConfig } from 'vitest/config';

// `base: './'` keeps asset paths relative, so the build works unchanged on
// GitHub Pages (served from /<repo>/) and on Vercel/Netlify (served from /).
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
