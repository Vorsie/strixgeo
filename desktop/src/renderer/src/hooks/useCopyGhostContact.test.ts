/**
 * Hook-level pins for the GHOST-contact copy gesture (installer #42 owner ask,
 * verbatim: *"copying litho's on cptm is still clunky (can we drag copy ghosts
 * also?)"*).
 *
 * The hook plans one Shift-drag of a source ghost column onto another test
 * (``planGhostContactCopy``) and, on a create, builds the target's ghost column
 * and hands it to ``createGhostColumn`` — the undo-aware ghost-workspace writer.
 * The "one ctrl+z step" pin drives the REAL ``useLithoGhostWorkspace`` +
 * ``useUndoStack`` so the undo end-to-end is exercised, not mocked.
 */

import { renderHook, act } from '@testing-library/react'
import { useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCopyGhostContact } from './useCopyGhostContact'
import { useLithoGhostWorkspace } from './useLithoGhostWorkspace'
import { useUndoStack } from './useUndoStack'
import type { BulkAnchorGhost } from './useGeologicalModel'
import type { GeologicalModelResponse, LithoLayerSuggestion } from '../api/client'

/** A minimal pending suggestion for a source ghost column. */
function sug(
  depth_top_m: number,
  depth_base_m: number,
  suggested_lithology: string,
): LithoLayerSuggestion {
  return {
    depth_top_m,
    depth_base_m,
    suggested_lithology,
    suggested_nad_class: null,
    mean_qc_mpa: null,
    dr_pct: null,
    confidence: 'medium',
    source: 'segmenter',
    suggested_admixtures: [],
    parent_formation_id: null,
    spans_boundary: false,
  }
}

/** A source ghost column: clay 0..3 over sand 3..7, both pending. */
function sourceGhost(over: Partial<BulkAnchorGhost> = {}): BulkAnchorGhost {
  return {
    kind: 'cpt',
    suggestions: [sug(0, 3, 'KLEI'), sug(3, 7, 'ZAND')],
    surfaceElevationM: 12,
    accepted: new Set<number>(),
    rejected: new Set<number>(),
    edits: new Map(),
    ...over,
  }
}

function renderHost(
  ghosts: ReadonlyMap<string, BulkAnchorGhost>,
  over: {
    terminalDepthM?: (id: string, kind: 'cpt' | 'borehole') => number | null
  } = {},
) {
  const createGhostColumn = vi.fn<(id: string, g: BulkAnchorGhost) => void>()
  const toast = vi.fn()
  const { result } = renderHook(() =>
    useCopyGhostContact({
      ghostsByAnchor: ghosts,
      terminalDepthM: over.terminalDepthM ?? (() => 10),
      surfaceElevationM: () => 4,
      createGhostColumn,
      toast,
    }),
  )
  return { result, createGhostColumn, toast }
}

