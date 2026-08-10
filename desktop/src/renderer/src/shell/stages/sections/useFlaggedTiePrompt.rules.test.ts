// FT — the question a hand edit raises about the correlations it broke.
//
// The rule under test is the owner's: after an edit flags accepted ties, ASK, rather
// than leave a violet badge for him to find. The interesting parts are not the happy
// path but the two ways it can lie — asking about nothing, and silently leaving a tie
// alone because the list moved under it.

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { LithoContactCorrelationEdge } from '../../../api/clients/geology.types'
import { useFlaggedTiePrompt } from './useFlaggedTiePrompt'

function edge(id: string, a: string, b: string): LithoContactCorrelationEdge {
  return {
    id,
    layer_a_id: a,
    layer_b_id: b,
    layer_a_side: 'top',
    layer_b_side: 'base',
    user_approved: true,
    review_reason: 'class_changed',
  } as LithoContactCorrelationEdge
}

const EDGES = [edge('e1', 'la-1', 'lb-1'), edge('e2', 'la-2', 'lb-2')]

describe('the flagged-tie question', () => {
  it('FT1 — an edit that flagged nothing raises no question', () => {
    const { result } = renderHook(() => useFlaggedTiePrompt({ edges: EDGES, deleteEdge: vi.fn() }))
    act(() => {
      result.current.askAbout([])
    })
    expect(result.current.flaggedCount).toBe(0)
  })

  it('FT2 — the question names how many ties are in it', () => {
    const { result } = renderHook(() => useFlaggedTiePrompt({ edges: EDGES, deleteEdge: vi.fn() }))
    act(() => {
      result.current.askAbout(['e1', 'e2'])
    })
    expect(result.current.flaggedCount).toBe(2)
  })

  it('FT3 — keeping them closes the question and deletes nothing', () => {
    // They are already flagged on the server, so "keep" has nothing to write. The
    // dialog's dismiss paths land here too, which is why it must be the safe answer.
    const deleteEdge = vi.fn()
    const { result } = renderHook(() => useFlaggedTiePrompt({ edges: EDGES, deleteEdge }))
    act(() => {
      result.current.askAbout(['e1'])
    })
    act(() => {
      result.current.keep()
    })
    expect(result.current.flaggedCount).toBe(0)
    expect(deleteEdge).not.toHaveBeenCalled()
  })

  it('FT4 — deleting disconnects each tie by its layer pair and sides', () => {
    // The delete endpoint addresses a tie by its two layers, not by edge id, so the
    // id has to be resolved against the list that is on screen NOW — after the edit's
    // refetch, since the edit re-anchors ties onto surviving rows.
    const deleteEdge = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useFlaggedTiePrompt({ edges: EDGES, deleteEdge }))
    act(() => {
      result.current.askAbout(['e1', 'e2'])
    })
    act(() => {
      void result.current.deleteAll()
    })
    return waitFor(() => {
      expect(deleteEdge).toHaveBeenCalledTimes(2)
      expect(deleteEdge).toHaveBeenNthCalledWith(1, 'la-1', 'lb-1', 'top', 'base')
      expect(deleteEdge).toHaveBeenNthCalledWith(2, 'la-2', 'lb-2', 'top', 'base')
      expect(result.current.flaggedCount).toBe(0)
    })
  })

  it('FT5 — a flagged id that is no longer on the section is skipped, not guessed at', () => {
    // Between the question and the answer the list can move: another edit, or a
    // refetch that dropped the tie. Deleting "the nearest thing" would remove a
    // correlation the engineer never judged, so the only safe answer is to leave it.
    const deleteEdge = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useFlaggedTiePrompt({ edges: EDGES, deleteEdge }))
    act(() => {
      result.current.askAbout(['e1', 'gone'])
    })
    act(() => {
      void result.current.deleteAll()
    })
    return waitFor(() => {
      expect(deleteEdge).toHaveBeenCalledTimes(1)
      expect(deleteEdge).toHaveBeenCalledWith('la-1', 'lb-1', 'top', 'base')
    })
  })

  it('FT6 — one failed disconnect does not abandon the others', () => {
    // The engineer answered "delete them", not "delete them until one fails". The
    // disconnect handler reports each failure itself with a sticky toast and rolls
    // its own optimistic edit back, so there is nothing here that a stop would
    // protect. The question closes either way: leaving the dialog open on top of an
    // error toast stacks two messages about one event and traps him behind a modal
    // he cannot answer.
    const deleteEdge = vi
      .fn()
      .mockRejectedValueOnce(new Error('backend gone'))
      .mockResolvedValue(undefined)
    const { result } = renderHook(() => useFlaggedTiePrompt({ edges: EDGES, deleteEdge }))
    act(() => {
      result.current.askAbout(['e1', 'e2'])
    })
    act(() => {
      void result.current.deleteAll()
    })
    return waitFor(() => {
      expect(deleteEdge).toHaveBeenCalledTimes(2)
      expect(deleteEdge).toHaveBeenNthCalledWith(2, 'la-2', 'lb-2', 'top', 'base')
      expect(result.current.flaggedCount).toBe(0)
      expect(result.current.busy).toBe(false)
    })
  })
})
