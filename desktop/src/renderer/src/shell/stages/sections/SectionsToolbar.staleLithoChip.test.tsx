// The "columns on edited litho" chip, on the real toolbar (debt #266).
//
// The failure it answers, from the debt entry: "Drag one litho contact and
// every geotech band inside that column is silently describing a lithology
// stack that no longer exists. Nothing marks the geotech model stale, nothing
// warns, and the UI keeps rendering the old bands as though they were current."
// The paying-user consequence on the ballot: a client-facing export of silently
// stale packing.
//
// The wording + merge rules are pinned next to their own module
// (staleGeotechColumns.test.ts); this file pins that the toolbar shows the
// count where the engineer presses the verbs that fix it.
//
//   SLC1  a column standing on edited litho is counted on the toolbar
//   SLC2  the chip names the columns and what to do about them
//   SLC3  with nothing stale the chip is absent — not a zero
//   SLC4  the geometric fit check and the provenance answer make ONE count
//   SLC5  the chip stays off the litho axis

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import SectionsToolbar from './SectionsToolbar'
import { makeShellCtx, makeLithoModel } from './__fixtures__/sectionsShellContext'

const geotechTieStatus = vi.fn()

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
        geotechTieStatus: (...args: unknown[]) => geotechTieStatus(...args),
      },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
    },
  }
})

vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const S17 = { investigation_id: 'inv-s17', label: 'GEO-23/125-S17' }
const S9 = { investigation_id: 'inv-s9', label: 'GEO-23/125-S9' }

function makeCtx(
  overrides: {
    axis?: 'lithostratigraphic' | 'geotechnical'
    provenanceStale?: typeof S17[]
    fitStaleIds?: string[]
  } = {},
): ShellContextValue {
  const base = makeShellCtx(overrides.axis ?? 'geotechnical')
  const stale = overrides.provenanceStale ?? []
  return {
    ...base,
    geoModel: {
      ...base.geoModel,
      activeLithoModel: makeLithoModel(),
      staleLithoGeotechColumns: stale,
      staleLithoGeotechColumnIds: new Set(stale.map(c => c.investigation_id)),
      staleLithoGeotechColumnCount: stale.length,
      columnsNeedingRederive: overrides.fitStaleIds ?? [],
    },
  }
}

function renderToolbar(ctx: ShellContextValue): void {
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsToolbar />
    </ShellContext.Provider>,
  )
}

beforeEach(() => {
  geotechTieStatus.mockResolvedValue({
    geotech_model_id: 'geotech-model-1',
    pending_tie_count: 0,
    accepted_tie_count: 0,
    flagged_tie_count: 0,
    pending_by_section: {},
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SectionsToolbar — the "on edited litho" chip', () => {
  it('SLC1: a column standing on edited litho is counted where the fix lives', async () => {
    renderToolbar(makeCtx({ provenanceStale: [S17, S9] }))

    const chip = await screen.findByTestId('geotech-stale-litho-chip')
    expect(chip.textContent).toContain('2')
  })

  it('SLC2: the chip names the columns and says what to do before exporting', async () => {
    renderToolbar(makeCtx({ provenanceStale: [S17] }))

    const title = (await screen.findByTestId('geotech-stale-litho-chip')).getAttribute('title')
    expect(title).toContain('GEO-23/125-S17')
    expect(title).toMatch(/before exporting/i)
  })

  it('SLC3: with every column matching its lithology there is no chip at all', async () => {
    renderToolbar(makeCtx())

    // A standing "0 stale" badge is weight on the toolbar that never changes,
    // and the engineer stops reading it long before it turns non-zero.
    await screen.findByTestId('geotech-pipeline')
    expect(screen.queryByTestId('geotech-stale-litho-chip')).toBeNull()
  })

  it('SLC4: the two out-of-date signals make ONE count, not two warnings', async () => {
    // The fit check (CPT-only, geometric) and the provenance compare
    // (all columns, all kinds of change) both see S17 here. His action is the
    // same either way — re-run the subdivision on that column.
    renderToolbar(makeCtx({ provenanceStale: [S17], fitStaleIds: ['inv-s17'] }))

    const chip = await screen.findByTestId('geotech-stale-litho-chip')
    expect(chip.textContent).toContain('1')
  })

  it('SLC5: the litho axis does not carry it', async () => {
    // On the litho axis the layers ARE the edit; there is nothing downstream
    // of them on that axis to have gone out of date.
    renderToolbar(makeCtx({ axis: 'lithostratigraphic', provenanceStale: [S17] }))

    expect(screen.queryByTestId('geotech-stale-litho-chip')).toBeNull()
  })
})
