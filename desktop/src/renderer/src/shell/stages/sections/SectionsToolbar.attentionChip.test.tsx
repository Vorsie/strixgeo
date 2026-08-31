// The pending chip, pressed on the real toolbar.
//
// Owner dogfeed 2026-08-25: *"now i get a one pending notification but i don't
// see any pending ties? Why don't we make that clickable so it highlights the
// tie?"*
//
// The unit contracts live next to their own modules (AttentionChip.test.tsx,
// useGeotechPendingTieReveal.test.tsx); this file pins that the toolbar wires
// them together — the press reaches the canvas, and every outcome reaches the
// engineer as words.
//
//   TC1  with a pending tie here the chip is a button
//   TC2  pressing it asks the canvas to reveal
//   TC3  an UNDRAWABLE tie surfaces the canvas's sentence as a toast
//   TC4  a REVEALED tie stays silent — the canvas already answered on screen
//   TC5  with the canvas gone the press says so rather than doing nothing
//   TC6  the chip is PASSIVE when the pending ties are all on other sections

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import SectionsToolbar from './SectionsToolbar'
import { sectionsRevealPendingTieCallback } from './pendingTieRevealBridge'
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

/** The dogfeed sentence, as the canvas would have composed it. */
const UNDRAWABLE_MESSAGE =
  'Pending tie: GEO-10/170-S4 18.29–18.52 m ↔ 1411-GEO-23/126-B6 13.90–18.05 m — ' +
  '1411-GEO-23/126-B6 is not drawn here: it was removed from this project view.'

function makeCtx(toast: ShellContextValue['toasts']['toast']): ShellContextValue {
  const base = makeShellCtx('geotechnical')
  return {
    ...base,
    geoModel: { ...base.geoModel, activeLithoModel: makeLithoModel() },
    toasts: { ...base.toasts, toast },
  }
}

/** Answer the tie-status endpoint with one pending tie on the open section. */
function onePendingHere(): void {
  geotechTieStatus.mockResolvedValue({
    geotech_model_id: 'geotech-model-1',
    pending_tie_count: 1,
    accepted_tie_count: 0,
    flagged_tie_count: 0,
    pending_by_section: { 'sec-1': 1 },
  })
}

beforeEach(() => {
  onePendingHere()
  sectionsRevealPendingTieCallback.current = null
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  sectionsRevealPendingTieCallback.current = null
})

async function renderAndFindChip(
  toast: ShellContextValue['toasts']['toast'],
): Promise<HTMLElement> {
  render(
    <ShellContext.Provider value={makeCtx(toast)}>
      <SectionsToolbar />
    </ShellContext.Provider>,
  )
  return screen.findByTestId('geotech-pending-tie-chip')
}

describe('SectionsToolbar — the pending chip answers its own count', () => {
  it('TC1: with a tie pending HERE, the chip is pressable', async () => {
    const chip = await renderAndFindChip(vi.fn())
    expect(chip.tagName.toLowerCase()).toBe('button')
    expect(chip.getAttribute('title') ?? '').toMatch(/click/i)
  })

  it('TC2: pressing it asks the canvas to reveal', async () => {
    const reveal = vi.fn(() => ({ kind: 'revealed' as const, edgeId: 'e-1' }))
    sectionsRevealPendingTieCallback.current = reveal
    fireEvent.click(await renderAndFindChip(vi.fn()))
    expect(reveal).toHaveBeenCalledTimes(1)
  })

  it('TC3: an undrawable tie is spoken, naming both ends and the reason', async () => {
    // THE dogfeed case: the count is honest, the canvas is empty, and until now
    // the press had nothing to say about it.
    const toast = vi.fn()
    sectionsRevealPendingTieCallback.current = () => ({
      kind: 'undrawable',
      edgeId: 'e-1',
      message: UNDRAWABLE_MESSAGE,
    })
    fireEvent.click(await renderAndFindChip(toast))
    expect(toast).toHaveBeenCalledWith('warning', UNDRAWABLE_MESSAGE, expect.any(String))
    const spoken = toast.mock.calls[0][1] as string
    expect(spoken).toContain('GEO-10/170-S4')
    expect(spoken).toContain('1411-GEO-23/126-B6')
    expect(spoken).toMatch(/removed from this project view/i)
  })

  it('TC4: a revealed tie stays silent — the canvas already answered on screen', async () => {
    const toast = vi.fn()
    sectionsRevealPendingTieCallback.current = () => ({ kind: 'revealed', edgeId: 'e-1' })
    fireEvent.click(await renderAndFindChip(toast))
    expect(toast).not.toHaveBeenCalled()
  })

  it('TC5: with no canvas behind it the press says so, never nothing', async () => {
    const toast = vi.fn()
    // Bridge left null — no section canvas mounted.
    fireEvent.click(await renderAndFindChip(toast))
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][1]).toMatch(/open a cross-section/i)
  })

  it('TC6: with every pending tie on ANOTHER section the chip is passive again', async () => {
    // The chip stays visible while the model is unfinished (owner ruling
    // 2026-08-15) and then reads "0 pending here". There is nothing on THIS
    // canvas to centre, so it must not offer to.
    geotechTieStatus.mockResolvedValue({
      geotech_model_id: 'geotech-model-1',
      pending_tie_count: 4,
      accepted_tie_count: 0,
      flagged_tie_count: 0,
      pending_by_section: { 'sec-2': 4 },
    })
    const chip = await renderAndFindChip(vi.fn())
    expect(chip.tagName.toLowerCase()).not.toBe('button')
    expect(chip.textContent).toContain('0 pending here')
  })
})
