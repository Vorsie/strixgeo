/**
 * Pins for the cross-project invariant (owner 2026-10-13).
 *
 * The bug the owner found by hand and the walker could not: opening a SECOND
 * project left the first project's models active -- a 404 burst and console
 * errors. The rule, in its own words: after a switch, no request may carry a
 * model id of the previous project. Two shapes break it:
 *
 *   (a) a request under project B's path that names a model id first seen
 *       under project A -> finding ``cross-project-request``;
 *   (b) a request under project A's path while project B is the open one ->
 *       finding ``cross-project-request``.
 *
 * Same project -> no finding. While no project is known to be open (the switch
 * itself, the welcome screen) nothing is judged.
 *
 * Explicit vitest imports (see walkerPolicy.test.ts for why).
 */

import { describe, it, expect } from 'vitest'

import { CrossProjectLedger, idsInUrl } from './walkerCrossProject'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const MA = '11111111-1111-4111-8111-111111111111'
const MB = '22222222-2222-4222-8222-222222222222'
const BASE = 'http://127.0.0.1:8765'

describe('cross-project invariant -- reading ids from a url', () => {
  it('finds the project id and the model id of a model route', () => {
    expect(idsInUrl(`${BASE}/projects/${A}/geology/models/${MA}/contacts?x=1`)).toEqual({
      projectId: A,
      modelIds: [MA],
    })
  })

  it('finds a model id passed as a query parameter', () => {
    expect(idsInUrl(`${BASE}/projects/${A}/sections?model_id=${MA}`).modelIds).toEqual([MA])
  })

  it('a url with no project has no project id', () => {
    expect(idsInUrl(`${BASE}/projects/`)).toEqual({ projectId: null, modelIds: [] })
  })
})

describe("cross-project invariant -- A's model id under B's project path", () => {
  it('is a finding', () => {
    const ledger = new CrossProjectLedger()
    ledger.registerModels(A, [MA])
    const f = ledger.check(
      [{ method: 'GET', url: `${BASE}/projects/${B}/geology/models/${MA}/layers`, currentProjectId: B }],
      12,
    )
    expect(f).toHaveLength(1)
    expect(f[0].invariant).toBe('cross-project-request')
    expect(f[0].step).toBe(12)
    expect(f[0].detail).toContain(MA)
    expect(f[0].detail).toContain(A)
  })

  it('is learned from traffic too: a model first requested under A, later under B', () => {
    const ledger = new CrossProjectLedger()
    expect(
      ledger.check([{ method: 'GET', url: `${BASE}/projects/${A}/geology/models/${MA}`, currentProjectId: A }], 1),
    ).toEqual([])
    const f = ledger.check(
      [{ method: 'GET', url: `${BASE}/projects/${B}/geology/models/${MA}`, currentProjectId: B }],
      2,
    )
    expect(f.map(x => x.invariant)).toEqual(['cross-project-request'])
  })
})

describe("cross-project invariant -- A's project path while B is open", () => {
  it('is a finding once A is a known project', () => {
    const ledger = new CrossProjectLedger()
    ledger.registerModels(A, [MA])
    ledger.registerModels(B, [MB])
    const f = ledger.check(
      [{ method: 'GET', url: `${BASE}/projects/${A}/geology/models/${MA}/contacts`, currentProjectId: B }],
      30,
    )
    expect(f).toHaveLength(1)
    expect(f[0].detail).toContain(`project ${B} is open`)
  })
})

describe('cross-project invariant -- no finding', () => {
  it('same project: its own model under its own path', () => {
    const ledger = new CrossProjectLedger()
    ledger.registerModels(A, [MA])
    ledger.registerModels(B, [MB])
    expect(
      ledger.check(
        [
          { method: 'GET', url: `${BASE}/projects/${B}/geology/models/${MB}/layers`, currentProjectId: B },
          { method: 'GET', url: `${BASE}/projects/${A}/geology/models/${MA}/layers`, currentProjectId: A },
        ],
        3,
      ),
    ).toEqual([])
  })

  it('no project known to be open (mid-switch, welcome screen)', () => {
    const ledger = new CrossProjectLedger()
    ledger.registerModels(A, [MA])
    ledger.registerModels(B, [MB])
    expect(
      ledger.check(
        [{ method: 'GET', url: `${BASE}/projects/${A}/geology/models/${MA}`, currentProjectId: null }],
        4,
      ),
    ).toEqual([])
  })

  it('a request for a project the walk never opened is not judged', () => {
    const ledger = new CrossProjectLedger()
    ledger.registerModels(B, [MB])
    const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    expect(ledger.check([{ method: 'GET', url: `${BASE}/projects/${other}`, currentProjectId: B }], 5)).toEqual([])
  })

  it('the same stale url repeating is reported once, not once per poll', () => {
    const ledger = new CrossProjectLedger()
    ledger.registerModels(A, [MA])
    const req = { method: 'GET', url: `${BASE}/projects/${B}/geology/models/${MA}/layers`, currentProjectId: B }
    expect(ledger.check([req, req], 6)).toHaveLength(1)
    expect(ledger.check([req], 7)).toHaveLength(0)
  })
})
