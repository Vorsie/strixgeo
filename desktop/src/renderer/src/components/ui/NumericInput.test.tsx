import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import NumericInput, {
  formatNumericForDisplay,
  tryParseNumeric,
} from './NumericInput'

describe('tryParseNumeric', () => {
  it('parses canonical decimal form', () => {
    expect(tryParseNumeric('0.3')).toBe(0.3)
    expect(tryParseNumeric('16')).toBe(16)
    expect(tryParseNumeric('0.675')).toBe(0.675)
  })

  it('parses comma-as-decimal form', () => {
    expect(tryParseNumeric('0,3')).toBe(0.3)
    expect(tryParseNumeric('0,675')).toBe(0.675)
  })

  it('parses trailing separator as the integer part', () => {
    // Mid-typing "0," should commit 0 so the slider tracks; the draft
    // string preserves the user's "0," for display.
    expect(tryParseNumeric('0,')).toBe(0)
    expect(tryParseNumeric('0.')).toBe(0)
  })

  it('rejects both separators in the same value', () => {
    expect(tryParseNumeric('1.2,3')).toBeNull()
    expect(tryParseNumeric('1,234.56')).toBeNull()
  })

  it('rejects empty / whitespace / lonely separators', () => {
    expect(tryParseNumeric('')).toBeNull()
    expect(tryParseNumeric('   ')).toBeNull()
    expect(tryParseNumeric(',')).toBeNull()
    expect(tryParseNumeric('.')).toBeNull()
  })

  it('rejects scientific notation, hex, sign prefixes', () => {
    expect(tryParseNumeric('1e3')).toBeNull()
    expect(tryParseNumeric('0x10')).toBeNull()
    expect(tryParseNumeric('+5')).toBeNull()
    // DEFAULT behaviour — a minus is refused unless the caller opts in.
    // SettingsDialog's 0..1 ratio depends on this staying the default.
    expect(tryParseNumeric('-5')).toBeNull()
  })

  it('rejects letters / symbols', () => {
    expect(tryParseNumeric('abc')).toBeNull()
    expect(tryParseNumeric('5m')).toBeNull()
    expect(tryParseNumeric('$5')).toBeNull()
    expect(tryParseNumeric('5%')).toBeNull()
  })
})

describe('tryParseNumeric — allowNegative', () => {
  // Owner ruling 2026-08-23: "waterdepth can be negative too, offshore for
  // example". A quantity measured downward from a surface goes negative
  // whenever the thing measured sits ABOVE that surface — water over a
  // seabed. Elevations below a datum are the same shape. So the primitive
  // has to be able to take a minus, opt-in, without loosening the default.
  it('parses a negative in both separator forms', () => {
    expect(tryParseNumeric('-5', { allowNegative: true })).toBe(-5)
    expect(tryParseNumeric('-3,45', { allowNegative: true })).toBe(-3.45)
    expect(tryParseNumeric('-3.45', { allowNegative: true })).toBe(-3.45)
    expect(tryParseNumeric('-0,675', { allowNegative: true })).toBe(-0.675)
  })

  it('still parses positives unchanged when negatives are allowed', () => {
    expect(tryParseNumeric('5', { allowNegative: true })).toBe(5)
    expect(tryParseNumeric('0,3', { allowNegative: true })).toBe(0.3)
  })

  it('treats a lone minus as not-yet-a-number (mid-typing)', () => {
    // Same contract as a lone separator: the draft keeps it on screen, the
    // parent value does not move until there is a number to move to.
    expect(tryParseNumeric('-', { allowNegative: true })).toBeNull()
    expect(tryParseNumeric('-.', { allowNegative: true })).toBeNull()
    expect(tryParseNumeric('-,', { allowNegative: true })).toBeNull()
  })

  it('accepts a minus ONLY as the leading character', () => {
    expect(tryParseNumeric('5-', { allowNegative: true })).toBeNull()
    expect(tryParseNumeric('--5', { allowNegative: true })).toBeNull()
    expect(tryParseNumeric('3-4', { allowNegative: true })).toBeNull()
  })

  it('does not accidentally re-admit the other rejects', () => {
    expect(tryParseNumeric('-1e3', { allowNegative: true })).toBeNull()
    expect(tryParseNumeric('+5', { allowNegative: true })).toBeNull()
    expect(tryParseNumeric('-1.2,3', { allowNegative: true })).toBeNull()
    expect(tryParseNumeric('-abc', { allowNegative: true })).toBeNull()
  })
})

