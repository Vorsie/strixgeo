// Behaviour tests for the in-app Select (listbox) primitive.
//
// It replaces the native <select> whose OS popup does not open in the packaged
// Electron window (owner #35). These pins are the primitive's contract: it
// drops a listbox on click, the arrow keys + Enter commit, Escape closes
// without changing, a click commits, and a disabled control does not open.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import Select, { type SelectOption } from './Select'

const OPTIONS: SelectOption[] = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana' },
  { value: 'c', label: 'Cherry' },
]

function renderSelect(overrides: Partial<React.ComponentProps<typeof Select>> = {}) {
  const onChange = vi.fn()
  render(
    <Select
      value="a"
      options={OPTIONS}
      onChange={onChange}
      ariaLabel="Fruit"
      testid="fruit"
      {...overrides}
    />,
  )
  return { onChange }
}

describe('Select', () => {
  it('S1 — closed by default: no listbox', () => {
    renderSelect()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('S2 — clicking the trigger drops the listbox with every option', () => {
    renderSelect()
    fireEvent.click(screen.getByTestId('fruit'))
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(screen.getAllByRole('option')).toHaveLength(3)
    // The current value is marked selected.
    const selected = screen.getByRole('option', { name: 'Apple' })
    expect(selected.getAttribute('aria-selected')).toBe('true')
  })

  it('S3 — ArrowDown then Enter commits the next option and closes', () => {
    const { onChange } = renderSelect()
    fireEvent.click(screen.getByTestId('fruit'))
    const listbox = screen.getByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    fireEvent.keyDown(listbox, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('S4 — clicking an option commits it', () => {
    const { onChange } = renderSelect()
    fireEvent.click(screen.getByTestId('fruit'))
    fireEvent.click(screen.getByRole('option', { name: 'Cherry' }))
    expect(onChange).toHaveBeenCalledWith('c')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('S5 — Escape closes without changing the value', () => {
    const { onChange } = renderSelect()
    fireEvent.click(screen.getByTestId('fruit'))
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('S6 — a disabled control does not open', () => {
    renderSelect({ disabled: true })
    fireEvent.click(screen.getByTestId('fruit'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('S7 — End jumps to the last option; Enter commits it', () => {
    const { onChange } = renderSelect()
    fireEvent.click(screen.getByTestId('fruit'))
    const listbox = screen.getByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'End' })
    fireEvent.keyDown(listbox, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('S8 — typeahead: a first letter jumps to the next matching option', () => {
    const { onChange } = renderSelect()
    fireEvent.click(screen.getByTestId('fruit'))
    const listbox = screen.getByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'c' })
    fireEvent.keyDown(listbox, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('S9 — aria wiring: haspopup listbox + expanded toggles', () => {
    renderSelect()
    const trigger = screen.getByTestId('fruit')
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('S10 — the trigger shows the selected option label', () => {
    renderSelect({ value: 'b' })
    expect(screen.getByTestId('fruit').textContent).toContain('Banana')
  })
})
