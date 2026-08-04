// The geotech axis is view-only, so it must not hand the panel litho's edit handlers.
//
// `docs/design/geotech-stage.md` calls the geotech render view-only, and
// `PartitionFillOverlay` enforces that for every drag/freedraw/apex path by gating on
// `!refinement`. Two handlers escaped: `onUpdateContactDepth` and `onDeleteContact` were
// passed to SectionPanel unconditionally, while their siblings on the very same call
// (`onCreateContact`, and `onRequestDeleteContact` on the correlation overlay) are gated.
//
// The consequence is not cosmetic. `ContactsLayer` renders its drag hit-strip and its
// right-click delete whenever an edit handler is present, with no axis check of its own,
// so a user can move or delete a geotech contact — and the next "Subdivide all bodies"
// silently discards it, because subdivision rewrites every geotech row in the model.
//
// The litho control is the point of the third case: asserting only that geotech is off
// would pass just as well if the handlers were removed for everyone.

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

describe('SectionsCanvas — the geotech axis hands over no contact-edit handlers', () => {
  beforeEach(() => {
    capturedPanelProps = {}
  })

  afterEach(() => {
    cleanup()
  })

  it('VO1 — a geotech contact cannot be dragged to a new depth', () => {
    renderOn('geotechnical')

    expect(capturedPanelProps.onUpdateContactDepth).toBeUndefined()
  })

  it('VO2 — a geotech contact cannot be deleted from its right-click menu', () => {
    renderOn('geotechnical')

    expect(capturedPanelProps.onDeleteContact).toBeUndefined()
  })

  it('VO3 — the litho axis keeps both, so the gate is about the axis and not the feature', () => {
    renderOn('lithostratigraphic')

    expect(capturedPanelProps.onUpdateContactDepth).toBeDefined()
    expect(capturedPanelProps.onDeleteContact).toBeDefined()
  })

  // The batch pair is the same leak one level down. Today it is unreachable on the
  // geotech axis only because ContactsLayer mounts no drag hit-strip when the four
  // single-contact handlers are all absent — the axis is nowhere in that reasoning.
  // Anything that later grows its own way into the drag machine (an overlay with its
  // own mousedown, a keyboard nudge) would commit geotech contact moves and copies
  // again, and "Subdivide all bodies" would discard them just as silently. The gate
  // belongs on the same call as its siblings, not on an accident of another handler.
  it('VO4 — a geotech contact cannot be moved by a multi-select or cross-column drag', () => {
    renderOn('geotechnical')

    expect(capturedPanelProps.onBatchUpdateContacts).toBeUndefined()
  })

  it('VO5 — a geotech contact cannot be copied onto another column', () => {
    renderOn('geotechnical')

    expect(capturedPanelProps.onBatchCreateContacts).toBeUndefined()
  })

  it('VO6 — the litho axis keeps the batch pair too', () => {
    renderOn('lithostratigraphic')

    expect(capturedPanelProps.onBatchUpdateContacts).toBeDefined()
    expect(capturedPanelProps.onBatchCreateContacts).toBeDefined()
  })
})
