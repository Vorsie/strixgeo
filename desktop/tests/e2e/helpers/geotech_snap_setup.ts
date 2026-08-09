/**
 * Fixture preparation for the geotech contact-snap flow.
 *
 * Everything here runs over the API, never the UI: it rebuilds the geotech model
 * from scratch and cuts each restated litho contact's lower band into thirds, so
 * the column offers TWO packing boundaries beneath the contact. That second
 * boundary is what makes "the drag landed on the FIRST boundary crossed" an
 * assertion rather than an assumption.
 *
 * It lives beside the spec rather than inside it because it is fixture shaping,
 * not the gesture under test — and because the spec that consumes it stays
 * readable only if the two are apart.
 *
 * @module tests/e2e/helpers/geotech_snap_setup
 */

import type { Page } from '@playwright/test'

/**
 * The allowance within which two depths on the same column are the same depth —
 * ``COINCIDENT_DEPTH_TOLERANCE_M`` in the renderer. A rounding width, not a
 * matching heuristic: the band materialiser rounds depths to 3 decimals while
 * litho contacts keep full float precision, so a band at 9.581 and a contact at
 * 9.581049712235094 are the same boundary recorded twice.
 */
export const COINCIDENT_TOLERANCE_M = 0.0011

/** How close two band boundaries must be to count as touching (the DB's own 1 cm). */
export const ADJACENCY_TOLERANCE_M = 0.01

/** A layer row as the layers endpoint returns it, reduced to what the spec reads. */
export interface LayerRow {
  id: string
  cpt_id: string | null
  borehole_id: string | null
  depth_top_m: number
  depth_base_m: number
  status: string
}

/** One column that offers the gesture, resolved from the API after setup. */
export interface SnapTarget {
  cptId: string
  /** The band ABOVE the contact — the id the overlay's padlock marker is keyed by. */
  upperBandId: string
  /** The band BELOW it; its top IS the contact, so it names the contact hit strip. */
  lowerBandId: string
  /** Where the restated contact sits today, in metres below the collar. */
  contactDepthM: number
  /** The litho layer whose TOP the contact is — the row the drag must PATCH. */
  lithoLayerId: string
  /** The litho layer above it, whose BASE is the same boundary. */
  lithoUpperLayerId: string
  /** The band whose top is the FIRST packing boundary below the contact. */
  firstBandId: string
  firstBoundaryM: number
  /** The band whose top is the SECOND — the boundary the drag must NOT reach. */
  secondBandId: string
  secondBoundaryM: number
}

/** What the preparation hands back to the test body. */
export interface SnapSetup {
  /** Set when the fixture cannot express the gesture; every other field is then absent. */
  error?: string
  geotechModelId?: string
  lithoModelId?: string
  targets?: SnapTarget[]
  /** Every geotech layer id after setup — the "no band created or deleted" baseline. */
  geotechLayerIds?: string[]
}

/**
 * Rebuild the geotech model and give every restated contact two boundaries below it.
 *
 * Deletes any leftover geotechnical model, re-runs ``subdivide-cpts`` on the litho
 * model, then — on EVERY CPT column, because subdivide is model-wide and the one
 * qualifying column may sit on a section the spec never opens — finds the first
 * boundary between two packing bands whose litho parents differ and splits the band
 * beneath it into thirds.
 *
 * Parameters
 * ----------
 * page : Page
 *     The Electron renderer page; all fetches run in its origin.
 * apiBase : string
 *     Backend origin, e.g. ``http://127.0.0.1:8765``.
 * projectId : string
 *     The seeded fixture project.
 *
 * Returns
 * -------
 * SnapSetup
 *     The rebuilt model's ids, one target per prepared column, and the post-setup
 *     band-id baseline — or ``error`` naming what the fixture could not offer.
 */