describe('formatNumericForDisplay', () => {
  it('renders finite numbers (separator is locale-dependent, so just check the digits)', () => {
    expect(formatNumericForDisplay(0.3)).toMatch(/^0[.,]3$/)
    expect(formatNumericForDisplay(16)).toBe('16')
    expect(formatNumericForDisplay(0.675)).toMatch(/^0[.,]675$/)
  })

  it('renders nothing for NaN / Infinity', () => {
    expect(formatNumericForDisplay(NaN)).toBe('')
    expect(formatNumericForDisplay(Infinity)).toBe('')
    expect(formatNumericForDisplay(-Infinity)).toBe('')
  })

  it('renders negatives with a leading minus', () => {
    // Display has never been gated on sign — only INPUT was. Pinned so a
    // future formatting change cannot quietly drop the sign on an offshore
    // water table or a below-datum elevation.
    expect(formatNumericForDisplay(-3.45)).toMatch(/^-3[.,]45$/)
    expect(formatNumericForDisplay(-16)).toBe('-16')
  })
})

describe('<NumericInput>', () => {
  it('renders the committed value', () => {
    render(<NumericInput value={0.3} onChange={() => {}} aria-label="x" />)
    const input = screen.getByLabelText('x') as HTMLInputElement
    expect(input.value).toMatch(/^0[.,]3$/)
  })

  it('emits onChange when the user types a comma-decimal', () => {
    const onChange = vi.fn()
    render(<NumericInput value={0} onChange={onChange} aria-label="x" />)
    const input = screen.getByLabelText('x') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: '0,3' } })
    expect(onChange).toHaveBeenLastCalledWith(0.3)
  })

  it('emits onChange when the user types a period-decimal', () => {
    const onChange = vi.fn()
    render(<NumericInput value={0} onChange={onChange} aria-label="x" />)
    const input = screen.getByLabelText('x') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: '0.3' } })
    expect(onChange).toHaveBeenLastCalledWith(0.3)
  })

  it('holds the draft while value is invalid', () => {
    const onChange = vi.fn()
    render(<NumericInput value={0} onChange={onChange} aria-label="x" />)
    const input = screen.getByLabelText('x') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: 'abc' } })
    // The change handler updates the draft display but does not call
    // onChange with a non-parseable value.
    expect(onChange).not.toHaveBeenCalled()
    expect(input.value).toBe('abc')
  })

  it('blocks letters via keydown', () => {
    render(<NumericInput value={0} onChange={() => {}} aria-label="x" />)
    const input = screen.getByLabelText('x') as HTMLInputElement
    input.focus()
    const evt = fireEvent.keyDown(input, { key: 'a' })
    expect(evt).toBe(false) // false = preventDefault was called
  })

  it('allows digits via keydown', () => {
    render(<NumericInput value={0} onChange={() => {}} aria-label="x" />)
    const input = screen.getByLabelText('x') as HTMLInputElement
    input.focus()
    const evt = fireEvent.keyDown(input, { key: '5' })
    expect(evt).toBe(true) // true = not prevented
  })

  it('allows the first separator and blocks a second', () => {
    const onChange = vi.fn()
    render(<NumericInput value={0} onChange={onChange} aria-label="x" />)
    const input = screen.getByLabelText('x') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: '0,3' } })
    expect(onChange).toHaveBeenLastCalledWith(0.3)
    // Now try to type another `.` — keydown should block. (We simulate
    // by checking the keydown event return.)
    const evt = fireEvent.keyDown(input, { key: '.' })
    expect(evt).toBe(false)
  })

  it('rejects mixed-separator paste via onChange', () => {
    const onChange = vi.fn()
    render(<NumericInput value={0} onChange={onChange} aria-label="x" />)
    const input = screen.getByLabelText('x') as HTMLInputElement
    input.focus()
    // Simulate a paste of US thousands-grouped text — keydown filter
    // doesn't see this, but the parser rejects it so onChange stays
    // uncalled with NaN.
    fireEvent.change(input, { target: { value: '1,234.56' } })
    expect(onChange).not.toHaveBeenCalled()
    // The draft still displays what was pasted so the user can fix it.
    expect(input.value).toBe('1,234.56')
  })

  it('re-formats canonically on blur (controlled parent updates value)', () => {
    // The component shows the user's exact draft while focused; on
    // blur the parent's controlled value drives display. So this test
    // wires a tiny controlled wrapper so the value prop tracks the
    // last onChange — matching real-app usage.
    function Wrapper(): JSX.Element {
      const [v, setV] = useState(0)
      return <NumericInput value={v} onChange={setV} aria-label="x" />
    }
    render(<Wrapper />)
    const input = screen.getByLabelText('x') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '0,300' } })
    expect(input.value).toBe('0,300')
    fireEvent.blur(input)
    // After blur, display derives from the committed value (0.3) and
    // re-formats without trailing zeros, using the OS locale separator.
    expect(input.value).toMatch(/^0[.,]3$/)
  })

  it('syncs to an external value change when not focused', () => {
    const { rerender } = render(
      <NumericInput value={0.3} onChange={() => {}} aria-label="x" />,
    )
    const input = screen.getByLabelText('x') as HTMLInputElement
    expect(input.value).toMatch(/^0[.,]3$/)
    rerender(<NumericInput value={0.5} onChange={() => {}} aria-label="x" />)
    expect(input.value).toMatch(/^0[.,]5$/)
  })

  it('preserves draft across an external value change while focused', () => {
    const { rerender } = render(
      <NumericInput value={0.3} onChange={() => {}} aria-label="x" />,
    )
    const input = screen.getByLabelText('x') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: '0,' } })
    expect(input.value).toBe('0,')
    // A slider drag (or any external source) bumps value mid-typing.
    rerender(<NumericInput value={0.5} onChange={() => {}} aria-label="x" />)
    // The user's draft survives — focused edit wins over the external
    // value change.
    expect(input.value).toBe('0,')
  })
})

