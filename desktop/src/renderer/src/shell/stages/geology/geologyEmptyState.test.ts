import { describe, expect, it } from 'vitest'

import { t } from '../../../i18n/translate'
import { geologyEmptyState } from './geologyEmptyState'

// Debt #33 — the CPT-only project must never dead-end at the disabled
// "Fill from boreholes" button. These lock the three-case decision.

describe('geologyEmptyState', () => {
  it('prompts to Build when formations exist (no CTA)', () => {
    const s = geologyEmptyState(t, true, true)
    expect(s.guidance).toMatch(/build/i)
    expect(s.showAddFormation).toBe(false)
  })

  it('still prompts to Build when formations exist even with no boreholes', () => {
    const s = geologyEmptyState(t, true, false)
    expect(s.guidance).toMatch(/build/i)
    expect(s.showAddFormation).toBe(false)
  })

  it('offers Fill + manual when boreholes exist but no formations', () => {
    const s = geologyEmptyState(t, false, true)
    expect(s.guidance).toMatch(/Fill from boreholes/i)
    expect(s.guidance).toMatch(/manually/i)
    expect(s.showAddFormation).toBe(true)
  })

  it('does NOT point at Fill when there are no boreholes (debt #33 core)', () => {
    const s = geologyEmptyState(t, false, false)
    // The dead-end case: Fill is disabled, so the copy must NOT send
    // the user there — manual add is the only path and the CTA shows.
    expect(s.guidance).not.toMatch(/Fill from boreholes/i)
    expect(s.guidance).toMatch(/no boreholes/i)
    expect(s.guidance).toMatch(/manually/i)
    expect(s.showAddFormation).toBe(true)
  })
})
