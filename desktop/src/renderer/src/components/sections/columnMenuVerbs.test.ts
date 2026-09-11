// The column verbs are built once for both menus that offer them.
//
// Since the owner's 2026-09-11 ruling a right-click on a test opens ONE menu:
// on the litho axis that is the unit menu (headed by these verbs), everywhere
// else it is ColumnContextMenu. Two hand-written lists would drift the moment
// one of them gained a verb, so both read this builder — these cases pin what
// it returns.

import { describe, expect, it, vi } from 'vitest'

import { buildColumnMenuVerbs } from './columnMenuVerbs'

/** The English catalogue is the default, so the raw key reads back as itself. */
const t = ((key: string) => key) as unknown as Parameters<typeof buildColumnMenuVerbs>[0]

describe('buildColumnMenuVerbs — the per-test verbs both menus share', () => {
  it('CMV1 — Focus is always offered, in first position', () => {
    const verbs = buildColumnMenuVerbs(t, { onFocus: vi.fn() })
    expect(verbs.map(v => v.key)).toEqual(['focusTest'])
  })

  it('CMV2 — a verb whose handler is absent is not built at all (no disabled rows)', () => {
    const verbs = buildColumnMenuVerbs(t, {
      onFocus: vi.fn(),
      onRemoveFromSection: vi.fn(),
    })
    expect(verbs.map(v => v.key)).toEqual(['focusTest', 'removeFromSection'])
  })

  it('CMV3 — the order is focus, detail, clear subdivision, remove', () => {
    const verbs = buildColumnMenuVerbs(t, {
      onFocus: vi.fn(),
      onOpenDetail: vi.fn(),
      onClearSubdivision: vi.fn(),
      onRemoveFromSection: vi.fn(),
    })
    expect(verbs.map(v => v.key)).toEqual([
      'focusTest',
      'openDetail',
      'clearSubdivision',
      'removeFromSection',
    ])
  })

  it('CMV4 — the two verbs that hide or discard are the danger ones', () => {
    const verbs = buildColumnMenuVerbs(t, {
      onFocus: vi.fn(),
      onOpenDetail: vi.fn(),
      onClearSubdivision: vi.fn(),
      onRemoveFromSection: vi.fn(),
    })
    expect(verbs.filter(v => v.danger).map(v => v.key)).toEqual([
      'clearSubdivision',
      'removeFromSection',
    ])
  })

  it('CMV5 — a verb runs the handler it was built from', () => {
    const onFocus = vi.fn()
    const [focus] = buildColumnMenuVerbs(t, { onFocus })
    focus.onClick()
    expect(onFocus).toHaveBeenCalledTimes(1)
  })
})