describe('<NumericInput allowNegative>', () => {
  it('blocks the minus key by DEFAULT', () => {
    render(<NumericInput value={0} onChange={() => {}} aria-label="x" />)
    const input = screen.getByLabelText('x') as HTMLInputElement
    input.focus()
    expect(fireEvent.keyDown(input, { key: '-' })).toBe(false)
  })

  it('allows a leading minus when opted in', () => {
    render(
      <NumericInput value={0} onChange={() => {}} allowNegative aria-label="x" />,
    )
    const input = screen.getByLabelText('x') as HTMLInputElement
    input.focus()
    expect(fireEvent.keyDown(input, { key: '-' })).toBe(true)
  })

  it('emits a negative number the user types', () => {
    const onChange = vi.fn()
    render(
      <NumericInput value={0} onChange={onChange} allowNegative aria-label="x" />,
    )
    const input = screen.getByLabelText('x') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: '-3,45' } })
    expect(onChange).toHaveBeenLastCalledWith(-3.45)
  })

  it('holds a lone minus as a draft without emitting', () => {
    const onChange = vi.fn()
    render(
      <NumericInput value={0} onChange={onChange} allowNegative aria-label="x" />,
    )
    const input = screen.getByLabelText('x') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: '-' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(input.value).toBe('-')
  })

  it('blocks a SECOND minus', () => {
    // Mirrors the decimal-separator rule exactly: the keydown filter stops a
    // second one, and POSITION is left to the parser rather than being
    // re-derived from the caret. A misplaced minus ("3-4") can therefore be
    // typed but never commits — the same contract a mixed-separator paste
    // already has.
    render(
      <NumericInput value={0} onChange={() => {}} allowNegative aria-label="x" />,
    )
    const input = screen.getByLabelText('x') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: '-3' } })
    expect(fireEvent.keyDown(input, { key: '-' })).toBe(false)
  })

  it('never commits a misplaced minus', () => {
    const onChange = vi.fn()
    render(
      <NumericInput value={0} onChange={onChange} allowNegative aria-label="x" />,
    )
    const input = screen.getByLabelText('x') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: '3-4' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(input.value).toBe('3-4')
  })

  it('round-trips a negative through blur re-formatting', () => {
    function Wrapper(): JSX.Element {
      const [v, setV] = useState(0)
      return <NumericInput value={v} onChange={setV} allowNegative aria-label="x" />
    }
    render(<Wrapper />)
    const input = screen.getByLabelText('x') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '-3,450' } })
    expect(input.value).toBe('-3,450')
    fireEvent.blur(input)
    expect(input.value).toMatch(/^-3[.,]45$/)
  })
})
