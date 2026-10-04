import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const TELEMETRY_URL = 'https://odml.pa.googleapis.com/v1/log';

/**
 * MediaPipe's JS bundle posts usage telemetry to Google every 60 s, with no option to turn it off.
 * The booth must make no network requests, so point it at an inert data: URL instead, and fail the
 * build if a future MediaPipe version sneaks it back in.
 */
function stripMediapipeTelemetry(): Plugin {
  return {
    name: 'strip-mediapipe-telemetry',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@mediapipe/tasks-vision') || !code.includes(TELEMETRY_URL)) return null;
      return { code: code.replaceAll(TELEMETRY_URL, 'data:,'), map: null };
    },
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        const text = chunk.type === 'chunk' ? chunk.code : String(chunk.source);
        if (text.includes('odml.pa.googleapis.com')) {
          this.error(`MediaPipe telemetry URL found in ${chunk.fileName} — update stripMediapipeTelemetry()`);
        }
      }
    },
  };
}

/**
 * Content-Security-Policy for the production build: the page may only talk to its own origin,
 * so nothing (camera frames included) can ever be sent elsewhere.
 */
function offlineCsp(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "connect-src 'self' blob: data:",
    "img-src 'self' blob: data:",
    "media-src 'self' blob: mediastream:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');
  return {
    name: 'offline-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
        injectTo: 'head-prepend',
      },
    ],
  };
}

// BASE_PATH lets the same build be hosted under a sub-folder (e.g. GitHub Pages).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [stripMediapipeTelemetry(), offlineCsp()],
  // Keep MediaPipe out of dev pre-bundling so the telemetry strip applies in `npm run dev` too.
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        bench: resolve(import.meta.dirname, 'bench/index.html'),
      },
    },
  },
  server: { host: 'localhost', port: 5173 },
  preview: { host: 'localhost', port: 4173 },
  test: { environment: 'node' },
});
