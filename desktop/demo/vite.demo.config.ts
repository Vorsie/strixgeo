import path from 'node:path'

import { defineConfig } from 'vite'

/**
 * Standalone Vite config for the partition-fill visual demo.
 *
 * Serves ``desktop/demo/index.html`` on localhost so the pure
 * ``partitionFill`` output can be eyeballed against the target shapes — a
 * planning/verification artifact, NOT part of the shipped Electron build (that
 * goes through ``electron.vite.config``). ``server.fs.allow`` is widened to the
 * ``desktop/`` root so the demo can import ``../src/renderer/...``.
 */
export default defineConfig({
  root: path.resolve(__dirname),
  server: {
    port: 5180,
    fs: { allow: [path.resolve(__dirname, '..')] },
  },
})
