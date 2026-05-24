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
    expect(tryParseNumeric('-5')).toBeNull()
  })

  it('rejects letters / symbols', () => {
    expect(tryParseNumeric('abc')).toBeNull()
    expect(tryParseNumeric('5m')).toBeNull()
    expect(tryParseNumeric('$5')).toBeNull()
    expect(tryParseNumeric('5%')).toBeNull()
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
