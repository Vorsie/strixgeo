/**
 * #266 — the geotech axis has to notice when the litho under it moves.
 *
 * The failure this exists to stop, from the debt entry: "Drag one litho contact
 * and every geotech band inside that column is silently describing a lithology
 * stack that no longer exists. Nothing marks the geotech model stale, nothing
 * warns, and the UI keeps rendering the old bands as though they were current."
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useGeotechLithoStaleness } from './useGeotechLithoStaleness'

const geotechLithoStaleness = vi.fn()

vi.mock('../api/client', () => ({
  api: { geology: { geotechLithoStaleness: (...args: unknown[]) => geotechLithoStaleness(...args) } },
}))

const PROJECT = 'project-1'
const MODEL = 'geotech-model-1'

const S17 = { investigation_id: 'inv-s17', label: 'GEO-23/125-S17' }
const S9 = { investigation_id: 'inv-s9', label: 'GEO-23/125-S9' }

function answer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    geotech_model_id: MODEL,
    litho_model_id: 'litho-model-1',
    stale_columns: [],
    stale_column_count: 0,
    banded_column_count: 0,
    unstamped_column_count: 0,
    ...overrides,
  }
}

describe('useGeotechLithoStaleness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    geotechLithoStaleness.mockResolvedValue(answer())
  })

  it('GLS1 names the columns whose litho moved after their bands were made', async () => {
    // The engineer needs to know WHICH column to re-press — a bare count is a
    // warning he cannot act on.
    geotechLithoStaleness.mockResolvedValue(
      answer({ stale_columns: [S17, S9], stale_column_count: 2, banded_column_count: 12 }),
    )

    const { result } = renderHook(() => useGeotechLithoStaleness(PROJECT, MODEL))

    await waitFor(() => expect(result.current.staleColumnCount).toBe(2))
    expect(result.current.staleColumns.map(c => c.label)).toEqual([
      'GEO-23/125-S17',
      'GEO-23/125-S9',
    ])
    expect(result.current.staleColumnIds.has('inv-s17')).toBe(true)
    expect(result.current.staleColumnIds.has('inv-s9')).toBe(true)
  })

  it('GLS2 says nothing when the ground under every column is the ground it was banded on', async () => {
    // Read on every geotech render: the quiet case has to stay quiet or the
    // indicator becomes noise the engineer learns to ignore.
    const { result } = renderHook(() => useGeotechLithoStaleness(PROJECT, MODEL))

    await waitFor(() => expect(geotechLithoStaleness).toHaveBeenCalled())
    expect(result.current.staleColumnCount).toBe(0)
    expect(result.current.staleColumnIds.size).toBe(0)
  })

  it('GLS3 carries "we cannot say" apart from "the ground moved"', async () => {
    // Bands made before the stamp shipped have no provenance. They are not
    // stale — but the coming export guard still has to know it cannot vouch
    // for them, so the count travels separately instead of being dropped.
    geotechLithoStaleness.mockResolvedValue(
      answer({ banded_column_count: 12, unstamped_column_count: 12 }),
    )

    const { result } = renderHook(() => useGeotechLithoStaleness(PROJECT, MODEL))

    await waitFor(() => expect(result.current.unstampedColumnCount).toBe(12))
    expect(result.current.staleColumnCount).toBe(0)
  })

  it('GLS4 asks nothing before a first subdivision exists', async () => {
    // No geotech model means no bands, so there is nothing that could be
    // standing on moved ground — and the route would 404 on a null id.
    const { result } = renderHook(() => useGeotechLithoStaleness(PROJECT, null))

    expect(geotechLithoStaleness).not.toHaveBeenCalled()
    expect(result.current.staleColumnCount).toBe(0)
  })

  it('GLS5 re-reads after a press, so re-pressing the column clears the warning', async () => {
    // The only way to clear this is to do the thing it asks for. That only
    // works if the answer is re-read once the press has re-stamped.
    geotechLithoStaleness.mockResolvedValueOnce(
      answer({ stale_columns: [S17], stale_column_count: 1 }),
    )
    const { result } = renderHook(() => useGeotechLithoStaleness(PROJECT, MODEL))
    await waitFor(() => expect(result.current.staleColumnCount).toBe(1))

    geotechLithoStaleness.mockResolvedValue(answer())
    act(() => result.current.refresh())

    await waitFor(() => expect(result.current.staleColumnCount).toBe(0))
  })

  it('GLS6 re-reads when the litho or the bands change underneath it', async () => {
    // Without this the indicator would keep showing the answer from before the
    // edit — which IS the bug. Same reason useLithoSolids takes refreshOn.
    const { rerender } = renderHook(
      ({ version }: { version: number }) => useGeotechLithoStaleness(PROJECT, MODEL, version),
      { initialProps: { version: 1 } },
    )
    await waitFor(() => expect(geotechLithoStaleness).toHaveBeenCalledTimes(1))

    rerender({ version: 2 })

    await waitFor(() => expect(geotechLithoStaleness).toHaveBeenCalledTimes(2))
  })

  it('GLS7 stays silent when the read itself fails', async () => {
    // An amber marker the engineer has no way to clear is worse than none: a
    // failed read is not evidence the ground moved.
    geotechLithoStaleness.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useGeotechLithoStaleness(PROJECT, MODEL))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.staleColumnCount).toBe(0)
  })
})
