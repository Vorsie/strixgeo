// Regression tests for the drag-to-retarget drop guards (#133 Task 26).
//
// The load-bearing case: the same-investigation guard must judge the drop
// against the contact list AS IT EXISTS AT DROP TIME — a refetch that lands
// mid-drag (mutation completing in the background) can reassign what the
// drop target's investigation is, and dropping onto the anchor's own
// investigation must be rejected with NO api calls (review finding
// 2026-07-13: the guard read the drag-start snapshot instead).

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../api/client', () => ({
  api: {
    geology: {
      deleteContactCorrelation: vi.fn().mockResolvedValue(undefined),
      createContactCorrelation: vi.fn().mockResolvedValue(undefined),
    },
  },
}))

import { api } from '../../../api/client'
import type {
  FormationContactResponse,
  GeologicalModelResponse,
  LithoContactCorrelationEdge,
} from '../../../api/client'
import { useEdgeDragRetarget, type UseEdgeDragRetargetDeps } from './useEdgeDragRetarget'

const contact = (id: string, cptId: string): FormationContactResponse =>
  ({ id, cpt_id: cptId, borehole_id: null }) as unknown as FormationContactResponse

const EDGE = {
  id: 'edge-1',
  model_id: 'model-1',
  layer_a_id: 'contact-anchor',
  layer_b_id: 'contact-dragged',
  layer_a_side: 'top',
  layer_b_side: 'top',
} as unknown as LithoContactCorrelationEdge

function makeDeps(lithoContacts: FormationContactResponse[]): UseEdgeDragRetargetDeps {
  return {
    lithoContacts,
    activeLithoModel: { id: 'model-1' } as unknown as GeologicalModelResponse,
    projectId: 'project-1',
    selectedSectionId: 'section-1',
    refetchContactEdges: vi.fn().mockResolvedValue(undefined),
    refetchLithoContacts: vi.fn().mockResolvedValue(undefined),
    refetchLensData: vi.fn(),
    markMutated: vi.fn(),
    toast: vi.fn(),
  }
}

/** Mount a drop target carrying data-contact-id and point elementFromPoint at it. */
function mountDropTarget(contactId: string): void {
  const el = document.createElement('div')
  el.setAttribute('data-contact-id', contactId)
  document.body.appendChild(el)
  document.elementFromPoint = vi.fn().mockReturnValue(el)
}

function startDrag(result: { current: ReturnType<typeof useEdgeDragRetarget> }): void {
  act(() => {
    result.current.handleUnapprovedDragStart(
      {
        preventDefault: () => {},
        clientX: 10,
        clientY: 10,
        ctrlKey: false,
        metaKey: false,
      } as unknown as React.MouseEvent,
      EDGE,
      'b',
    )
  })
}

async function dropAt(x: number, y: number): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y }))
    // handleMouseUp is async — let the microtask chain settle.
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useEdgeDragRetarget drop guards', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('retargets on a valid drop: deletes the old edge and creates anchor↔drop', async () => {
    // Anchor lives on cpt-1, dragged end on cpt-2, drop target on cpt-3.
    const contacts = [
      contact('contact-anchor', 'cpt-1'),
      contact('contact-dragged', 'cpt-2'),
      contact('contact-drop', 'cpt-3'),
    ]
    mountDropTarget('contact-drop')
    const { result } = renderHook((deps: UseEdgeDragRetargetDeps) => useEdgeDragRetarget(deps), {
      initialProps: makeDeps(contacts),
    })
    startDrag(result)
    await dropAt(50, 50)

    expect(api.geology.deleteContactCorrelation).toHaveBeenCalledTimes(1)
    expect(api.geology.createContactCorrelation).toHaveBeenCalledWith(
      'project-1',
      'model-1',
      'contact-anchor',
      'contact-drop',
      'section-1',
    )
  })

  it('rejects a drop that a mid-drag refetch reassigned to the anchor investigation', async () => {
    // At drag start the drop target sits on cpt-3 (a legal drop). While the
    // drag is in flight a refetch lands and the target now belongs to cpt-1 —
    // the ANCHOR's investigation. Dropping must be rejected: no delete, no
    // create.
    const before = [
      contact('contact-anchor', 'cpt-1'),
      contact('contact-dragged', 'cpt-2'),
      contact('contact-drop', 'cpt-3'),
    ]
    const after = [
      contact('contact-anchor', 'cpt-1'),
      contact('contact-dragged', 'cpt-2'),
      contact('contact-drop', 'cpt-1'), // reassigned mid-drag
    ]
    mountDropTarget('contact-drop')
    const { result, rerender } = renderHook(
      (deps: UseEdgeDragRetargetDeps) => useEdgeDragRetarget(deps),
      { initialProps: makeDeps(before) },
    )
    startDrag(result)
    rerender(makeDeps(after)) // the mid-drag refetch
    await dropAt(50, 50)

    expect(api.geology.deleteContactCorrelation).not.toHaveBeenCalled()
    expect(api.geology.createContactCorrelation).not.toHaveBeenCalled()
  })
})
