// The shared section-name editor, in the owner's words (dogfeed 2026-09-22):
//   "it changes back to English when I click it" → the field opens with the
//   name the engineer sees, never the stored English default.
// Plus the rules every rename site shares: unchanged saves nothing, a new name
// saves once, Escape drops the edit, blank keeps the old name, and without a
// rename handler the name is not editable at all.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SectionNameInput from './SectionNameInput'
import { useSectionNameEditor } from './useSectionNameEditor'

function Harness({
  section,
  displayName,
  onRename,
}: {
  section: { id: string; name: string }
  displayName: string
  onRename: ((name: string) => void) | undefined
}): JSX.Element {
  const editor = useSectionNameEditor(section, displayName, onRename)
  return editor.editing ? (
    <SectionNameInput editor={editor} className="" ariaLabel="name" testId="name-input" />
  ) : (
    <button type="button" onClick={editor.start} data-testid="name-label">
      {displayName}
    </button>
  )
}

const DEFAULT = { id: 'sec-1', name: 'Cross-section 1' }

afterEach(cleanup)

describe('useSectionNameEditor', () => {
  it('E1 — the field opens with the name I see, not the stored English default', () => {
    render(<Harness section={DEFAULT} displayName="Dwarsprofiel 1" onRename={vi.fn()} />)
    fireEvent.click(screen.getByTestId('name-label'))
    expect((screen.getByTestId('name-input') as HTMLInputElement).value).toBe('Dwarsprofiel 1')
  })

  it('E2 — leaving the name as it is saves nothing, so the default keeps translating', () => {
    const onRename = vi.fn()
    render(<Harness section={DEFAULT} displayName="Dwarsprofiel 1" onRename={onRename} />)
    fireEvent.click(screen.getByTestId('name-label'))
    fireEvent.blur(screen.getByTestId('name-input'))
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByTestId('name-label')).toHaveTextContent('Dwarsprofiel 1')
  })

  it('E3 — a new name saves once, trimmed, on Enter', () => {
    const onRename = vi.fn()
    render(<Harness section={DEFAULT} displayName="Dwarsprofiel 1" onRename={onRename} />)
    fireEvent.click(screen.getByTestId('name-label'))
    const input = screen.getByTestId('name-input')
    fireEvent.change(input, { target: { value: '  Noordwand ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith('Noordwand')
  })

  it('E4 — Escape drops the edit and keeps the old name', () => {
    const onRename = vi.fn()
    render(<Harness section={DEFAULT} displayName="Dwarsprofiel 1" onRename={onRename} />)
    fireEvent.click(screen.getByTestId('name-label'))
    const input = screen.getByTestId('name-input')
    fireEvent.change(input, { target: { value: 'Noordwand' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByTestId('name-label')).toHaveTextContent('Dwarsprofiel 1')
  })

  it('E5 — a blank name saves nothing', () => {
    const onRename = vi.fn()
    render(<Harness section={DEFAULT} displayName="Dwarsprofiel 1" onRename={onRename} />)
    fireEvent.click(screen.getByTestId('name-label'))
    const input = screen.getByTestId('name-input')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(onRename).not.toHaveBeenCalled()
  })

  it('E6 — without a rename handler the name is not editable', () => {
    render(<Harness section={DEFAULT} displayName="Dwarsprofiel 1" onRename={undefined} />)
    fireEvent.click(screen.getByTestId('name-label'))
    expect(screen.queryByTestId('name-input')).toBeNull()
  })
})
