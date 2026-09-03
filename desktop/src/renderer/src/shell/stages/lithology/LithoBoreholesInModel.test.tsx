// Decision net for LithoBoreholesInModel (debt #65 — the exclude gesture).
//
// The rule, in the debt entry's / task's words: the Lithology inspector needs
// an in-UI gesture to NEWLY EXCLUDE a borehole from the litho build, mirroring
// the geological stage's "Boreholes in model" checkbox roster. Unchecking a
// borehole excludes it from the litho model; re-checking includes it again.
// Excluding is REVERSIBLE (docs/ux.md) so it fires immediately with no
// confirmation dialog.
//
// Claims pinned here:
//   BM1  Renders nothing when there are no boreholes.
//   BM2  Header shows the "Boreholes in model" title and an included/total
//        count; the per-borehole checkboxes are collapsed by default.
//   BM3  Expanding reveals one checkbox per borehole — an included borehole
//        is checked, an already-excluded borehole is unchecked.
//   BM4  The exclude gesture: unchecking an included borehole calls
//        onToggle(id, false).
//   BM5  Re-checking an excluded borehole calls onToggle(id, true).

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { t } from '../../../i18n/translate'
import LithoBoreholesInModel from './LithoBoreholesInModel'

afterEach(cleanup)

function bh(id: string, name: string): { id: string; name: string } {
  return { id, name }
}

describe('LithoBoreholesInModel (debt #65 — exclude gesture)', () => {
  // BM1: no boreholes → renders nothing (an empty roster reads as a permanent
  // feature rather than the exception it is).
  it('BM1 — renders nothing when there are no boreholes', () => {
    const { container } = render(
      <LithoBoreholesInModel boreholes={[]} excludedBoreholeIds={[]} onToggle={vi.fn()} t={t} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  // BM2: header + included/total count; the checkbox list is collapsed by default.
  it('BM2 — header shows the title and included/total count, list collapsed by default', () => {
    render(
      <LithoBoreholesInModel
        boreholes={[bh('bh-1', 'Borehole A'), bh('bh-2', 'Borehole B')]}
        excludedBoreholeIds={['bh-2']}
        onToggle={vi.fn()}
        t={t}
      />,
    )
    const section = screen.getByTestId('litho-boreholes-in-model')
    expect(section).toBeInTheDocument()
    // One of two boreholes excluded → 1 of 2 in the model.
    expect(section).toHaveTextContent('1/2')
    // Collapsed by default — no per-borehole checkboxes until the header is opened.
    expect(screen.queryByTestId('litho-borehole-in-model-bh-1')).not.toBeInTheDocument()
  })

  // BM3: expanding reveals a checkbox per borehole with the correct checked state.
  it('BM3 — expanded: an included borehole is checked, an excluded borehole is unchecked', () => {
    render(
      <LithoBoreholesInModel
        boreholes={[bh('bh-1', 'Borehole A'), bh('bh-2', 'Borehole B')]}
        excludedBoreholeIds={['bh-2']}
        onToggle={vi.fn()}
        t={t}
      />,
    )
    fireEvent.click(screen.getByTestId('litho-boreholes-in-model-toggle'))

    const included = screen.getByTestId('litho-borehole-in-model-bh-1') as HTMLInputElement
    const excluded = screen.getByTestId('litho-borehole-in-model-bh-2') as HTMLInputElement
    expect(included.checked).toBe(true)
    expect(excluded.checked).toBe(false)
  })

  // BM4: the exclude gesture — unchecking an included borehole excludes it.
  it('BM4 — unchecking an included borehole calls onToggle(id, false)', () => {
    const onToggle = vi.fn()
    render(
      <LithoBoreholesInModel
        boreholes={[bh('bh-1', 'Borehole A')]}
        excludedBoreholeIds={[]}
        onToggle={onToggle}
        t={t}
      />,
    )
    fireEvent.click(screen.getByTestId('litho-boreholes-in-model-toggle'))
    fireEvent.click(screen.getByTestId('litho-borehole-in-model-bh-1'))

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith('bh-1', false)
  })

  // BM5: re-checking an excluded borehole includes it again.
  it('BM5 — re-checking an excluded borehole calls onToggle(id, true)', () => {
    const onToggle = vi.fn()
    render(
      <LithoBoreholesInModel
        boreholes={[bh('bh-1', 'Borehole A')]}
        excludedBoreholeIds={['bh-1']}
        onToggle={onToggle}
        t={t}
      />,
    )
    fireEvent.click(screen.getByTestId('litho-boreholes-in-model-toggle'))
    fireEvent.click(screen.getByTestId('litho-borehole-in-model-bh-1'))

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith('bh-1', true)
  })
})
