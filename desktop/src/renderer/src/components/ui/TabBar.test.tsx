// Unit tests for the TabBar primitive (debt #115 sub-item 7).
//
// TB1 — renders all tabs as role="tab" elements.
// TB2 — aria-selected matches the activeId prop.
// TB3 — clicking a tab fires onActivate with its id.
// TB4 — Arrow-Right cycles activation forward.
// TB5 — Arrow-Left cycles activation backward (wraps).
// TB6 — Home jumps to the first tab.
// TB7 — End jumps to the last tab.
// TB8 — the container has role="tablist" with the ariaLabel.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TabBar from './TabBar'

const TABS = [
  { id: 'a', label: 'Alpha', testid: 'tab-a' },
  { id: 'b', label: 'Beta',  testid: 'tab-b' },
  { id: 'c', label: 'Gamma', testid: 'tab-c' },
]

afterEach(cleanup)

describe('TabBar primitive (debt #115 sub-item 7)', () => {
  it('TB1 — renders all tabs with role="tab"', () => {
    render(<TabBar tabs={TABS} activeId="a" onActivate={vi.fn()} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[0].textContent).toContain('Alpha')
    expect(tabs[1].textContent).toContain('Beta')
    expect(tabs[2].textContent).toContain('Gamma')
  })

  it('TB2 — aria-selected matches activeId', () => {
    render(<TabBar tabs={TABS} activeId="b" onActivate={vi.fn()} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0].getAttribute('aria-selected')).toBe('false')
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    expect(tabs[2].getAttribute('aria-selected')).toBe('false')
  })

  it('TB3 — clicking a tab fires onActivate with that id', () => {
    const onActivate = vi.fn()
    render(<TabBar tabs={TABS} activeId="a" onActivate={onActivate} />)
    fireEvent.click(screen.getByTestId('tab-b'))
    expect(onActivate).toHaveBeenCalledOnce()
    expect(onActivate).toHaveBeenCalledWith('b')
  })

  it('TB4 — Arrow-Right advances to the next tab', () => {
    const onActivate = vi.fn()
    render(<TabBar tabs={TABS} activeId="a" onActivate={onActivate} />)
    const firstTab = screen.getByTestId('tab-a')
    fireEvent.keyDown(firstTab, { key: 'ArrowRight' })
    expect(onActivate).toHaveBeenCalledWith('b')
  })

  it('TB4b — Arrow-Right wraps from last to first', () => {
    const onActivate = vi.fn()
    render(<TabBar tabs={TABS} activeId="c" onActivate={onActivate} />)
    const lastTab = screen.getByTestId('tab-c')
    fireEvent.keyDown(lastTab, { key: 'ArrowRight' })
    expect(onActivate).toHaveBeenCalledWith('a')
  })

  it('TB5 — Arrow-Left retreats to the previous tab', () => {
    const onActivate = vi.fn()
    render(<TabBar tabs={TABS} activeId="b" onActivate={onActivate} />)
    const midTab = screen.getByTestId('tab-b')
    fireEvent.keyDown(midTab, { key: 'ArrowLeft' })
    expect(onActivate).toHaveBeenCalledWith('a')
  })

  it('TB5b — Arrow-Left wraps from first to last', () => {
    const onActivate = vi.fn()
    render(<TabBar tabs={TABS} activeId="a" onActivate={onActivate} />)
    const firstTab = screen.getByTestId('tab-a')
    fireEvent.keyDown(firstTab, { key: 'ArrowLeft' })
    expect(onActivate).toHaveBeenCalledWith('c')
  })

  it('TB6 — Home key jumps to the first tab', () => {
    const onActivate = vi.fn()
    render(<TabBar tabs={TABS} activeId="c" onActivate={onActivate} />)
    const lastTab = screen.getByTestId('tab-c')
    fireEvent.keyDown(lastTab, { key: 'Home' })
    expect(onActivate).toHaveBeenCalledWith('a')
  })

  it('TB7 — End key jumps to the last tab', () => {
    const onActivate = vi.fn()
    render(<TabBar tabs={TABS} activeId="a" onActivate={onActivate} />)
    const firstTab = screen.getByTestId('tab-a')
    fireEvent.keyDown(firstTab, { key: 'End' })
    expect(onActivate).toHaveBeenCalledWith('c')
  })

  it('TB8 — container has role="tablist" with the ariaLabel', () => {
    render(
      <TabBar tabs={TABS} activeId="a" onActivate={vi.fn()} ariaLabel="My tabs" />,
    )
    const list = screen.getByRole('tablist', { name: 'My tabs' })
    expect(list).toBeInTheDocument()
  })

  it('TB9 — active tab has tabIndex=0; others have tabIndex=-1', () => {
    render(<TabBar tabs={TABS} activeId="b" onActivate={vi.fn()} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0].tabIndex).toBe(-1)
    expect(tabs[1].tabIndex).toBe(0)
    expect(tabs[2].tabIndex).toBe(-1)
  })
})
