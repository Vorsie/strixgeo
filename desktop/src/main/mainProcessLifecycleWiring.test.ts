// Source-text pins (betaGateWiring.test.ts style) for the H3 lifecycle wiring in
// index.ts. index.ts imports electron at module scope, so these properties are
// invisible to a runtime test; the pure decisions are pinned in their own policy
// tests (backendRespawnPolicy / rendererGonePolicy / backendProbe), and these
// guard the PLACE each is acted on.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const MAIN_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8').replace(/\r\n/g, '\n')

describe('H3(c) - the uncaught-exception handler kills the child trees before exiting', () => {
  it('a crash exit still kills the children - runShutdown(crash) runs before process.exit(1)', () => {
    const handler = MAIN_SOURCE.slice(MAIN_SOURCE.indexOf("process.on('uncaughtException'"))
    const killAt = handler.indexOf("runShutdown('crash')")
    const exitAt = handler.indexOf('process.exit(1)')
    expect(killAt).toBeGreaterThanOrEqual(0)
    expect(exitAt).toBeGreaterThanOrEqual(0)
    // A bare process.exit(1) would orphan the uvicorn child + its parse-pool
    // grandchildren + the Postgres cluster; the tree kill must run first.
    expect(killAt).toBeLessThan(exitAt)
  })
})

describe('H3(a) — a backend that died after readiness is respawned once', () => {
  it('the exit handler routes an after-ready exit to the respawn path', () => {
    expect(MAIN_SOURCE).toContain('handleReadyBackendExit()')
    // The renderer is told it is reconnecting, and told again when it is back.
    expect(MAIN_SOURCE).toContain("send('app:backend-restarting')")
    expect(MAIN_SOURCE).toContain("send('app:backend-ready')")
  })

  it('a deliberate stop (shutdown / crash handler) never respawns', () => {
    // stopApi marks the kill as ours, and the exit handler bails on that flag
    // BEFORE the respawn branch — otherwise quitting would spawn a lingering
    // backend a second before the app exits.
    expect(MAIN_SOURCE).toContain('intentionalBackendStop = true')
    const exitHandler = MAIN_SOURCE.slice(MAIN_SOURCE.indexOf("apiProcess.on('exit'"))
    const guardAt = exitHandler.indexOf('if (intentionalBackendStop)')
    const respawnAt = exitHandler.indexOf('handleReadyBackendExit()')
    expect(guardAt).toBeGreaterThanOrEqual(0)
    expect(guardAt).toBeLessThan(respawnAt)
  })
})

describe('H3(b) — the readiness probe cannot adopt a foreign backend', () => {
  it('probes through backendProbeHeaders + classifyBackendProbe', () => {
    expect(MAIN_SOURCE).toContain('backendProbeHeaders(app.isPackaged, localClientToken)')
    expect(MAIN_SOURCE).toContain('classifyBackendProbe(app.isPackaged')
    // The raw token-less fetch of openapi.json is gone from the probe path.
    expect(MAIN_SOURCE).not.toMatch(/const res = await fetch\(`\$\{API_BASE\}\/openapi\.json`\)\n/)
  })
})

describe('H3(d) — a crashed renderer is reloaded once', () => {
  it('render-process-gone consults the reload policy and reloads the window', () => {
    const handler = MAIN_SOURCE.slice(MAIN_SOURCE.indexOf("on('render-process-gone'"), MAIN_SOURCE.indexOf("on('render-process-gone'") + 2000)
    expect(handler).toContain('shouldReloadRendererAfterGone(details.reason')
    expect(handler).toContain('win.reload()')
  })
})
