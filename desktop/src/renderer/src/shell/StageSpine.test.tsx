// SelectionFooter test (debt #44 ship).
//
// Pins the cross-stage selection-feedback contract:
//   S1 — footer is empty (data-testid="selection-footer-empty")
//        when no investigations are selected.
//   S2 — footer shows "N selected" badge when the set is non-empty.
//   S3 — clicking the badge calls setMarqueeSelectedIds with an
//        empty Set (the "clear" verb).
//
// The spine button list itself is exercised by AppShell.test.tsx;
// this file focuses on the footer addition.

import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import StageSpine from './StageSpine'

const setMarqueeSelectedIds = vi.fn()

// Mock the shell context. The stage descriptors' useStageSummary hooks
// also read useShell — provide just enough empty defaults to keep them
// from throwing. The test only asserts the footer behaviour, not the
// summary content.
vi.mock('./ShellContext', () => ({
  useShell: () => ({
    coordinator: {
      marqueeSelectedIds: currentSelection,
      setMarqueeSelectedIds,
    },
    investigations: { cpts: [], boreholes: [], plotMap: new Map() },
    visibleCpts: [],
    visibleBoreholes: [],
    sections: { visibleSections: [], sections: [] },
    geoModel: {
      visibleFormations: [],
      lithoFormations: [],
      activeGeologicalModel: null,
      activeLithoModel: null,
      formations: [],
    },
  }),
}))

// Per-test mutable selection — reassigned before each render.
let currentSelection: Set<string> = new Set()

afterEach(() => {
  cleanup()
  setMarqueeSelectedIds.mockReset()
  currentSelection = new Set()
})

describe('StageSpine selection footer (debt #44)', () => {
  it('S1 — footer is empty when nothing is selected', () => {
    currentSelection = new Set()
    render(<StageSpine activeStageId="data" onSelectStage={vi.fn()} />)
    expect(screen.getByTestId('selection-footer-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('selection-footer')).not.toBeInTheDocument()
  })

  it('S2 — footer shows the count badge when the set is non-empty', () => {
    currentSelection = new Set(['cpt-1', 'cpt-2', 'bh-3'])
    render(<StageSpine activeStageId="data" onSelectStage={vi.fn()} />)
    expect(screen.getByTestId('selection-footer')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('S3 — clicking the badge clears the selection (empty Set)', () => {
    currentSelection = new Set(['cpt-1', 'cpt-2'])
    render(<StageSpine activeStageId="data" onSelectStage={vi.fn()} />)
    fireEvent.click(screen.getByTestId('selection-footer-clear'))
    expect(setMarqueeSelectedIds).toHaveBeenCalledTimes(1)
    const arg = setMarqueeSelectedIds.mock.calls[0][0] as Set<string>
    expect(arg).toBeInstanceOf(Set)
    expect(arg.size).toBe(0)
  })
})
