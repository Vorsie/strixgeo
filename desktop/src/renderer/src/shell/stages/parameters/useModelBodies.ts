// Fetch one model's body roster (``GET .../bodies``) — the per-body metadata
// (name, ordinal, and the R2 crossed-formation list) that several read-only
// stage slots decorate their views with.
//
// Own hook rather than shell state: each consumer needs the roster as label /
// annotation COSMETICS layered over data it already holds (the grouping itself
// comes from the layers' ``body_id``), each is a separate no-props stage slot,
// and each fetch is one small GET keyed by (project, model, recompute nonce).
// The consumer set has grown past the Parameters stage: the unit list pane and
// the statistics canvas (Parameters), the sections canvas unit-jump rosters
// (Sections), and the geotech units roster's crossed-formation subtitle
// (Geotechnical inspector, debt #278 R2). A missing or failed roster degrades
// to loading-word labels / a dropped subtitle — see ``parameterUnitBodies.bodyLabelOf``
// — never to a blocked pane. (Deferred: the file still lives under parameters/.)

import { useEffect, useState } from 'react'

import { api } from '../../../api/client'
import type { BodyListItem } from '../../../api/client'
import { log } from '../../../utils/log'

const EMPTY: ReadonlyMap<string, BodyListItem> = new Map()

/**
 * The model's bodies keyed by id, or an empty map while absent.
 *
 * Parameters
 * ----------
 * projectId
 *     The project scope, or ``null``/``undefined`` to fetch nothing.
 * modelId
 *     The litho or geotech model whose roster is wanted, or ``null`` to
 *     fetch nothing (a scope with no active model has no bodies to label).
 * refetchKey
 *     Any value whose change should re-fetch — the caller passes the axis's
 *     body-recompute nonce so labels follow a recompute.
 *
 * Returns
 * -------
 * ReadonlyMap<string, BodyListItem>
 *     ``body id → roster row``; empty until the fetch lands.
 */
export function useModelBodies(
  projectId: string | null | undefined,
  modelId: string | null | undefined,
  refetchKey: unknown = null,
): ReadonlyMap<string, BodyListItem> {
  const [bodiesById, setBodiesById] = useState<ReadonlyMap<string, BodyListItem>>(EMPTY)

  useEffect(() => {
    if (projectId == null || modelId == null) {
      setBodiesById(EMPTY)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const list = await api.geology.listLenses(projectId, modelId)
        if (cancelled) return
        log.debug('geology', `model bodies: ${list.length} row(s) for model ${modelId}`)
        setBodiesById(new Map(list.map(b => [b.id, b])))
      } catch (err) {
        if (cancelled) return
        // Labels degrade to id prefixes; the pane stays usable, so a toast
        // would be noise. The warning names what was NOT found.
        log.warn('geology', `model bodies: list failed for model ${modelId}`, err)
        setBodiesById(EMPTY)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, modelId, refetchKey])

  return bodiesById
}
