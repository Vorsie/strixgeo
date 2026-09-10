import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { usePromiseConfirm } from './usePromiseConfirm'

describe('usePromiseConfirm — a dialog as an awaitable question', () => {
  it('ask opens the dialog and resolves with the answer given', async () => {
    const { result } = renderHook(() => usePromiseConfirm())
    expect(result.current.open).toBe(false)
    let pending!: Promise<boolean>
    act(() => {
      pending = result.current.ask()
    })
    expect(result.current.open).toBe(true)
    act(() => result.current.answer(true))
    expect(result.current.open).toBe(false)
    await expect(pending).resolves.toBe(true)
  })

  it('Cancel resolves false', async () => {
    const { result } = renderHook(() => usePromiseConfirm())
    let pending!: Promise<boolean>
    act(() => {
      pending = result.current.ask()
    })
    act(() => result.current.answer(false))
    await expect(pending).resolves.toBe(false)
  })

  it('a second ask while one is open answers the first with false', async () => {
    const { result } = renderHook(() => usePromiseConfirm())
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = result.current.ask()
    })
    act(() => {
      second = result.current.ask()
    })
    await expect(first).resolves.toBe(false)
    act(() => result.current.answer(true))
    await expect(second).resolves.toBe(true)
  })
})