describe('useCopyGhostContact', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shift-dragging a ghost boundary onto another test gives that test a ghost column with the same units', () => {
    const ghosts = new Map([['cpt-a', sourceGhost()]])
    const { result, createGhostColumn, toast } = renderHost(ghosts)
    act(() => {
      result.current.copyGhostContact({
        sourceInvestigationId: 'cpt-a',
        targetInvestigationId: 'cpt-b',
        targetKind: 'cpt',
      })
    })
    expect(createGhostColumn).toHaveBeenCalledTimes(1)
    const [targetId, ghost] = createGhostColumn.mock.calls[0]
    expect(targetId).toBe('cpt-b')
    // A GHOST column (nothing accepted), carrying the SAME units.
    expect(ghost.accepted.size).toBe(0)
    expect(
      ghost.suggestions.map(s => [s.suggested_lithology, s.depth_top_m, s.depth_base_m]),
    ).toEqual([
      ['KLEI', 0, 3],
      ['ZAND', 3, 7],
    ])
    // The target's OWN surface elevation, not the source's.
    expect(ghost.surfaceElevationM).toBe(4)
    expect(toast).toHaveBeenCalledWith('success', expect.any(String), expect.any(String))
  })

  it('a ghost boundary below the target’s depth is dropped like an accepted one', () => {
    const ghosts = new Map([
      ['cpt-a', sourceGhost({ suggestions: [sug(0, 3, 'KLEI'), sug(3, 6, 'ZAND'), sug(6, 10, 'SILT')] })],
    ])
    const { result, createGhostColumn, toast } = renderHost(ghosts, { terminalDepthM: () => 5 })
    act(() => {
      result.current.copyGhostContact({
        sourceInvestigationId: 'cpt-a',
        targetInvestigationId: 'cpt-b',
        targetKind: 'cpt',
      })
    })
    const [, ghost] = createGhostColumn.mock.calls[0]
    expect(
      ghost.suggestions.map(s => [s.suggested_lithology, s.depth_top_m, s.depth_base_m]),
    ).toEqual([
      ['KLEI', 0, 3],
      ['ZAND', 3, 5],
    ])
    const [level, message] = toast.mock.calls[0]
    expect(level).toBe('success')
    expect(message).toMatch(/below this test|left out/i)
  })

  it('an accepted and a ghost boundary in one drag are refused', () => {
    // Source column has one accepted unit and one pending unit.
    const ghosts = new Map([['cpt-a', sourceGhost({ accepted: new Set([0]) })]])
    const { result, createGhostColumn, toast } = renderHost(ghosts)
    act(() => {
      result.current.copyGhostContact({
        sourceInvestigationId: 'cpt-a',
        targetInvestigationId: 'cpt-b',
        targetKind: 'cpt',
      })
    })
    expect(createGhostColumn).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('warning', expect.any(String), expect.any(String))
  })

  it('a target that already has suggestions is refused', () => {
    const ghosts = new Map([
      ['cpt-a', sourceGhost()],
      ['cpt-b', sourceGhost()],
    ])
    const { result, createGhostColumn, toast } = renderHost(ghosts)
    act(() => {
      result.current.copyGhostContact({
        sourceInvestigationId: 'cpt-a',
        targetInvestigationId: 'cpt-b',
        targetKind: 'cpt',
      })
    })
    expect(createGhostColumn).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('warning', expect.any(String), expect.any(String))
  })

  it('a drop on the source column is a silent no-op', () => {
    const ghosts = new Map([['cpt-a', sourceGhost()]])
    const { result, createGhostColumn, toast } = renderHost(ghosts)
    act(() => {
      result.current.copyGhostContact({
        sourceInvestigationId: 'cpt-a',
        targetInvestigationId: 'cpt-a',
        targetKind: 'cpt',
      })
    })
    expect(createGhostColumn).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('a ghost copy is one ctrl+z step', async () => {
    // Wire the REAL ghost workspace + undo stack so the copy's undoability is
    // exercised end to end: one Ctrl+Z removes the target's ghost column.
    const MODEL = { id: 'model-1', name: 'M' } as GeologicalModelResponse
    const { result } = renderHook(() => {
      const [ghosts, setGhosts] = useState<ReadonlyMap<string, BulkAnchorGhost>>(
        new Map([['cpt-a', sourceGhost()]]),
      )
      const undo = useUndoStack()
      const focusedRef = useRef<string | null>(null)
      const ws = useLithoGhostWorkspace({
        ghostsByAnchor: ghosts,
        setGhostsByAnchor: setGhosts,
        setFocusedSuggestAnchorId: () => {},
        setLithoSuggesting: () => {},
        focusedSuggestAnchorIdRef: focusedRef,
        activeLithoModel: MODEL,
        pushUndo: undo.push,
        toast: () => {},
      })
      const copy = useCopyGhostContact({
        ghostsByAnchor: ghosts,
        terminalDepthM: () => 10,
        surfaceElevationM: () => 4,
        createGhostColumn: (id, g) =>
          ws.runGhostCreation(id, 'undo.copyGhostContact', 'ghost-copy', '', () => g),
        toast: () => {},
      })
      return { ghosts, undo, copy }
    })

    act(() => {
      result.current.copy.copyGhostContact({
        sourceInvestigationId: 'cpt-a',
        targetInvestigationId: 'cpt-b',
        targetKind: 'cpt',
      })
    })
    // The target got a ghost column with the same two units.
    expect(result.current.ghosts.get('cpt-b')?.suggestions.length).toBe(2)
    expect(result.current.undo.canUndo).toBe(true)

    // One Ctrl+Z takes the whole copy back, and it was ONLY one step.
    await act(async () => {
      await result.current.undo.undo()
    })
    expect(result.current.ghosts.has('cpt-b')).toBe(false)
    expect(result.current.undo.canUndo).toBe(false)

    // Ctrl+Y brings it back.
    await act(async () => {
      await result.current.undo.redo()
    })
    expect(result.current.ghosts.get('cpt-b')?.suggestions.length).toBe(2)
  })
})
