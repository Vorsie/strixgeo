/**
 * Unit tests for TieContextMenu (exported from TieSuggestionOverlay).
 *
 *   TC1  Accept item fires onAccept with the tie index.
 *   TC2  Reject item fires onReject with the tie index.
 *
 * TieContextMenu uses ContextMenu portal="fixed" — a plain DOM div, no SVG
 * wrapper needed.  Items are rendered directly in the jsdom document body, so
 * getByTestId finds them without any extra container.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TieContextMenu } from './TieSuggestionOverlay'

afterEach(() => cleanup())

describe('TieContextMenu', () => {
  it('TC1 — Accept item fires onAccept with the tie index', () => {
    const onAccept = vi.fn()
    render(
      <TieContextMenu
        x={10}
        y={10}
        index={2}
        onAccept={onAccept}
        onReject={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('tie-context-accept'))
    expect(onAccept).toHaveBeenCalledWith(2)
  })

  it('TC2 — Reject item fires onReject with the tie index', () => {
    const onReject = vi.fn()
    render(
      <TieContextMenu
        x={10}
        y={10}
        index={1}
        onAccept={vi.fn()}
        onReject={onReject}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('tie-context-reject'))
    expect(onReject).toHaveBeenCalledWith(1)
  })
})
