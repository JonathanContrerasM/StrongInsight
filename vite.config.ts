import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Two entries, and the split is deliberate.
 *
 *   index.html -> src/landing.tsx   the marketing page, at the site root
 *   app.html   -> src/main.tsx      the app itself
 *
 * The landing is a real React entry rather than hand-written HTML so that it
 * shares src/index.css and src/ui/primitives.tsx with the app: one set of design
 * tokens, dark mode for free, and no hex literal anywhere in `src/`.
 *
 * Both HTML files carry the same pre-paint theme boot script. That duplication
 * is unavoidable (it must be inline to beat first paint) and is guarded by
 * src/charts/palette.test.ts, which checks every root .html file.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        app: fileURLToPath(new URL('./app.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
