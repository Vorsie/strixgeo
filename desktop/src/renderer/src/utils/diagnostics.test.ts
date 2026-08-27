/**
 * The renderer's side of local crash capture.
 *
 * The rule: capturing a diagnostic must never be able to *become* the problem.
 * A missing bridge, a rejecting bridge, a bridge that throws synchronously —
 * all of them are the renderer's normal life (jsdom tests, a window closing
 * mid-call), and none of them may surface to the caller, who is already on an
 * error path.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { captureDiagnostic } from './diagnostics'

afterEach(() => {
  delete (window as { electron?: unknown }).electron
  vi.restoreAllMocks()
})

describe('capturing never becomes the crash', () => {
  it('DG1 — with no Electron bridge nothing happens and nothing throws', () => {
    expect(() => captureDiagnostic({ kind: 'api-error', message: 'boom' })).not.toThrow()
  })

  it('DG2 — a bridge that rejects is absorbed', async () => {
    const captureDiagnosticBridge = vi.fn().mockRejectedValue(new Error('ipc gone'))
    ;(window as { electron?: unknown }).electron = { captureDiagnostic: captureDiagnosticBridge }

    expect(() => captureDiagnostic({ kind: 'api-error', message: 'boom' })).not.toThrow()
    // Let the rejection settle — an unabsorbed one would fail the suite.
    await Promise.resolve()
  })

  it('DG3 — a bridge that throws synchronously is absorbed', () => {
    ;(window as { electron?: unknown }).electron = {
      captureDiagnostic: () => {
        throw new Error('bridge exploded')
      },
    }

    expect(() => captureDiagnostic({ kind: 'api-error', message: 'boom' })).not.toThrow()
  })
})

describe('what gets forwarded', () => {
  it('DG4 — the payload reaches the main process as given', () => {
    const captureDiagnosticBridge = vi.fn().mockResolvedValue(undefined)
    ;(window as { electron?: unknown }).electron = { captureDiagnostic: captureDiagnosticBridge }

    captureDiagnostic({
      kind: 'api-error',
      scope: 'api',
      message: 'POST /geology/build → 500',
      httpStatus: 500,
    })

    expect(captureDiagnosticBridge).toHaveBeenCalledWith({
      kind: 'api-error',
      scope: 'api',
      message: 'POST /geology/build → 500',
      httpStatus: 500,
    })
  })
})
