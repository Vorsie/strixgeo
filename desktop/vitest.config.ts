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
    ],
    css: false,
  },
})
