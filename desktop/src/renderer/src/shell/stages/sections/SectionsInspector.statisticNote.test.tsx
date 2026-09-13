// The representative-qc note in the Sections inspector.
//
// Owner, 2026-09-11, on the over-full ⋯ menu: the "qc" explanation is
// information, not a verb, so it leaves the menu rows and is shown in the
// inspector instead. The PICKER stays in the toolbar where the choice is made.
//
// Claims pinned:
//   SN1  the statistic note lives in the inspector, not the More menu
//   SN2  it is a muted line, not a button — nothing here is pressable
//   SN3  it is a geotech-axis block: the litho axis does not carry it

import { getLanguage, setLanguage } from '../../../i18n/languageSelect'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { SectionModelAxis } from '../../../hooks/useSections'
import SectionsInspector from './SectionsInspector'
import { makeShellCtx } from './__fixtures__/sectionsShellContext'
import {
  publishGeotechStatistic,
} from '../../../utils/geotechStatisticStore'
import { DEFAULT_GEOTECH_STATISTIC } from '../../../utils/geotechStatistic'

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
      },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
    },
  }
})

vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  // The statistic store is module-global; reset it so a published value cannot
  // leak into the next test.
  publishGeotechStatistic(DEFAULT_GEOTECH_STATISTIC)
})

function renderInspector(axis: SectionModelAxis): void {
  const ctx: ShellContextValue = makeShellCtx(axis)
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsInspector />
    </ShellContext.Provider>,
  )
}

describe('the Sections inspector explains the representative qc', () => {
  it('SN1 — the statistic note lives in the inspector', () => {
    renderInspector('geotechnical')

    const note = screen.getByTestId('sections-inspector-statistic-note')
    expect(note.textContent ?? '').toMatch(/next subdivide/i)
    expect(note.textContent ?? '').toMatch(/nothing re-runs/i)
  })

  it('SN2 — it is a muted line, not a button', () => {
    renderInspector('geotechnical')

    const note = screen.getByTestId('sections-inspector-statistic-note')
    expect(note.tagName).toBe('P')
    expect(note.className).toContain('text-text-muted')
  })

  it('SN3 — the litho axis does not carry the geotech note', () => {
    renderInspector('lithostratigraphic')

    expect(screen.queryByTestId('sections-inspector-statistic-note')).toBeNull()
  })

  it('the inspector shows the chosen statistic', () => {
    // Owner ruling 5 (2026-09-12): "yes show it in the inspector, especially if
    // we are only showing it once." The value is the SAME token the toolbar's qc
    // dropdown shows, published to the store the inspector reads.
    publishGeotechStatistic('harmonic')
    renderInspector('geotechnical')

    const value = screen.getByTestId('sections-inspector-statistic-value')
    expect(value.textContent ?? '').toContain('harmonic')
    // The English prefix, so the value never reads as a bare token.
    expect(value.textContent ?? '').toMatch(/statistic/i)
  })

  it('the chosen-statistic value is a geotech-axis line only', () => {
    publishGeotechStatistic('harmonic')
    renderInspector('lithostratigraphic')

    expect(screen.queryByTestId('sections-inspector-statistic-value')).toBeNull()
  })
})

// Owner 2026-09-13: "token of course needs translation in dutch version".
describe('the statistic token reads in Dutch in the Dutch version', () => {
  const initialLanguage = getLanguage()
  afterEach(() => {
    setLanguage(initialLanguage)
  })

  it('the inspector reads Statistiek: mediaan, not median', () => {
    setLanguage('nl')
    publishGeotechStatistic('median')
    renderInspector('geotechnical')

    const text = screen.getByTestId('sections-inspector-statistic-value').textContent ?? ''
    expect(text).toContain('mediaan')
    expect(text).not.toContain('median')
  })
})
