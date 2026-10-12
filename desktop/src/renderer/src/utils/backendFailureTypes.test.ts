// Tester finding 2026-10-12: the ``app:backend-failed`` payload now names the
// cause ``port-busy`` and the engine port. Readers stay tolerant: an older main
// sends nothing, and an unknown cause or a junk port reads as absent.

import { describe, expect, it } from 'vitest'

import { backendFailurePortOf, backendFailureReasonOf } from './backendFailureTypes'

describe('backendFailureReasonOf / backendFailurePortOf', () => {
  it('BFT1 - port-busy and newer-database are named; anything else is null', () => {
    expect(backendFailureReasonOf({ reason: 'port-busy', port: 8767 })).toBe('port-busy')
    expect(backendFailureReasonOf({ reason: 'newer-database' })).toBe('newer-database')
    expect(backendFailureReasonOf({ reason: 'something-new' })).toBeNull()
    expect(backendFailureReasonOf(undefined)).toBeNull()
  })

  it('BFT2 - the port is read when it is a valid TCP port, else null', () => {
    expect(backendFailurePortOf({ reason: 'port-busy', port: 8767 })).toBe(8767)
    expect(backendFailurePortOf({ reason: null })).toBeNull()
    expect(backendFailurePortOf({ port: '8767' })).toBeNull()
    expect(backendFailurePortOf({ port: 0 })).toBeNull()
    expect(backendFailurePortOf({ port: 70000 })).toBeNull()
    expect(backendFailurePortOf(null)).toBeNull()
  })
})
