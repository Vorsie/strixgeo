// Behavioural pins for assembling the fence-diagram DXF export request
// (owner ballot 2026-08-26, MVP 3-D & visuals: "fence diagram export").
//
// The deliverable rule these assertions are written against: WHAT THE ENGINEER
// EXPORTS IS WHAT THE ENGINEER SEES. The fence walls are built and coloured in
// the renderer (NAD colours are a presentation-boundary recolour that the
// database never stores), so the request carries the rendered names and colours
// rather than letting the server re-derive them and disagree.
//
// The second rule: a deliverable must not carry empty layers. A panel with no
// geometry would open in CAD as a named-but-blank layer, which reads as "this
// unit is missing from the model" — the opposite of the truth.

import { describe, expect, it } from 'vitest'

import type { GeologicalFormationResponse } from '../api/client'
import type { FencePanel } from './fencePanels'
import { buildFenceExportRequest } from './fenceExportRequest'

function formation(
  id: string,
  over: Partial<GeologicalFormationResponse> = {},
): GeologicalFormationResponse {
  return {
    id,
    name: `Formation ${id}`,
    color: '#aabbcc',
    litho_main_soil_code: null,
    litho_admixtures: [],
    display_order: 0,
    ...over,
  } as unknown as GeologicalFormationResponse
}

function panel(formationId: string, over: Partial<FencePanel> = {}): FencePanel {
  return {
    formationId,
    bodyId: 'body-1',
    vertices: [
      [0, 0, 0],
      [10, 0, 0],
      [10, 0, 5],
    ],
    triangles: [[0, 1, 2]],
    ...over,
  }
}

describe('buildFenceExportRequest', () => {
  it('exports the geometry exactly as the viewer holds it', () => {
    const req = buildFenceExportRequest([panel('f1')], [formation('f1')])

    expect(req.panels).toHaveLength(1)
    expect(req.panels[0].vertices).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [10, 0, 5],
    ])
    expect(req.panels[0].triangles).toEqual([[0, 1, 2]])
    expect(req.panels[0].formation_id).toBe('f1')
    expect(req.panels[0].body_id).toBe('body-1')
  })

  it('labels a litho unit the way the legend labels it', () => {
    // The legend shows "SAND | clayey"; the DXF layer must say the same thing,
    // or the engineer cannot match a layer to what he saw on screen.
    const req = buildFenceExportRequest(
      [panel('f1')],
      [
        formation('f1', {
          litho_main_soil_code: 'ZAND',
          litho_admixtures: [
            { soil_code: 'KLEI', amount: null, locally: false },
          ],
        } as unknown as Partial<GeologicalFormationResponse>),
      ],
    )

    expect(req.panels[0].name).toContain('SAND')
    expect(req.panels[0].name).toContain('|')
  })

  it('falls back to the formation name when there is no soil code', () => {
    const req = buildFenceExportRequest([panel('f1')], [formation('f1', { name: 'Boom Clay' })])

    expect(req.panels[0].name).toBe('Boom Clay')
  })

  it('carries the colour the viewer painted, normalised to #rrggbb', () => {
    // Formation colours arrive both with and without the leading hash
    // (Geology3DViewer normalises the same way for its legend swatch).
    const req = buildFenceExportRequest(
      [panel('f1'), panel('f2')],
      [formation('f1', { color: 'd4b84a' }), formation('f2', { color: '#123456' })],
    )

    expect(req.panels[0].color).toBe('#d4b84a')
    expect(req.panels[1].color).toBe('#123456')
  })

  it("carries each panel's section id as section_id, null when the panel has none", () => {
    const req = buildFenceExportRequest([panel('f1', { sectionId: 'cs-1' }), panel('f1')], [formation('f1')])
    expect(req.panels[0].section_id).toBe('cs-1')
    expect(req.panels[1].section_id).toBeNull()
  })

  it('drops panels with nothing to draw', () => {
    // A wall with no vertices, or vertices but no faces, contributes no
    // geometry — exporting it creates an empty CAD layer that reads as a
    // missing unit.
    const req = buildFenceExportRequest(
      [
        panel('f1'),
        panel('f2', { vertices: [] }),
        panel('f3', { triangles: [] }),
      ],
      [formation('f1'), formation('f2'), formation('f3')],
    )

    expect(req.panels.map(p => p.formation_id)).toEqual(['f1'])
  })

  it('still exports a panel whose formation is unknown', () => {
    // A fence panel always carries real geometry. Dropping it because its
    // formation row did not reach this render would silently punch a hole in
    // the deliverable; name it plainly instead, so the gap is visible in CAD.
    const req = buildFenceExportRequest([panel('ghost')], [])

    expect(req.panels).toHaveLength(1)
    expect(req.panels[0].formation_id).toBe('ghost')
    expect(req.panels[0].name).toContain('ghost')
  })

  it('preserves panel order', () => {
    const req = buildFenceExportRequest(
      [panel('f2'), panel('f1'), panel('f2')],
      [formation('f1'), formation('f2')],
    )

    expect(req.panels.map(p => p.formation_id)).toEqual(['f2', 'f1', 'f2'])
  })

  it('produces an empty request when there is no fence', () => {
    expect(buildFenceExportRequest([], []).panels).toEqual([])
  })
})
