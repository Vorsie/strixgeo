import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ElevationEditor from './ElevationEditor'

// Behaviour-oriented tests for the Phase 3a inline elevation editor.
// We don't snapshot the markup — we verify the contract a parent
// component depends on: idle states render the right copy; entering
// edit mode and saving fires onSave with the parsed value; cancel and
// clear paths behave; range/format errors are caught client-side
// before round-tripping the API.

describe('ElevationEditor', () => {
  it('shows "Set elevation" when no value is present', () => {
    render(<ElevationEditor elevationM={null} zEpsg={null} onSave={vi.fn()} />)
    expect(screen.getByRole('button', { name: /set elevation/i })).toBeInTheDocument()
  })

  it('shows the formatted value when one is present', () => {
    render(<ElevationEditor elevationM={12.345} zEpsg={5710} onSave={vi.fn()} />)
    expect(screen.getByText(/Z = 12\.35 m TAW/)).toBeInTheDocument()
  })

  it('renders "m NAP" for the Dutch vertical datum (EPSG 5709)', () => {
    render(<ElevationEditor elevationM={5} zEpsg={5709} onSave={vi.fn()} />)
    expect(screen.getByText(/Z = 5\.00 m NAP/)).toBeInTheDocument()
  })

  it('falls back to plain "m" for unknown vertical CRSes', () => {
    render(<ElevationEditor elevationM={5} zEpsg={9999} onSave={vi.fn()} />)
    expect(screen.getByText(/Z = 5\.00 m\b/)).toBeInTheDocument()
    expect(screen.queryByText(/TAW|NAP/)).not.toBeInTheDocument()
  })

  it('renders a provenance tag next to the Z value when source is set (debt #8)', () => {
    render(
      <ElevationEditor
        elevationM={12.34}
        zEpsg={5710}
        elevationSource="dov"
        onSave={vi.fn()}
      />,
    )
    expect(screen.getByText(/\(DOV\)/)).toBeInTheDocument()
  })

  it('does not render a provenance tag when source is absent or "none"', () => {
    const { rerender } = render(
      <ElevationEditor elevationM={12.34} zEpsg={5710} onSave={vi.fn()} />,
    )
    expect(screen.queryByText(/\(DOV\)|\(GEF\)|\(manual\)/)).not.toBeInTheDocument()

    rerender(
      <ElevationEditor
        elevationM={12.34}
        zEpsg={5710}
        elevationSource="none"
        onSave={vi.fn()}
      />,
    )
    expect(screen.queryByText(/\(DOV\)|\(GEF\)|\(manual\)/)).not.toBeInTheDocument()
  })

  it('renders the "manual" tag for user-entered values', () => {
    render(
      <ElevationEditor
        elevationM={8.0}
        zEpsg={5710}
        elevationSource="manual"
        onSave={vi.fn()}
      />,
    )
    expect(screen.getByText(/\(manual\)/)).toBeInTheDocument()
  })

  it('saves a parsed numeric value via Enter (defaulting to mTAW)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ElevationEditor elevationM={null} zEpsg={null} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: /set elevation/i }))
    const input = screen.getByPlaceholderText('m') as HTMLInputElement
    fireEvent.change(input, { target: { value: '8.25' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // No zEpsg on the row → picker opens at mTAW (5710), commit sends it.
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(8.25, 5710))
  })

  it('honours the user-picked datum when saving', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ElevationEditor elevationM={null} zEpsg={null} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: /set elevation/i }))
    const input = screen.getByPlaceholderText('m') as HTMLInputElement
    fireEvent.change(input, { target: { value: '4.0' } })
    // Switch the datum dropdown from mTAW (default) to NAP.
    const select = screen.getByTitle(/Vertical reference system/i) as HTMLSelectElement
    fireEvent.change(select, { target: { value: '5709' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(4.0, 5709))
  })

  it("opens the picker on the row's existing datum", () => {
    render(<ElevationEditor elevationM={5} zEpsg={5709} onSave={vi.fn()} />)
    fireEvent.click(screen.getByText(/Z = 5\.00 m NAP/))
    const select = screen.getByTitle(/Vertical reference system/i) as HTMLSelectElement
    expect(select.value).toBe('5709')
  })

  it('cancels via Escape without invoking onSave', () => {
    const onSave = vi.fn()
    render(<ElevationEditor elevationM={3.0} zEpsg={5710} onSave={onSave} />)

    // Idle button's accessible name is the value readout itself
    // ("Z = 3.00 m TAW") since the button has no aria-label and the
    // text content takes precedence over the title attribute.
    fireEvent.click(screen.getByText(/Z = 3\.00 m TAW/))
    const input = screen.getByPlaceholderText('m') as HTMLInputElement
    fireEvent.change(input, { target: { value: '99' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(/Z = 3\.00 m TAW/)).toBeInTheDocument()
  })

  it('clear button passes null to onSave for both elevation and zEpsg', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ElevationEditor elevationM={4.5} zEpsg={5710} onSave={onSave} />)

    fireEvent.click(screen.getByText(/Z = 4\.50 m TAW/))
    // The clear affordance is title-only ("Clear elevation — returns…").
    fireEvent.click(screen.getByTitle(/Clear elevation/))

    // Clearing nulls both columns — the backend keeps the pair consistent.
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null, null))
  })

  it('strips letters from input on change so they never reach the field', () => {
    const onSave = vi.fn()
    render(<ElevationEditor elevationM={null} zEpsg={null} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: /set elevation/i }))
    const input = screen.getByPlaceholderText('m') as HTMLInputElement
    fireEvent.change(input, { target: { value: '12abc.5xy' } })
    expect(input.value).toBe('12.5')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('accepts comma as decimal separator', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ElevationEditor elevationM={null} zEpsg={null} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: /set elevation/i }))
    const input = screen.getByPlaceholderText('m') as HTMLInputElement
    fireEvent.change(input, { target: { value: '8,25' } })
    // The filter preserves the comma exactly as typed; commit normalises.
    expect(input.value).toBe('8,25')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(8.25, 5710))
  })

  it('keeps only the first decimal separator when both are typed', () => {
    render(<ElevationEditor elevationM={null} zEpsg={null} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /set elevation/i }))
    const input = screen.getByPlaceholderText('m') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1.2,3.4' } })
    expect(input.value).toBe('1.234')
  })

  it('keeps the leading minus and discards interior minus signs', () => {
    render(<ElevationEditor elevationM={null} zEpsg={null} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /set elevation/i }))
    const input = screen.getByPlaceholderText('m') as HTMLInputElement
    fireEvent.change(input, { target: { value: '-1-2-3' } })
    expect(input.value).toBe('-123')
  })

  it('rejects out-of-range values without calling onSave', () => {
    const onSave = vi.fn()
    render(<ElevationEditor elevationM={null} zEpsg={null} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: /set elevation/i }))
    const input = screen.getByPlaceholderText('m') as HTMLInputElement
    fireEvent.change(input, { target: { value: '99999' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(/Out of range/)).toBeInTheDocument()
  })

  it('surfaces save errors and stays in edit mode', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('upstream 503'))
    render(<ElevationEditor elevationM={null} zEpsg={null} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: /set elevation/i }))
    const input = screen.getByPlaceholderText('m') as HTMLInputElement
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(await screen.findByText(/upstream 503/)).toBeInTheDocument()
    // Still in edit mode so the user can retry without losing their input.
    expect(screen.getByPlaceholderText('m')).toBeInTheDocument()
  })
})
