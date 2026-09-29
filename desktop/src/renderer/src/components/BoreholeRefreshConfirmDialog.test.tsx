// "These boreholes are already in the project: replace them with this file?"
//
// The CPT re-import rule applied to a DOV XML file: the replacement has no
// undo, so the engineer decides on the NUMBERS (stored vs file depth, stored vs
// file description layers) for every boring the file would overwrite, Cancel
// has the default focus, and the button names the action ("Replace boreholes").

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import BoreholeRefreshConfirmDialog from './BoreholeRefreshConfirmDialog'

const DIFFS = [
  {
    boreholeId: 'B1',
    name: 'GEO-25/110-B1',
    testId: 'X-B1',
    oldTotalDepthM: 30,
    newTotalDepthM: 35,
    oldNLithoLayers: 60,
    newNLithoLayers: 70,
    nErrors: 0,
    nWarnings: 0,
  },
  {
    boreholeId: 'B2',
    name: 'GEO-25/110-B2',
    testId: 'X-B2',
    oldTotalDepthM: null,
    newTotalDepthM: 29,
    oldNLithoLayers: 0,
    newNLithoLayers: 58,
    nErrors: 0,
    nWarnings: 0,
  },
]

describe('BoreholeRefreshConfirmDialog', () => {
  it('lists every boring it would replace with stored vs file numbers', () => {
    render(
      <BoreholeRefreshConfirmDialog
        open
        fileName="GEO-25-110.xml"
        diffs={DIFFS}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('GEO-25-110.xml')).toBeTruthy()
    const rows = screen.getAllByTestId('borehole-refresh-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('GEO-25/110-B1')
    expect(rows[0].textContent).toContain('30.00 m')
    expect(rows[0].textContent).toContain('35.00 m')
    expect(rows[0].textContent).toContain('60')
    expect(rows[0].textContent).toContain('70')
    expect(rows[1].textContent).toContain('—')
  })

  it('focuses Cancel, and the action button names the action', () => {
    render(
      <BoreholeRefreshConfirmDialog
        open
        fileName="f.xml"
        diffs={DIFFS}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(document.activeElement).toBe(screen.getByTestId('borehole-refresh-cancel'))
    expect(screen.getByTestId('borehole-refresh-confirm').textContent).toBe('Replace boreholes')
  })

  it('Replace confirms, Cancel cancels', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <BoreholeRefreshConfirmDialog
        open
        fileName="f.xml"
        diffs={DIFFS}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByTestId('borehole-refresh-confirm'))
    fireEvent.click(screen.getByTestId('borehole-refresh-cancel'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
