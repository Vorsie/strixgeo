import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { withSlowRestoreHint } from './slowRestoreHint'

// "keep waiting, but after a short moment say so; a quick restore says nothing"
describe('withSlowRestoreHint', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires the hint once when the work is still pending after the delay, and still returns the result', async () => {
    let finish: (v: string) => void = () => {}
    const work = new Promise<string>((resolve) => { finish = resolve })
    const onSlow = vi.fn()
    const done = withSlowRestoreHint(work, onSlow, 2_000)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(onSlow).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onSlow).toHaveBeenCalledTimes(1)
    finish('ok')
    await expect(done).resolves.toBe('ok')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(onSlow).toHaveBeenCalledTimes(1)
  })

  it('never fires when the work settles before the delay — resolved or rejected', async () => {
    const onSlow = vi.fn()
    await expect(withSlowRestoreHint(Promise.resolve(1), onSlow, 2_000)).resolves.toBe(1)
    await expect(withSlowRestoreHint(Promise.reject(new Error('x')), onSlow, 2_000)).rejects.toThrow('x')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(onSlow).not.toHaveBeenCalled()
  })
})
