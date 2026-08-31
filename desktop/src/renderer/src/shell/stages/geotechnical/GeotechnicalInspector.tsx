// Geotechnical stage inspector — panel chrome, the unit roster, and the
// selected-body readout.
//
// The roster itself is GeotechnicalUnitRoster (soil ▸ NAD class ▸ instances);
// its arithmetic is geotechUnitTree.ts. Both were split out of this file when
// the tree landed — the flat list fitted here, the tree does not, and debt #201
// is about not letting a stage component absorb everything again.

import { useCallback, useMemo } from 'react'
import { FlaskConical } from 'lucide-react'

import { api } from '../../../api/client'
import { log } from '../../../utils/log'
import { nadClassName } from '../../../utils/nadClasses'
import { useGeotechBodySelection } from '../../../utils/geotechBodySelectionStore'
import { EmptyState } from '../../EmptyState'
import { useShell } from '../../ShellContext'
import { useT } from '../../../i18n/translate'
import { useLanguage } from '../../../i18n/languageSelect'
import { useModelBodies } from '../parameters/useModelBodies'
import GeotechnicalUnitRoster from './GeotechnicalUnitRoster'

/**
 * Human-readable label for each CPT assignment source token.
 *
 * Translate at the presentation boundary — the domain stores the raw backend
 * token, the lookup lives here.
 */
const ASSIGNMENT_SOURCE_LABELS: Record<string, string> = {
  cpt_interpolated: 'CPT interpolated',
  body_min: 'Body minimum',
  absolute_min: 'Absolute minimum',
  unresolved: 'Unresolved',
}

/**
 * Inspector for the Geotechnical stage (F5 — the NAD unit roster).
 *
 * Reads ``geotechFormations`` / ``geotechContacts`` / ``geotechLayers`` from
 * the shell's ``geoModel`` bus and renders them as a soil ▸ NAD class ▸
 * instances tree, plus the selected-body panel when a sample dot is picked on
 * the section canvas.
 *
 * When no geotech units exist yet, an empty-state prompt directs the engineer
 * to run "Subdivide all bodies" in the Geotechnical stage toolbar.
 *
 * Returns
 * -------
 * JSX.Element
 *     The inspector panel content.
 */
export default function GeotechnicalInspector(): JSX.Element {
  const t = useT()
  // Subscribe so the selected-body NAD name (``nadClassName``) re-renders on flip.
  useLanguage()
  const {
    project,
    geoModel: {
      geotechFormations,
      geotechContacts,
      geotechLayers,
      lithoFormations,
      activeGeotechModel,
      refetchFormations,
      handleFormationUpdated,
    },
    coordinator: { bodyRecomputeGeotechNonce },
  } = useShell()
  // Reactive: re-renders when the engineer clicks a sample dot.
  const bodySelection = useGeotechBodySelection()

  const projectId = project?.id ?? null

  // The geotech model's bodies, for the crossed-formation subtitle (debt #278,
  // R2). Reuses the Parameters stage's fetch hook — the roster reads only their
  // ``geo_formations`` lists. Follows the body-recompute nonce so the subtitle
  // refreshes after a recompute; a null active model fetches nothing.
  const geotechBodiesById = useModelBodies(
    projectId,
    activeGeotechModel?.id ?? null,
    bodyRecomputeGeotechNonce,
  )
  const geotechBodies = useMemo(() => [...geotechBodiesById.values()], [geotechBodiesById])

  // The colour the engineer picks on a roster row (owner ruling 2026-08-26).
  //
  // It is written to ``color_override``, never to ``color``: ``color`` is the
  // lithology colour the geotech materialiser copied from the source litho
  // unit, so overwriting it would destroy the unit's inherited identity AND
  // leave nothing to distinguish a decision from a stamped default. ``null``
  // clears the choice — the row goes back to its automatic packing colour.
  //
  // A row can stand for several units, so one gesture is several PATCHes. They
  // go out together rather than in sequence — the rows are independent, so
  // serialising them would only add a round-trip per unit — and the refetch
  // runs once after all of them, so the pane repaints in one step.
  const handlePickUnitColor = useCallback(
    (formationIds: readonly string[], color: string | null): void => {
      if (projectId === null || formationIds.length === 0) return
      void (async () => {
        try {
          await Promise.all(
            formationIds.map(id =>
              api.geology.updateFormation(projectId, id, { color_override: color }),
            ),
          )
          await refetchFormations()
          handleFormationUpdated()
        } catch (err) {
          log.error('geology', 'updateFormation (color_override) failed', err)
        }
      })()
    },
    [projectId, refetchFormations, handleFormationUpdated],
  )

  // S2: derive the formation for the selected body so the inspector can name it
  // and highlight its roster row.
  const selectedLayer =
    bodySelection !== null
      ? (geotechLayers.find(l => l.body_id === bodySelection.bodyId) ?? null)
      : null
  const selectedFormation =
    selectedLayer !== null
      ? (geotechFormations.find(f => f.id === selectedLayer.formation_id) ?? null)
      : null

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-xs font-semibold text-text-primary">{t('geotech.units')}</div>

      {geotechFormations.length === 0 ? (
        <EmptyState
          icon={<FlaskConical />}
          title={t('geotech.noUnits')}
          hint={t('geotech.runSubdivideHint')}
          compact
        />
      ) : (
        <GeotechnicalUnitRoster
          geotechFormations={geotechFormations}
          geotechContacts={geotechContacts}
          geotechLayers={geotechLayers}
          lithoFormations={lithoFormations}
          geotechBodies={geotechBodies}
          onPickColor={handlePickUnitColor}
          selectedFormationId={selectedFormation?.id ?? null}
        />
      )}

      {/* Assignment source panel — shown when a sample dot is selected on the
          section canvas.  The source token is translated at the presentation
          boundary (ASSIGNMENT_SOURCE_LABELS lookup). */}
      {bodySelection !== null && (
        <div
          className="rounded border border-border-subtle bg-surface-raised p-2 text-[11px] leading-snug text-text-secondary"
          data-testid="geotech-sample-source"
        >
          <span className="font-semibold text-text-primary">{t('geotech.selectedBody')}</span>

          {/* S2: show packing-class name + NAD number for the selected body so the
              inspector identifies the unit by name, not just by dot position. */}
          {selectedFormation !== null && (
            <div
              className="mt-0.5 font-medium text-text-secondary"
              data-testid="geotech-sample-source-formation"
            >
              {nadClassName(selectedFormation.nad_class)}
              {selectedFormation.nad_class !== null && (
                <span className="ml-1 font-normal text-text-muted">
                  (NAD {selectedFormation.nad_class})
                </span>
              )}
            </div>
          )}

          {bodySelection.assignmentSource !== null && (
            <div className="mt-0.5 text-text-muted">
              {/* Display the human-readable translation; fall back to the raw token
                  if a future token is added before the lookup table is updated.
                  S3: title exposes the raw backend token so domain experts can
                  verify the mapping without opening DevTools. */}
              {t('geotech.sampleSource')}{' '}
              <span title={bodySelection.assignmentSource}>
                {ASSIGNMENT_SOURCE_LABELS[bodySelection.assignmentSource] ??
                  bodySelection.assignmentSource}
              </span>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] leading-snug text-text-muted">{t('geotech.estimateDisclaimer')}</p>
    </div>
  )
}
