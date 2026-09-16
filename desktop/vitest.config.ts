import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/renderer/src/test/setup.ts'],
    include: [
      'src/renderer/src/**/*.{test,spec}.{ts,tsx}',
      // Pure main-process helpers (no Electron import) are testable
      // in jsdom alongside the renderer tests. Test files under
      // src/main MUST NOT import 'electron' — keep helpers pure.
      'src/main/**/*.{test,spec}.{ts,tsx}',
      // The scenario-pass walker's pure modules (policy / invariants / report /
      // process-tree) live beside their Playwright orchestrator under
      // tests/e2e/walker so the spec can import them without crossing
      // tsconfig.e2e's rootDir into src/. Their .test.ts files import vitest
      // explicitly (tsconfig.e2e has no vitest globals) and Playwright ignores
      // them (its testMatch is **/*.spec.ts). Only .test.ts here -- the
      // walker.spec.ts orchestrator is Playwright's, never vitest's.
      'tests/e2e/walker/**/*.test.{ts,tsx}',
      // Build-tooling helpers (the release guard's published-version resolution)
      // are pure ESM modules under scripts/; their tests live beside them so the
      // guard logic is verifiable without a network or a real release.
      'scripts/**/*.{test,spec}.{ts,tsx}',
    ],
    css: false,
  },
})
