// Vitest pins for ReportMetadataDialog (debt #52 slice 1).
//
// D1: defaultTitle seeds the title input on open.
// D2: editing the title + submitting forwards the trimmed value.
// D3: Cancel fires onCancel without calling onSubmit.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ReportMetadataDialog from './ReportMetadataDialog'

afterEach(() => {
  cleanup()
})

describe('ReportMetadataDialog', () => {
  it('D1 — defaultTitle seeds the title input on open', () => {
    render(
      <ReportMetadataDialog
        open
        defaultTitle="Cross-section: A-A'"
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    )
    const input = screen.getByTestId('report-metadata-title-input') as HTMLInputElement
    expect(input.value).toBe("Cross-section: A-A'")
  })

  it('D2 — editing the title + submitting forwards the trimmed value', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ReportMetadataDialog
        open
        defaultTitle="default"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )
    const titleInput = screen.getByTestId('report-metadata-title-input') as HTMLInputElement
    fireEvent.change(titleInput, { target: { value: '  My report  ' } })
    const authorInput = screen.getByTestId('report-metadata-author-input') as HTMLInputElement
    fireEvent.change(authorInput, { target: { value: 'Robin' } })
    fireEvent.click(screen.getByTestId('report-metadata-submit'))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'My report',
        author: 'Robin',
        notes: '',
      })
    })
  })

  it('D3 — Cancel fires onCancel and does not submit', () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(
      <ReportMetadataDialog
        open
        defaultTitle="default"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByTestId('report-metadata-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('D4 — empty trimmed title falls back to defaultTitle', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ReportMetadataDialog
        open
        defaultTitle="Cross-section: A"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )
    const titleInput = screen.getByTestId('report-metadata-title-input') as HTMLInputElement
    fireEvent.change(titleInput, { target: { value: '   ' } })
    fireEvent.click(screen.getByTestId('report-metadata-submit'))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Cross-section: A' }),
      )
    })
  })
})
