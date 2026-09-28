/**
 * What the Build pre-flight dialog has to say and do (owner ruling 2026-08-26).
 *
 * BD1  it names every test that has no packing bands yet
 * BD2  each name is one click to that test
 * BD3  a section that would drop out of the build is named, by name
 * BD4  a section that survives is not mentioned — a warning that fires when
 *      nothing is wrong trains people to click past the one that matters
 * BD5  the DEFAULT action holds focus on open: this dialog destroys nothing, so
 *      the Cancel-default rule (docs/ux.md, irreversible actions) does not apply
 * BD6  all three buttons do what they say
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import GeotechBuildPreflightDialog from './GeotechBuildPreflightDialog'
import type { UnbandedTest } from '../../../utils/geotechBuildPreflight'

const B12: UnbandedTest = {
  investigationId: 'inv-b12',
  name: 'B12',
  sectionIds: ['cs1', 'tie4'],
  revealSectionId: 'cs1',
  droppedSections: [{ sectionId: 'tie4', sectionName: 'Tie-section 4' }],
}

const S7: UnbandedTest = {
  investigationId: 'inv-s7',
  name: 'GEO-23/126-S7',
  sectionIds: ['cs1'],
  revealSectionId: 'cs1',
  droppedSections: [],
}

function renderDialog(overrides: Partial<Parameters<typeof GeotechBuildPreflightDialog>[0]> = {}) {
  const props = {
    open: true,
    tests: [B12, S7],
    onVisitTest: vi.fn(),
    onSubdivideAndBuild: vi.fn(),
    onBuildWithout: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  render(<GeotechBuildPreflightDialog {...props} />)
  return props
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GeotechBuildPreflightDialog', () => {
  it('BD1 — it says how many tests have no packing bands, and names them', () => {
    renderDialog()
    expect(screen.getByTestId('geotech-build-preflight-title').textContent).toContain('2 tests')
    expect(screen.getByTestId('geotech-build-preflight-title').textContent).toContain(
      'no packing bands yet',
    )
    expect(screen.getByTestId('geotech-preflight-visit-inv-b12').textContent).toContain('B12')
    expect(screen.getByTestId('geotech-preflight-visit-inv-s7').textContent).toContain(
      'GEO-23/126-S7',
    )
  })

  it('BD2 — clicking a name takes the engineer to that test', () => {
    const props = renderDialog()
    const name = screen.getByTestId('geotech-preflight-visit-inv-b12')
    // A real button, so Enter and Space come free with the click.
    expect(name.tagName).toBe('BUTTON')
    fireEvent.click(name)
    expect(props.onVisitTest).toHaveBeenCalledTimes(1)
    expect(props.onVisitTest).toHaveBeenCalledWith(B12)
  })

  it('BD3 — a section that leaves the build is named, and so is what happens to its space', () => {
    renderDialog()
    const line = screen.getByTestId('geotech-preflight-drop-inv-b12').textContent ?? ''
    expect(line).toContain('Building without B12 removes Tie-section 4 from the build')
    expect(line).toContain('its space fills from the neighbouring sections')
  })

  it('BD4 — a test that drops no section says nothing about sections', () => {
    renderDialog()
    expect(screen.queryByTestId('geotech-preflight-drop-inv-s7')).toBeNull()
  })

  it('BD5 — the default action holds focus: nothing here is destructive', () => {
    renderDialog()
    expect(document.activeElement).toBe(screen.getByTestId('geotech-preflight-subdivide'))
  })

  it('BD6 — each button fires its own action', () => {
    const props = renderDialog()
    fireEvent.click(screen.getByTestId('geotech-preflight-subdivide'))
    expect(props.onSubdivideAndBuild).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('geotech-preflight-build-without'))
    expect(props.onBuildWithout).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('geotech-preflight-cancel'))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('BD7 — one test reads as one test, not "1 tests"', () => {
    renderDialog({ tests: [B12] })
    expect(screen.getByTestId('geotech-build-preflight-title').textContent).toContain(
      'This test has no packing bands yet',
    )
  })

  it('BD9 — with many unbanded tests the list scrolls inside the card instead of growing past the window', () => {
    // Owner 2026-09-28 on testproject_dev, Build geotech model with most tests
    // still unsubdivided: "the screen is too big, it isn't even scrollable
    // this should never happen". The card is capped to the viewport and the
    // test list is the part that scrolls; the buttons stay reachable.
    const many: UnbandedTest[] = Array.from({ length: 40 }, (_, i) => ({
      ...B12,
      investigationId: `inv-${i}`,
      name: `GEO-08/118-S${i}`,
    }))
    renderDialog({ tests: many })
    const list = screen.getByRole('list')
    expect(list.className).toMatch(/overflow-y-auto/)
    expect(list.className).toMatch(/max-h-/)
    const card = screen.getByTestId('geotech-build-preflight-dialog')
    expect(card.className).toMatch(/max-h-\[9\dvh\]/)
    expect(screen.getByRole('button', { name: /Build without|Bouwen zonder/ })).toBeTruthy()
  })

  it('BD8 — closed renders nothing at all', () => {
    renderDialog({ open: false })
    expect(screen.queryByTestId('geotech-build-preflight-dialog')).toBeNull()
  })
})