export async function prepareGeotechSnapFixture(
  page: Page,
  apiBase: string,
  projectId: string,
): Promise<SnapSetup> {
  return page.evaluate(
    async ([base, pid, coincidentTol, adjacencyTol]) => {
      const RESTATED_TOL = Number(coincidentTol)
      const ADJACENT_TOL = Number(adjacencyTol)
      const getJson = async (url: string): Promise<unknown> => (await fetch(url)).json()
      const modelsUrl = `${base}/projects/${pid}/geology/models`

      const models = (await getJson(modelsUrl)) as { id: string; kind: string }[]
      for (const m of models.filter(x => x.kind === 'geotechnical')) {
        const d = await fetch(`${modelsUrl}/${m.id}`, { method: 'DELETE' })
        if (d.status !== 204) return { error: `delete geotech model ${d.status}` }
      }
      const litho = models.find(x => x.kind === 'lithostratigraphic')
      if (!litho) return { error: 'no litho model in fixture' }

      const sub = await fetch(`${modelsUrl}/${litho.id}/geotech/subdivide-cpts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ litho_model_id: litho.id }),
      })
      if (sub.status !== 200) return { error: `subdivide ${sub.status}: ${await sub.text()}` }
      const gid = ((await sub.json()) as { geotech_model_id: string }).geotech_model_id

      // Only ACCEPTED litho layers are the bodies the renderer judges parentage
      // against — a pending suggestion is not part of the litho stack yet.
      const lithoLayers = ((await getJson(`${modelsUrl}/${litho.id}/layers`)) as LayerRow[]).filter(
        l => l.status === 'accepted',
      )

      /** One column's rows, shallowest first — the reduction ``columnBands`` makes. */
      const column = (rows: LayerRow[], anchorId: string): LayerRow[] =>
        rows
          .filter(l => (l.cpt_id ?? l.borehole_id) === anchorId)
          .sort((a, b) => a.depth_top_m - b.depth_top_m)
      /** The litho body a depth falls in — half-open [top, base), one owner never two. */
      const enclosing = (bodies: LayerRow[], depthM: number): LayerRow | null =>
        bodies.find(b => depthM >= b.depth_top_m && depthM < b.depth_base_m) ?? null

      const bandsUrl = `${modelsUrl}/${gid}/layers`
      const splitUrl = `${modelsUrl}/${gid}/geotech/bands/split`
      let bands = (await getJson(bandsUrl)) as LayerRow[]
      const cptIds = Array.from(
        new Set(bands.filter(b => b.cpt_id !== null).map(b => b.cpt_id as string)),
      )

      const prepared: {
        cptId: string
        contactDepthM: number
        lithoLayerId: string
        lithoUpperLayerId: string
        firstBoundaryM: number
        secondBoundaryM: number
      }[] = []
      for (const cptId of cptIds) {
        const bodies = column(lithoLayers, cptId)
        const col = column(bands, cptId)
        let chosen: {
          bandId: string
          topM: number
          baseM: number
          lithoLayerId: string
          lithoUpperLayerId: string
        } | null = null
        for (let i = 1; i < col.length; i += 1) {
          const upper = col[i - 1]
          const lower = col[i]
          if (Math.abs(upper.depth_base_m - lower.depth_top_m) > ADJACENT_TOL) continue
          // Parentage decides, exactly as ``boundaryRestatesLithoContact`` does: each
          // band probed at its OWN midpoint, and the two bodies must differ. Depth
          // proximity decides nothing here — it only picks WHICH litho row, below.
          const upperBody = enclosing(bodies, (upper.depth_top_m + upper.depth_base_m) / 2)
          const lowerBody = enclosing(bodies, (lower.depth_top_m + lower.depth_base_m) / 2)
          if (upperBody === null || lowerBody === null || upperBody.id === lowerBody.id) continue
          const lithoRow = bodies.find(
            l => Math.abs(l.depth_top_m - lower.depth_top_m) <= RESTATED_TOL,
          )
          const lithoAbove = bodies.find(
            l => Math.abs(l.depth_base_m - lower.depth_top_m) <= RESTATED_TOL,
          )
          if (lithoRow === undefined || lithoAbove === undefined) continue
          // Room for two splits with every third still well clear of the 1 cm
          // structural floor a hand split clamps to.
          if (lower.depth_base_m - lower.depth_top_m < 0.6) continue
          chosen = {
            bandId: lower.id,
            topM: lower.depth_top_m,
            baseM: lower.depth_base_m,
            lithoLayerId: lithoRow.id,
            lithoUpperLayerId: lithoAbove.id,
          }
          break
        }
        if (chosen === null) continue

        const third = (chosen.baseM - chosen.topM) / 3
        const d1 = Math.round((chosen.topM + third) * 1000) / 1000
        const d2 = Math.round((chosen.topM + 2 * third) * 1000) / 1000
        const first = await fetch(splitUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ band_id: chosen.bandId, split_depth_m: d1 }),
        })
        // A band the server refuses to cut is fine — another column will carry the
        // pair, and running out of columns is reported once, at the end.
        if (first.status !== 200) continue
        bands = (await getJson(bandsUrl)) as LayerRow[]
        const middle = column(bands, cptId).find(b => Math.abs(b.depth_top_m - d1) <= RESTATED_TOL)
        if (middle === undefined) continue
        const second = await fetch(splitUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ band_id: middle.id, split_depth_m: d2 }),
        })
        if (second.status !== 200) continue
        bands = (await getJson(bandsUrl)) as LayerRow[]
        prepared.push({
          cptId,
          contactDepthM: chosen.topM,
          lithoLayerId: chosen.lithoLayerId,
          lithoUpperLayerId: chosen.lithoUpperLayerId,
          firstBoundaryM: d1,
          secondBoundaryM: d2,
        })
      }

      // Resolve ids from the FINAL row set: a split replaces the band it cut, so
      // every band id captured before the two splits is stale by now.
      const targets: SnapTarget[] = []
      for (const p of prepared) {
        const col = column(bands, p.cptId)
        const near = (value: number, depthM: number): boolean =>
          Math.abs(value - depthM) <= RESTATED_TOL
        const lowerBand = col.find(b => near(b.depth_top_m, p.contactDepthM))
        const upperBand = col.find(b => near(b.depth_base_m, p.contactDepthM))
        const firstBand = col.find(b => near(b.depth_top_m, p.firstBoundaryM))
        const secondBand = col.find(b => near(b.depth_top_m, p.secondBoundaryM))
        if (!lowerBand || !upperBand || !firstBand || !secondBand) continue
        targets.push({
          cptId: p.cptId,
          upperBandId: upperBand.id,
          lowerBandId: lowerBand.id,
          contactDepthM: lowerBand.depth_top_m,
          lithoLayerId: p.lithoLayerId,
          lithoUpperLayerId: p.lithoUpperLayerId,
          firstBandId: firstBand.id,
          firstBoundaryM: firstBand.depth_top_m,
          secondBandId: secondBand.id,
          secondBoundaryM: secondBand.depth_top_m,
        })
      }
      if (targets.length === 0) {
        return {
          error:
            'no CPT column carries two packing bands in DIFFERENT litho bodies with a ' +
            'splittable band beneath — the fixture cannot express this gesture',
        }
      }
      return {
        geotechModelId: gid,
        lithoModelId: litho.id,
        targets,
        geotechLayerIds: bands.map(b => b.id).sort(),
      }
    },
    [
      apiBase,
      projectId,
      String(COINCIDENT_TOLERANCE_M),
      String(ADJACENCY_TOLERANCE_M),
    ] as const,
  )
}

/**
 * Read one geological model's layer rows through the API.
 *
 * @param page The Electron renderer page.
 * @param apiBase Backend origin.
 * @param projectId The fixture project.
 * @param modelId The geological / litho / geotech model to read.
 * @returns Every layer row of that model.
 */
export async function readModelLayers(
  page: Page,
  apiBase: string,
  projectId: string,
  modelId: string,
): Promise<LayerRow[]> {
  return page.evaluate(
    async ([base, pid, mid]) => {
      const r = await fetch(`${base}/projects/${pid}/geology/models/${mid}/layers`)
      return (await r.json()) as never[]
    },
    [apiBase, projectId, modelId] as const,
  )
}
