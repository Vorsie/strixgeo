// Fetch one geotech model's manual body unions (``GET .../body-unions``) — the
// "Join with…" pairs the "(group N)" tag and the group pooling both read.
//
// Extracted as the SECOND copy of the identical fetch-effect (CLAUDE.md "extract
// on the second copy"): it first lived inline in ``GeotechnicalInspector`` (the
// units-pane tag) and the Parameters stage now needs the same list — the unit
// list pane (the tag on its geotech-body leaves) and the statistics canvas (the
// group a selected body pools). A missing or failed list degrades to no groups,
// never a blocked pane, so a warning names what was not found rather than a
// toast — the same contract ``useModelBodies`` keeps for its roster.

import { useEffect, useState } from 'react'

import { api } from '../../../api/client'
import type { BodyUnionListItem } from '../../../api/client'
import { log } from '../../../utils/log'

const EMPTY: readonly BodyUnionListItem[] = []

/**
 * The geotech model's manual body unions, or an empty list while absent.
 *
 * Parameters
 * ----------
 * projectId
 *     The project scope, or ``null``/``undefined`` to fetch nothing.
 * modelId
 *     The geotech model whose unions are wanted, or ``null`` to fetch nothing
 *     (unions live on the geotech model only).
 * refetchKey
 *     Any value whose change should re-fetch — the caller passes the geotech
 *     body-recompute nonce, since a recompute can re-resolve the anchors'
 *     bodies and change which bodies a group holds.
 *
 * Returns
 * -------
 * readonly BodyUnionListItem[]
 *     The unions; an empty list until the fetch lands or when there are none.
 */
export function useBodyUnions(
  projectId: string | null | undefined,
  modelId: string | null | undefined,
  refetchKey: unknown = null,
): readonly BodyUnionListItem[] {
  const [unions, setUnions] = useState<readonly BodyUnionListItem[]>(EMPTY)

  useEffect(() => {
    if (projectId == null || modelId == null) {
      setUnions(EMPTY)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const list = await api.geology.listBodyUnions(projectId, modelId)
        if (cancelled) return
        setUnions(list)
      } catch (err) {
        if (cancelled) return
        // Groups degrade to none; the pane stays usable, so a toast would be
        // noise. The warning names what was NOT found.
        log.warn('geology', `body unions: list failed for model ${modelId}`, err)
        setUnions(EMPTY)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, modelId, refetchKey])

  return unions
}
