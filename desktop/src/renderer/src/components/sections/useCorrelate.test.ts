// Tests for useCorrelate hook (Slice 4, #67-area).
//
// Verifies the state-machine transitions without any network calls:
//   UC1  enterMode → correlateMode true, source null.
//   UC2  arm → correlationSource set, mode remains true.
//   UC3  clearArmed → source null, mode still true (Esc layer 1).
//   UC4  exitMode → both mode and source cleared (Esc layer 2).
//   UC5  arm then exitMode → both cleared.
//   UC6  enterMode is idempotent (double-call stays in mode).

import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useCorrelate } from './useCorrelate'
import type { CorrelationSource } from './useCorrelate'

const SOURCE_A: CorrelationSource = {
  formationId: 'f-a',
  investigationId: 'inv-1',
  label: 'ZAND (CPT-1)',
}

const SOURCE_B: CorrelationSource = {
  formationId: 'f-b',
  investigationId: 'inv-2',
  label: 'KLEI (BH-1)',
}

describe('useCorrelate', () => {
  it('UC1: starts idle — mode false, source null', () => {
    const { result } = renderHook(() => useCorrelate())
    expect(result.current.correlateMode).toBe(false)
    expect(result.current.correlationSource).toBeNull()
  })

  it('UC2: enterMode sets correlateMode true, source remains null', () => {
    const { result } = renderHook(() => useCorrelate())
    act(() => result.current.enterMode())
    expect(result.current.correlateMode).toBe(true)
    expect(result.current.correlationSource).toBeNull()
  })

  it('UC3: arm sets correlationSource, mode stays true', () => {
    const { result } = renderHook(() => useCorrelate())
    act(() => result.current.enterMode())
    act(() => result.current.arm(SOURCE_A))
    expect(result.current.correlationSource).toEqual(SOURCE_A)
    expect(result.current.correlateMode).toBe(true)
  })

  it('UC4: clearArmed clears source but keeps mode (Esc layer 1)', () => {
    const { result } = renderHook(() => useCorrelate())
    act(() => result.current.enterMode())
    act(() => result.current.arm(SOURCE_A))
    act(() => result.current.clearArmed())
    expect(result.current.correlationSource).toBeNull()
    expect(result.current.correlateMode).toBe(true)
  })

  it('UC5: exitMode clears both mode and source (Esc layer 2)', () => {
    const { result } = renderHook(() => useCorrelate())
    act(() => result.current.enterMode())
    act(() => result.current.arm(SOURCE_A))
    act(() => result.current.exitMode())
    expect(result.current.correlateMode).toBe(false)
    expect(result.current.correlationSource).toBeNull()
  })

  it('UC6: exitMode without prior enterMode stays idle', () => {
    const { result } = renderHook(() => useCorrelate())
    act(() => result.current.exitMode())
    expect(result.current.correlateMode).toBe(false)
    expect(result.current.correlationSource).toBeNull()
  })

  it('UC7: arm replaces previous source (switching investigations)', () => {
    const { result } = renderHook(() => useCorrelate())
    act(() => result.current.enterMode())
    act(() => result.current.arm(SOURCE_A))
    act(() => result.current.arm(SOURCE_B))
    expect(result.current.correlationSource).toEqual(SOURCE_B)
  })

  it('UC8: enterMode is idempotent', () => {
    const { result } = renderHook(() => useCorrelate())
    act(() => result.current.enterMode())
    act(() => result.current.enterMode())
    expect(result.current.correlateMode).toBe(true)
    expect(result.current.correlationSource).toBeNull()
  })
})
