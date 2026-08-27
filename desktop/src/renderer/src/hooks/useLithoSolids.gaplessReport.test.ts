// What the build verdict does in the state hook.
//
// The gapless gate answers the owner's constraint — *"I can't have gaps or
// fallbacks in the model unless users make mistakes"* — once per build. The
// verdict is only worth anything if it always belongs to the solids currently on
// screen, so these pin the two ways it can get out of step.
//
//   LR1  opening a project shows the LAST build's verdict, not a blank
//   LR2  a build replaces the verdict with its own
//   LR3  a build that returns NO verdict CLEARS the old one — a stale verdict
//        beside a fresh model is worse than none, because it reads as a
//        guarantee about ground it never saw
//   LR4  a verdict that fails to load is no verdict, never a pass
//
// Mocks ``fetch`` and drives the real API client, for the reason recorded in
// ``useLithoSolids.buildRefusal.test.ts``: a hand-built error/response shape
// that differs from what ``request()`` produces lets a live failure hide.

import { renderHook, act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { useLithoSolids } from './useLithoSolids'
import { setBaseUrl } from '../api/clients/shared'
import type { GaplessBuildReport } from '../utils/gaplessGate/types'

const BASE = 'http://127.0.0.1:8765'

function report(verdict: GaplessBuildReport['verdict'], title: string): GaplessBuildReport {
  return {
    verdict,
    generated_at: '2026-08-26T02:00:00Z',
    clauses: [
      {
        key: 'cause-closure',
        number: 3,
        title,
        status: verdict === 'pass' ? 'pass' : 'fail',
        entries: [],
      },
    ],
  }
}

/** What GET .../build-report replies with, and whether it replies at all. */
let storedReport: GaplessBuildReport | null
let reportGetFails: boolean
/** What POST .../build-voxel replies with. */
let buildBody: Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  setBaseUrl(BASE)
  storedReport = null
  reportGetFails = false
  buildBody = { bodies_built: 1, bodies_flagged: 0, solids: [] }

  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const json = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })

      if ((init?.method ?? 'GET') === 'POST') return json(buildBody)
      if (url.endsWith('/build-report')) {
        return reportGetFails ? json({ detail: 'boom' }, 500) : json(storedReport)
      }
      return json([])
    },
  )
})

const builder = (): Promise<unknown> => Promise.resolve({ sections: [{}] })

describe('useLithoSolids — the gapless build verdict', () => {
  it('LR1 shows the last build verdict when the project opens', async () => {
    storedReport = report('fail', 'Every patch of unclassed ground has a known cause')

    const { result } = renderHook(() => useLithoSolids('proj-1', 'model-1', vi.fn()))

    await waitFor(() => expect(result.current.gaplessReport).not.toBeNull())
    expect(result.current.gaplessReport?.verdict).toBe('fail')
    expect(result.current.gaplessReport?.clauses[0].title).toMatch(/known cause/)
  })

  it('LR2 replaces the verdict with the one the build just produced', async () => {
    storedReport = report('fail', 'an old complaint')
    buildBody = {
      bodies_built: 1,
      bodies_flagged: 0,
      solids: [],
      gapless_report: report('pass', 'a promise kept'),
    }

    const { result } = renderHook(() => useLithoSolids('proj-1', 'model-1', vi.fn()))
    await waitFor(() => expect(result.current.gaplessReport?.verdict).toBe('fail'))

    await act(async () => {
      await result.current.buildLithoSolids(builder as never)
    })

    expect(result.current.gaplessReport?.verdict).toBe('pass')
    expect(result.current.gaplessReport?.clauses[0].title).toBe('a promise kept')
  })

  it('LR3 clears the old verdict when the build returns none', async () => {
    storedReport = report('pass', 'a promise kept')
    // No ``gapless_report`` on the response — e.g. a backend that could not
    // assemble one. The previous PASS must not survive next to a new model.
    buildBody = { bodies_built: 1, bodies_flagged: 0, solids: [] }

    const { result } = renderHook(() => useLithoSolids('proj-1', 'model-1', vi.fn()))
    await waitFor(() => expect(result.current.gaplessReport?.verdict).toBe('pass'))

    await act(async () => {
      await result.current.buildLithoSolids(builder as never)
    })

    expect(result.current.gaplessReport).toBeNull()
  })

  it('LR4 treats a verdict that will not load as no verdict, never a pass', async () => {
    storedReport = report('pass', 'a promise kept')
    reportGetFails = true

    const { result } = renderHook(() => useLithoSolids('proj-1', 'model-1', vi.fn()))

    // The solids fetch is independent and still settles, so waiting on the
    // hook's own loading flag is enough to know the report call has resolved.
    await waitFor(() => expect(result.current.lithoSolidsLoading).toBe(false))
    expect(result.current.gaplessReport).toBeNull()
  })
})
