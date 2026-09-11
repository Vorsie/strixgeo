// Owner findings on the sheet preview dialog (2026-09-04):
//  1. The controls are black-on-black in dark mode — every form control must
//     carry an explicit dark-mode text + background so it is readable in both
//     themes. jsdom has no CSS cascade, so class presence is the pin.
//  4. The explicit H/V scale mode was undiscoverable and fit mode's growth in
//     width was invisible before export — a live page-size + scale readout must
//     sit by the scale-mode fieldset and update when the mode / scales change.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext, type ShellContextValue } from '../../ShellContext'
import type { CrossSectionResponse } from '../../../api/clients/section'
import type { SheetPayload } from '../../../sheet/sheetPayload'
import { SheetPreviewDialog } from './SheetPreviewDialog'

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return { ...actual, setBaseUrl: vi.fn(), api: { section: { update: vi.fn().mockResolvedValue(null) } } }
})

vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

// The dialog's only geometry-changing dependency; hand it a fixed payload so the
// preview iframe never needs the network and the geometry is deterministic.
const stubPayload: SheetPayload = {
  language: 'en',
  section: { id: 's1', name: 'CS1', epsg: 31370, lengthM: 100, startX: 0, startY: 0, endX: 100, endY: 0, viewState: null },
  columns: [
    { investigationId: 'c1', kind: 'cpt', name: 'S6', code: 'S6', projectKey: 'P', colourIndex: 0, alongM: 0, collarElevationM: 5, totalDepthM: 20, cptType: 'CPTU', plot: null, detail: null },
    { investigationId: 'c2', kind: 'cpt', name: 'S5', code: 'S5', projectKey: 'P', colourIndex: 0, alongM: 100, collarElevationM: 4, totalDepthM: 18, cptType: 'CPTU', plot: null, detail: null },
  ],
  regions: [],
  units: [],
  levelMaxM: 5, levelMinM: -20,
  map: { basemapId: 'osm', points: [], legend: [] },
  settings: { fill: 'litho', scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 1, fields: [{ label: 'Project', value: '' }, { label: 'Profiel', value: '' }, { label: '', value: '' }, { label: '', value: '' }] },
}

vi.mock('./useSheetPayload', () => ({
  useSheetPayload: () => () => Promise.resolve(stubPayload),
}))

const section = {
  id: 's1', name: 'CS1', vertical_exaggeration: 5, view_state: null,
} as unknown as CrossSectionResponse

function ctx(): ShellContextValue {
  return {
    project: { id: 'proj', name: 'Kaai 1712' },
    toasts: { toast: vi.fn(), toasts: [] },
  } as unknown as ShellContextValue
}

function renderDialog(): void {
  render(
    <ShellContext.Provider value={ctx()}>
      <SheetPreviewDialog open onClose={vi.fn()} section={section} isGeotech={false} hasGeotechModel />
    </ShellContext.Provider>,
  )
}

beforeEach(() => {
  // jsdom has no ResizeObserver; the dialog's fit effect needs it.
  global.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
})
afterEach(cleanup)

function expectDark(el: Element): void {
  const cls = el.getAttribute('class') ?? ''
  expect(cls).toContain('dark:bg-neutral-800')
  expect(cls).toContain('dark:text-neutral-100')
}

describe('SheetPreviewDialog — dark-mode readability (owner finding 1)', () => {
  it('every free-text field control carries an explicit dark-mode text + background', async () => {
    renderDialog()
    for (const i of [0, 1, 2, 3]) expectDark(await screen.findByTestId(`sheet-field-${i}`))
  })

  it('the explicit H/V scale inputs carry the dark-mode text + background', async () => {
    renderDialog()
    // Reveal the number inputs by switching to explicit mode.
    const scaleRadios = document.querySelectorAll('input[name="sheet-scale"]')
    fireEvent.click(scaleRadios[1])
    expectDark(await screen.findByTestId('sheet-h-scale'))
    expectDark(await screen.findByTestId('sheet-v-scale'))
  })

  it('the radios and range sliders carry a dark-mode accent (else they render Chromium-light on the dark panel)', async () => {
    renderDialog()
    await screen.findByTestId('sheet-field-0')
    for (const el of [
      ...document.querySelectorAll('input[name="sheet-fill"]'),
      ...document.querySelectorAll('input[name="sheet-scale"]'),
      screen.getByTestId('sheet-vex'),
      screen.getByTestId('sheet-spacing'),
    ]) {
      expect(el.getAttribute('class') ?? '').toContain('dark:accent-blue-400')
    }
  })
})

describe('SheetPreviewDialog — live scale readout (owner finding 4)', () => {
  it('shows the resulting page size + H/V scales and updates when the mode / scales change', async () => {
    renderDialog()
    const readout = await screen.findByTestId('sheet-scale-readout')
    // Fit mode is A3 high.
    await waitFor(() => expect(readout.textContent ?? '').toContain('297'))
    // Switch to explicit and set coarse scales: the page grows and the readout follows.
    const scaleRadios = document.querySelectorAll('input[name="sheet-scale"]')
    fireEvent.click(scaleRadios[1])
    fireEvent.change(await screen.findByTestId('sheet-h-scale'), { target: { value: '1000' } })
    fireEvent.change(screen.getByTestId('sheet-v-scale'), { target: { value: '50' } })
    await waitFor(() => {
      const text = readout.textContent ?? ''
      expect(text).toContain('552') // 25 m range × (1000/50) mm·m⁻¹ + chrome
      expect(text).toContain('1:1000')
      expect(text).toContain('1:50')
    })
  })
})

describe('SheetPreviewDialog — the sheet opens filling the page', () => {
  // Owner 2026-09-11 on the first fit-to-width sheet: "a lot of white space on
  // the pdf report no? Can't we give a better page fit to start?" The section
  // carries 5x on screen; the stub profile (100 m long, 25 m deep) fills the
  // A3 page at 4.2x, so that is where the sheet must open.
  it("opens at the exaggeration that fills the page, not the screen's", async () => {
    renderDialog()
    const slider = (await screen.findByTestId('sheet-vex')) as HTMLInputElement
    await waitFor(() => expect(slider.value).toBe('4.2'))
    expect(Number(slider.max)).toBeGreaterThanOrEqual(50)
  })
})
