// Body Join / Ontkoppelen ON A COLUMN (owner ruling 2026-09-01 "Both").
//
// The owner wanted to start AND complete a Join from a borehole/CPT column, not
// only in the between-column fill. Two behaviours are pinned:
//
//   * ARMED left-click: with a Join armed, clicking a band resolves the band's
//     body through its own layer and reports the outcome up — the exact
//     equivalent of a fill-region click. The resolution SEMANTICS are pinned
//     red-first in joinPick.test.ts (JP1-JP7); these pin the overlay ROUTING.
//   * The right-click band menu gains "Voeg samen met…" (arm a Join) and
//     "Ontkoppelen" (lift a group) so a Join can START from a column too.
//
//   JCOL1  armed + left-click a DIFFERENT same-class band → onJoinPick(commit).
//   JCOL2  armed + left-click the ARMED body's own band → onJoinPick({kind:'same'}).
//   JCOL3  NOT armed → a band left-click fires nothing (byte-identical gating).
//   JCOL4  the band menu offers "Voeg samen met…" and arms with the band's body.
//   JCOL5  the band menu offers one "Ontkoppelen" per standing group.

import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LithoLayerResponse } from '../../api/client'
import GeotechBandEditOverlay from './GeotechBandEditOverlay'
import type { PlacedColumn } from './utils'

const levelToScreen = (level: number): number => (100 - level) * 10
const SURFACE_Y = levelToScreen(10)
const yAtDepth = (depthM: number): number => SURFACE_Y + depthM * 10

function layer(
  id: string,
  topM: number,
  baseM: number,
  bodyId: string | null,
  formationId = `f-${id}`,
): LithoLayerResponse {
  return {
    id,
    model_id: 'm-1',
    formation_id: formationId,
    borehole_id: null,
    cpt_id: 'cpt-1',
    depth_top_m: topM,
    depth_base_m: baseM,
    status: 'accepted',
    source: 'segmenter',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: bodyId,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as LithoLayerResponse
}

const LITHO_LAYERS = [layer('litho-a', 2, 8, null), layer('litho-b', 8, 14, null)]
// Two bands, distinct bodies, same packing class.
const GEOTECH_LAYERS = [layer('band-1', 2, 5, 'body-A'), layer('band-2', 5, 8, 'body-B')]
const BODY_ID_BY_LAYER = new Map<string, string | null>([
  ['band-1', 'body-A'],
  ['band-2', 'body-B'],
])
const SAME_CLASS = new Map<string, string>([
  ['band-1', 'ZAND, dicht'],
  ['band-2', 'ZAND, dicht'],
])

const COLUMN = {
  kind: 'cpt',
  trueX: 200,
  nudgedX: 200,
  width: 40,
  displaced: false,
  proj: { item: { id: 'cpt-1', name: 'CPT-1', elevation_m: 10 } },
} as unknown as PlacedColumn

afterEach(() => cleanup())

function renderOverlay(
  overrides: Partial<React.ComponentProps<typeof GeotechBandEditOverlay>> = {},
): void {
  render(
    <svg>
      <GeotechBandEditOverlay
        geotechLayers={GEOTECH_LAYERS}
        lithoLayers={LITHO_LAYERS}
        placedColumns={[COLUMN]}
        levelToScreen={levelToScreen}
        plotTop={0}
        plotBottom={2000}
        onRequestSplit={vi.fn()}
        onRequestMerge={vi.fn()}
        {...overrides}
      />
    </svg>,
  )
}

describe('GeotechBandEditOverlay — Join / Ontkoppelen on a column', () => {
  it('JCOL1 — armed, left-clicking a DIFFERENT same-class band commits the join', () => {
    const onJoinPick = vi.fn()
    renderOverlay({
      joinArm: { bodyId: 'body-A', anchorLayerId: 'band-1' },
      onJoinPick,
      bodyIdByLayerId: BODY_ID_BY_LAYER,
      classByLayerId: SAME_CLASS,
    })
    fireEvent.click(screen.getByTestId('geotech-band-hit-band-2'))
    expect(onJoinPick).toHaveBeenCalledTimes(1)
    expect(onJoinPick.mock.calls[0][0]).toEqual({
      kind: 'commit',
      anchorLayerId: 'band-1',
      targetAnchorLayerId: 'band-2',
    })
  })

  it('JCOL2 — armed, left-clicking the ARMED body\'s own band stays armed ({kind:"same"})', () => {
    const onJoinPick = vi.fn()
    renderOverlay({
      joinArm: { bodyId: 'body-A', anchorLayerId: 'band-1' },
      onJoinPick,
      bodyIdByLayerId: BODY_ID_BY_LAYER,
      classByLayerId: SAME_CLASS,
    })
    fireEvent.click(screen.getByTestId('geotech-band-hit-band-1'))
    expect(onJoinPick).toHaveBeenCalledTimes(1)
    expect(onJoinPick.mock.calls[0][0]).toEqual({ kind: 'same' })
  })

  it('JCOL3 — not armed, a band left-click fires no join pick', () => {
    const onJoinPick = vi.fn()
    renderOverlay({ onJoinPick, bodyIdByLayerId: BODY_ID_BY_LAYER, classByLayerId: SAME_CLASS })
    fireEvent.click(screen.getByTestId('geotech-band-hit-band-2'))
    expect(onJoinPick).not.toHaveBeenCalled()
  })

  it('JCOL4 — the band menu offers "Voeg samen met…" and arms with the band\'s body', () => {
    const onArmJoinBody = vi.fn()
    renderOverlay({ onArmJoinBody })
    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientY: yAtDepth(6),
    })
    fireEvent.click(screen.getByTestId('geotech-band-menu-join'))
    // The band's body, the band's own layer (a valid anchor), and its formation.
    expect(onArmJoinBody).toHaveBeenCalledWith('body-B', 'band-2', 'f-band-2')
  })

  it('JCOL5 — the band menu offers one "Ontkoppelen" per standing group', () => {
    const onUnjoinBody = vi.fn()
    renderOverlay({
      onUnjoinBody,
      unjoinOptionsForBody: bodyId =>
        bodyId === 'body-B' ? [{ unionId: 'u1', label: 'ZAND #9' }] : [],
    })
    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientY: yAtDepth(6),
    })
    const item = screen.getByTestId('geotech-band-menu-unjoin-u1')
    expect(item.textContent).toContain('ZAND #9')
    fireEvent.click(item)
    expect(onUnjoinBody).toHaveBeenCalledWith('u1')
  })
})
