// Wiring pin for the fill-region → Parameters jump authority (audit F10,
// 2026-08-27), in the established source-pin style (the B6 precedent —
// mounting the full SectionsCanvas under jsdom is prohibitive).
//
// The overlays report a region's formation LABEL beside a layers-resolved
// bodyId — mixed authorities in one call. The canvas's two jump handlers are
// the single point every sender routes through (PartitionFillOverlay,
// ModelFillOverlay, ContactsLayer, GeotechBandEditOverlay), so the authority
// is applied THERE: when a body resolved, the reported unit is the body's
// HOME formation from the same roster the Parameters pane groups by
// (``bodyHomeUnitId`` — behaviour pinned as PB13/PB14); with no body the
// label stands.
//
// JW1 — both jump handlers derive the unit through ``bodyHomeUnitId``.
// JW2 — the roster feeding them is per-axis and keyed on the axis's
//       body-recompute nonce (F9), so a jump after a recompute reads fresh
//       home formations.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CANVAS_SRC = readFileSync(join(__dirname, 'SectionsCanvas.tsx'), 'utf-8')

describe('SectionsCanvas — the unit-statistics jump authority (audit F10)', () => {
  it('JW1 — both jump handlers derive the reported unit via bodyHomeUnitId', () => {
    const geotechHandler = CANVAS_SRC.slice(
      CANVAS_SRC.indexOf('handleShowGeotechUnitStatistics = useCallback'),
      CANVAS_SRC.indexOf('handleShowLithoUnitStatistics = useCallback'),
    )
    const lithoHandlerStart = CANVAS_SRC.indexOf('handleShowLithoUnitStatistics = useCallback')
    const lithoHandler = CANVAS_SRC.slice(lithoHandlerStart, lithoHandlerStart + 1200)
    expect(geotechHandler).toMatch(/bodyHomeUnitId\(/)
    expect(lithoHandler).toMatch(/bodyHomeUnitId\(/)
  })

  it('JW2 — the per-axis rosters ride the recompute nonces', () => {
    expect(CANVAS_SRC).toMatch(/useModelBodies\([\s\S]{0,200}?bodyRecomputeGeotechNonce/)
    expect(CANVAS_SRC).toMatch(/useModelBodies\([\s\S]{0,200}?bodyRecomputeLithoNonce/)
  })
})
