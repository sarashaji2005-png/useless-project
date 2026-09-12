import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `base` is set only for the production build.
 *
 * GitHub Pages serves a project site from a sub-path (/useless-project/), so the
 * built asset URLs have to be prefixed or every script and stylesheet 404s. Dev is
 * left at '/' so localhost keeps working unchanged — Vite would otherwise apply the
 * base in dev too and move the dev server under the sub-path as well.
 *
 * Anything referencing a file in public/ must go through import.meta.env.BASE_URL
 * rather than a leading slash, for the same reason.
 */
export default defineConfig(({ command, isPreview }) => ({
  // Build AND preview use the sub-path, so `vite preview` actually exercises what
  // Pages will serve. Only the dev server stays at '/'.
  base: command === 'build' || isPreview ? '/useless-project/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    // getUserMedia requires a secure context. localhost counts as secure,
    // so plain http on localhost is fine. Only matters if you demo over LAN IP.
    host: true,
  },
}));
