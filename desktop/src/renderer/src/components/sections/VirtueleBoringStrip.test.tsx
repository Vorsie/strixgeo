/**
 * The Virtuele Boring depth field — locale tolerance and the empty state.
 *
 * Owner ruling 2026-08-23: *"can't we make the decimal seperator take . and
 * , because we don't know what users will input"*. This field was the one
 * free-text numeric input in the renderer still on ``<input type="number">``,
 * whose value-sanitisation drops anything the browser locale does not
 * recognise — so a Belgian typing ``12,5`` handed the commit an EMPTY string
 * and silently reset the overlay to "full column".
 *
 * The field keeps its own string draft rather than adopting ``NumericInput``,
 * because empty is a MEANINGFUL value here ("full DOV column", maxDepthM
 * null) and the primitive's contract is ``value: number``. It shares the
 * primitive's PARSER instead, so what counts as a number stays defined in one
 * place.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import VirtueleBoringStrip from './VirtueleBoringStrip'

vi.mock('../../hooks/useVirtueleBoringCatalog', () => ({
  useVirtueleBoringCatalog: () => ({ catalog: null, failed: false, status: null }),
}))

/** Render with the picker already expanded (a non-null model opens it). */
function renderStrip(maxDepthM: number | null = 30) {
  const onChangePicker = vi.fn()
  render(
    <VirtueleBoringStrip
      modelA="g3dv3_F"
      modelB={null}
      maxDepthM={maxDepthM}
      showOnSection
      onChangePicker={onChangePicker}
      onChangeShowOnSection={() => {}}
    />,
  )
  const input = screen.getByTitle(/Show layers down to/i) as HTMLInputElement
  return { input, onChangePicker }
}

describe('VirtueleBoringStrip — depth field', () => {
  it('VB-D1 commits a comma-decimal depth', () => {
    const { input, onChangePicker } = renderStrip()
    fireEvent.change(input, { target: { value: '12,5' } })
    fireEvent.blur(input)
    expect(onChangePicker).toHaveBeenCalledWith(
      expect.objectContaining({ maxDepthM: 12.5 }),
    )
  })

  it('VB-D2 commits a period-decimal depth', () => {
    const { input, onChangePicker } = renderStrip()
    fireEvent.change(input, { target: { value: '12.5' } })
    fireEvent.blur(input)
    expect(onChangePicker).toHaveBeenCalledWith(
      expect.objectContaining({ maxDepthM: 12.5 }),
    )
  })

  it('VB-D3 keeps empty meaning "full column"', () => {
    const { input, onChangePicker } = renderStrip()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onChangePicker).toHaveBeenCalledWith(
      expect.objectContaining({ maxDepthM: null }),
    )
  })

  it('VB-D4 refuses garbage and restores the committed value', () => {
    const { input, onChangePicker } = renderStrip(30)
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.blur(input)
    expect(onChangePicker).not.toHaveBeenCalled()
    expect(input.value).toBe('30')
  })

  it('VB-D5 clamps above the maximum instead of refusing', () => {
    const { input, onChangePicker } = renderStrip()
    fireEvent.change(input, { target: { value: '5000' } })
    fireEvent.blur(input)
    expect(onChangePicker).toHaveBeenCalledWith(
      expect.objectContaining({ maxDepthM: 1000 }),
    )
  })

  it('VB-D6 commits on Enter as well as blur', () => {
    const { input, onChangePicker } = renderStrip()
    fireEvent.change(input, { target: { value: '7,5' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChangePicker).toHaveBeenCalledWith(
      expect.objectContaining({ maxDepthM: 7.5 }),
    )
  })

  it('VB-D7 does not accept a negative depth (below its own surface only)', () => {
    // Depth here is measured DOWN from each investigation's surface and the
    // overlay has no meaning above it, so this field stays non-negative —
    // unlike the water table, which offshore genuinely goes negative.
    const { input, onChangePicker } = renderStrip(30)
    fireEvent.change(input, { target: { value: '-5' } })
    fireEvent.blur(input)
    expect(onChangePicker).not.toHaveBeenCalled()
  })
})
