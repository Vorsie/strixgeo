/**
 * The borehole preview ghosts are OPT-IN (owner ruling 2026-08-07).
 *
 * History of this rule, in the owner's words:
 *  - 2026-08-06: "boreholes get subdivided when I click subdivide CPTs" —
 *    ghosts were gated on the tie work being done (pending 0, accepted > 0).
 *  - 2026-08-07: "somewhere the boreholes get subdivided before I click
 *    divide boreholes (it's on accept all ties) — I don't want". The gate's
 *    auto-appearance fired the instant accept-all drained the pending count,
 *    and the ghosts still read as real subdivision. So no tie state may EVER
 *    make previews appear uninvited: only the engineer's own "Show borehole
 *    preview" toggle in the geotech Display menu opens the gate.
 */

import { describe, expect, it } from 'vitest'

import { shouldShowBoreholePreview } from './boreholePreviewGate'

describe('shouldShowBoreholePreview — explicit toggle only', () => {
  it('BPG1 — toggle off: previews stay hidden even when every tie is judged', () => {
    // The exact state that used to auto-open the gate (pending 0, accepted
    // > 0, loaded) must show NOTHING while the toggle is off — this is the
    // 2026-08-07 complaint pinned.
    expect(shouldShowBoreholePreview(false)).toBe(false)
  })

  it('BPG2 — toggle on: the engineer asked, the previews render', () => {
    expect(shouldShowBoreholePreview(true)).toBe(true)
  })
})
