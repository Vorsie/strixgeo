// The hole opened in the geotech axis's view-only gate is exactly two verbs wide.
//
// `SectionsCanvas.geotechViewOnly.test.tsx` pins that the geotech axis hands the panel no
// contact-edit handlers, and that stays true: contacts still cannot be created, dragged or
// deleted there. What changes (owner spec 2026-08-01) is that split and merge of packing
// SUB-BANDS become possible by hand — through their own endpoints, which re-derive the NAD
// class from qc rather than moving a contact.
//
// So the pin has two halves and needs both. Asserting only that split/merge arrived would
// pass just as well if the whole gate had been torn out; asserting only that contacts stay
// locked would pass if the feature had never been wired. The litho control is the third
// case: these two verbs are geotech's own, and must not appear on the litho axis, where
// splitting is a ghost-suggestion edit with entirely different persistence.

import { render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import SectionsCanvas from './SectionsCanvas'
import { makeShellCtx } from './__fixtures__/sectionsShellContext'

/** Captures SectionPanel's whole prop bag, so handler gating is observable. */
let capturedPanelProps: Record<string, unknown> = {}

vi.mock('../../../components/SectionPanel', () => ({
  default: (props: Record<string, unknown>) => {
    capturedPanelProps = props
    return null
  },
}))

vi.mock('../../../components/MapView', () => ({
  default: () => null,
}))

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        createContactCorrelation: vi.fn().mockResolvedValue(undefined),
        deleteContactCorrelation: vi.fn().mockResolvedValue(undefined),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
        listGeotechPackingCorrelations: vi.fn().mockResolvedValue([]),
        previewSplitGeotechBand: vi.fn().mockResolvedValue(undefined),
        previewMergeGeotechBands: vi.fn().mockResolvedValue(undefined),
        splitGeotechBand: vi.fn().mockResolvedValue(undefined),
        mergeGeotechBands: vi.fn().mockResolvedValue(undefined),
      },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
      section: { list: vi.fn().mockResolvedValue([]), get: vi.fn() },
    },
  }
})

function renderOn(axis: 'geotechnical' | 'lithostratigraphic'): void {
  const ctx = makeShellCtx(axis)
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsCanvas />
    </ShellContext.Provider>,
  )
}

describe('SectionsCanvas — split and merge of packing bands open on the geotech axis', () => {
  beforeEach(() => {
    capturedPanelProps = {}
  })

  afterEach(() => {
    cleanup()
  })

  it('BH1 — a packing band can be split by hand', () => {
    renderOn('geotechnical')

    expect(capturedPanelProps.onRequestGeotechSplitBand).toBeDefined()
  })

  it('BH2 — two adjacent packing bands can be merged by hand', () => {
    renderOn('geotechnical')

    expect(capturedPanelProps.onRequestGeotechMergeBands).toBeDefined()
  })

  it('BH3 — and nothing else opens: contacts still cannot be dragged or deleted there', () => {
    renderOn('geotechnical')

    expect(capturedPanelProps.onUpdateContactDepth).toBeUndefined()
    expect(capturedPanelProps.onDeleteContact).toBeUndefined()
    expect(capturedPanelProps.onCreateContact).toBeUndefined()
  })

  it('BH4 — the two verbs are geotech’s own; the litho axis is not handed them', () => {
    renderOn('lithostratigraphic')

    expect(capturedPanelProps.onRequestGeotechSplitBand).toBeUndefined()
    expect(capturedPanelProps.onRequestGeotechMergeBands).toBeUndefined()
  })
})
