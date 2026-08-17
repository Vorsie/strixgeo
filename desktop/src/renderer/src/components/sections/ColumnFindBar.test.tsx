/**
 * The Ctrl+F column-find bar — the interaction half of `columnFind.ts`.
 *
 * Owner, 2026-08-17: *"i can go easily to a column header like s8"*. The
 * common path is typing alone: the first match jumps as the query narrows, so
 * ``s8`` centres S8 without an Enter. Enter cycles when several match.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ColumnFindBar from './ColumnFindBar'
import { useColumnFindHotkey } from './useColumnFindHotkey'

const COLUMNS = [
  { id: 'a', name: 'GEO-10/170-S8', along: 120, nudgedX: 300 },
  { id: 'b', name: '1411-GEO-23/126-B3', along: 60, nudgedX: 180 },
  { id: 'c', name: 'GEO-23/125-S10', along: 200, nudgedX: 450 },
  { id: 'd', name: 'GEO-23/125-S11', along: 240, nudgedX: 520 },
]

function setup() {
  const onJump = vi.fn()
  const onClose = vi.fn()
  render(<ColumnFindBar columns={COLUMNS} onJump={onJump} onClose={onClose} />)
  return { onJump, onClose, input: screen.getByLabelText('Column name') }
}

describe('ColumnFindBar', () => {
  it('FB1: typing s8 jumps to the S8 column without an Enter', () => {
    const { onJump, input } = setup()
    fireEvent.change(input, { target: { value: 's8' } })
    expect(onJump).toHaveBeenCalledTimes(1)
    expect(onJump.mock.calls[0][0].name).toBe('GEO-10/170-S8')
  })

  it('FB2: Enter cycles the matches left-to-right and wraps', () => {
    const { onJump, input } = setup()
    fireEvent.change(input, { target: { value: 's1' } })
    // First match (S10, leftmost) jumped on type; Enter goes to S11, the
    // next Enter wraps back to S10.
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    const names = onJump.mock.calls.map(c => c[0].name)
    expect(names).toEqual(['GEO-23/125-S10', 'GEO-23/125-S11', 'GEO-23/125-S10'])
  })

  it('FB3: the match counter tells the engineer where he is', () => {
    const { input } = setup()
    fireEvent.change(input, { target: { value: 's1' } })
    expect(screen.getByText('1/2')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  it('FB4: no hit says 0 found and never jumps', () => {
    const { onJump, input } = setup()
    fireEvent.change(input, { target: { value: 'xyz' } })
    expect(screen.getByText('0 found')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onJump).not.toHaveBeenCalled()
  })

  it('FB5: Escape closes without leaking to the section shortcuts', () => {
    const { onClose, input } = setup()
    // A listener standing in for the section editor's own Escape handling —
    // the bar must stop the event before it dismisses an armed gesture.
    const leaked = vi.fn()
    document.addEventListener('keydown', leaked)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(leaked).not.toHaveBeenCalled()
    document.removeEventListener('keydown', leaked)
  })

  it('FB6: the input owns the keyboard on open', () => {
    const { input } = setup()
    expect(document.activeElement).toBe(input)
  })
})

describe('useColumnFindHotkey', () => {
  function Harness({ onOpen }: { onOpen: () => void }) {
    useColumnFindHotkey(onOpen)
    return null
  }

  it('FH1: Ctrl+F opens; bare F stays the geotech-fill toggle', () => {
    const onOpen = vi.fn()
    render(<Harness onOpen={onOpen} />)
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true })
    expect(onOpen).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'f' })
    fireEvent.keyDown(document, { key: 'f', altKey: true })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('FH2: Ctrl+F typed inside a text field is left alone', () => {
    const onOpen = vi.fn()
    render(<Harness onOpen={onOpen} />)
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()
    fireEvent.keyDown(field, { key: 'f', ctrlKey: true })
    expect(onOpen).not.toHaveBeenCalled()
    field.remove()
  })
})
