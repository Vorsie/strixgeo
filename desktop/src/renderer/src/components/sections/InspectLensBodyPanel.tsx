/**
 * Inspect-lens-body panel — Position 4 gesture surface (#101 Blocker 1).
 *
 * Opened by right-clicking a body-ordinal chip in CorrelationEdgesOverlay
 * and choosing "Inspect lens body…".  Displays:
 *
 * - Formation name + body ordinal
 * - Present investigations (those with a committed contact on this section)
 * - Absence list grouped by source with confidence badges and per-row
 *   "Confirm" buttons that promote inferred → manual
 * - "Confirm all auto absences" bulk action
 * - "Name this lens" text field (POST /lenses)
 * - "Create perpendicular companion" button (opens CompanionOfferDialog)
 *
 * Visual style contract
 * --------------------
 * Inferred absence rows carry an amber "auto" badge and the formation
 * band in CorrelationEdgesOverlay renders at 40% opacity / dashed
 * when ALL absences are inferred (see bandOpacity helper in the overlay).
 * Any manual/observed absence flips the band to solid/70% with no badge —
 * the panel's "Confirm" gesture is the trigger that makes the band solid.
 *
 * The panel is a full modal (uses the shared Modal shell + portal) so it
 * escapes the SVG stacking context.  State lives at the SectionsCanvas
 * level; SectionPanel passes the open-callback to CorrelationEdgesOverlay
 * as an optional prop.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BodyBoundaryNode,
  BodyRenderStyle,
  FormationAbsenceItem,
  GeologicalFormationResponse,
} from '../../api/client'
import { api } from '../../api/client'
import { log } from '../../utils/log'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { useT } from '../../i18n/translate'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InspectLensBodyTarget {
  /** Formation that defines the body. */
  formationId: string
  /** Body ordinal (instance_ordinal from resolver). */
  bodyOrdinal: number
  /** Project scope. */
  projectId: string
  /** Active lithostratigraphic model id. */
  modelId: string
}

interface Props {
  /** Non-null = panel is open. Null = closed. */
  target: InspectLensBodyTarget | null
  /** Formation vocabulary for name lookup. */
  formations: readonly GeologicalFormationResponse[]
  /** Investigation ids that are PRESENT on this section (have a committed
   *  contact for this formation).  Computed by the caller from axisContacts
   *  filtered to the formation + section. */
  presentInvestigationIds: readonly string[]
  /** Human-readable labels for investigation ids — keyed by investigation id.
   *  Built from visibleCpts + visibleBoreholes at the SectionsCanvas boundary.
   *  Absent ids fall back to the id string. */
  investigationLabels: ReadonlyMap<string, string>
  /** Existing named lens for this (formationId, bodyOrdinal) pair — null when
   *  the body has not been named yet.  Used to pre-fill the name field. */
  existingLensId: string | null
  existingLensName: string | null
  /** Called when the user saves a new/updated lens name.  Caller should
   *  refetch the lens list so the inspector badge refreshes. */
  onLensNamed: (lensId: string, wasCreated: boolean) => void
  /** Called when the user triggers the perpendicular-companion flow.
   *  Caller opens CompanionOfferDialog with the supplied lens info. */
  onOfferCompanion: (lensId: string, lensName: string | null) => void
  /** Called when any absence source is updated so the caller can refetch
   *  absences / trigger re-render as appropriate. */
  onAbsenceUpdated: () => void
  /** Close the panel. */
  onClose: () => void
}

// Source badge config.
const SOURCE_BADGE: Record<string, { label: string; className: string }> = {
  inferred: {
    label: 'auto',
    className: 'bg-amber-500/20 text-amber-600 border border-amber-500/40',
  },
  manual: {
    label: 'confirmed',
    className: 'bg-green-500/20 text-green-600 border border-green-500/40',
  },
  observed: {
    label: 'observed',
    className: 'bg-blue-500/20 text-blue-600 border border-blue-500/40',
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Modal panel for inspecting a lens body's absence evidence.
 *
 * Parameters
 * ----------
 * target : InspectLensBodyTarget | null
 *     Non-null = panel is open.
 * formations : readonly GeologicalFormationResponse[]
 *     Formation vocabulary for name lookup.
 * presentInvestigationIds : readonly string[]
 *     Investigations with a committed contact for this formation on this section.
 * investigationLabels : ReadonlyMap<string, string>
 *     Human-readable id → label map.
 * existingLensId : string | null
 *     Pre-existing lens metadata row, if any.
 * existingLensName : string | null
 *     Pre-existing lens name, if any.
 * onLensNamed : (lensId: string, wasCreated: boolean) => void
 *     Fired after a successful nameBody call.
 * onOfferCompanion : (lensId: string, lensName: string | null) => void
 *     Fired when the user clicks "Create perpendicular companion".
 * onAbsenceUpdated : () => void
 *     Fired after any absence confirm/update so the caller can refetch.
 * onClose : () => void
 *     Dismiss the panel.
 *
 * Returns
 * -------
 * JSX.Element
 */
export default function InspectLensBodyPanel({
  target,
  formations,
  presentInvestigationIds,
  investigationLabels,
  existingLensId,
  existingLensName,
  onLensNamed,
  onOfferCompanion,
  onAbsenceUpdated,
  onClose,
}: Props): JSX.Element {
  const t = useT()
  // Absences fetched from GET .../formations/{id}/absences on open.
  const [absences, setAbsences] = useState<FormationAbsenceItem[]>([])
  const [absencesLoading, setAbsencesLoading] = useState(false)

  // Lens name field state — pre-filled from existingLensName.
  const [lensName, setLensName] = useState(existingLensName ?? '')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Bulk-confirm-all loading state.
  const [confirmAllBusy, setConfirmAllBusy] = useState(false)

  // #163f Slice 2 — lens boundary render style + the current control nodes
  // (preserved so a style change PUTs the full shape, not an empty one).
  const [renderStyle, setRenderStyle] = useState<BodyRenderStyle>('straight')
  const [boundaryNodes, setBoundaryNodes] = useState<{
    upper: BodyBoundaryNode[]
    lower: BodyBoundaryNode[]
  }>({ upper: [], lower: [] })
  const [styleSaving, setStyleSaving] = useState(false)

  // Sync the name field when the panel reopens for a different lens or body.
  useEffect(() => {
    setLensName(existingLensName ?? '')
    setNameError(null)
  }, [existingLensName, target?.formationId, target?.bodyOrdinal])

  // Fetch absences whenever the panel opens (target becomes non-null).
  useEffect(() => {
    if (target === null) {
      setAbsences([])
      return
    }
    let cancelled = false
    setAbsencesLoading(true)
    log.debug(
      'section',
      `InspectLensBodyPanel: fetching absences formation=${target.formationId}`,
    )
    api.geology
      .listFormationAbsences(target.projectId, target.formationId)
      .then(rows => {
        if (!cancelled) {
          setAbsences(rows)
          log.debug(
            'section',
            `InspectLensBodyPanel: ${rows.length} absence(s) loaded for formation=${target.formationId}`,
          )
        }
      })
      .catch(err => {
        if (!cancelled) {
          log.warn('section', 'InspectLensBodyPanel: failed to load absences', err)
          setAbsences([])
        }
      })
      .finally(() => {
        if (!cancelled) setAbsencesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [target])

  // #163f Slice 2 — load the lens's boundary shape (style + nodes) when the
  // panel opens for a lens that has a row. Drives the render-style picker +
  // preserves the control nodes across a style change.
  useEffect(() => {
    if (target === null || existingLensId === null) {
      setRenderStyle('straight')
      setBoundaryNodes({ upper: [], lower: [] })
      return
    }
    let cancelled = false
    api.geology
      .getBodyBoundary(target.projectId, target.modelId, existingLensId)
      .then(b => {
        if (cancelled) return
        setRenderStyle(b.render_style)
        setBoundaryNodes({ upper: b.upper_nodes, lower: b.lower_nodes })
      })
      .catch(err => {
        if (!cancelled) log.warn('section', 'InspectLensBodyPanel: getBodyBoundary failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [target, existingLensId])

  const handleStyleChange = useCallback(
    async (style: BodyRenderStyle): Promise<void> => {
      if (target === null || existingLensId === null) return
      const prev = renderStyle
      setRenderStyle(style) // optimistic
      setStyleSaving(true)
      try {
        await api.geology.saveBodyBoundary(target.projectId, target.modelId, existingLensId, {
          upper_nodes: boundaryNodes.upper,
          lower_nodes: boundaryNodes.lower,
          render_style: style,
        })
      } catch (err) {
        log.warn('section', 'InspectLensBodyPanel: saveBodyBoundary (style) failed', err)
        setRenderStyle(prev) // rollback
      } finally {
        setStyleSaving(false)
      }
    },
    [target, existingLensId, renderStyle, boundaryNodes],
  )

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleConfirmAbsence = useCallback(
    async (absence: FormationAbsenceItem): Promise<void> => {
      if (target === null) return
      log.info(
        'section',
        `InspectLensBodyPanel: confirm absence formation=${target.formationId} ` +
          `investigation=${absence.investigation_id}`,
      )
      try {
        await api.geology.upsertFormationAbsence(target.projectId, target.formationId, {
          investigation_id: absence.investigation_id,
          investigation_kind: absence.investigation_kind,
          source: 'manual',
        })
        // Optimistic update in local state before refetch.
        setAbsences(prev =>
          prev.map(a =>
            a.id === absence.id ? { ...a, source: 'manual' } : a,
          ),
        )
        onAbsenceUpdated()
        log.success(
          'section',
          `InspectLensBodyPanel: absence ${absence.id} promoted to manual`,
        )
      } catch (err) {
        log.warn('section', 'InspectLensBodyPanel: confirm absence failed', err)
      }
    },
    [target, onAbsenceUpdated],
  )

  const handleConfirmAll = useCallback(async (): Promise<void> => {
    if (target === null) return
    const inferred = absences.filter(a => a.source === 'inferred')
    if (inferred.length === 0) return
    setConfirmAllBusy(true)
    log.info(
      'section',
      `InspectLensBodyPanel: confirm-all ${inferred.length} inferred absence(s) ` +
        `for formation=${target.formationId}`,
    )
    try {
      for (let i = 0; i < inferred.length; i++) {
        log.debug(
          'section',
          `InspectLensBodyPanel: [${i + 1}/${inferred.length}] confirm absence ${inferred[i].id}`,
        )
        await api.geology.upsertFormationAbsence(target.projectId, target.formationId, {
          investigation_id: inferred[i].investigation_id,
          investigation_kind: inferred[i].investigation_kind,
          source: 'manual',
        })
      }
      // Bulk-update local state.
      setAbsences(prev => prev.map(a => (a.source === 'inferred' ? { ...a, source: 'manual' } : a)))
      onAbsenceUpdated()
      log.success(
        'section',
        `InspectLensBodyPanel: confirmed ${inferred.length} absence(s) for formation=${target.formationId}`,
      )
    } catch (err) {
      log.warn('section', 'InspectLensBodyPanel: confirm-all failed mid-way', err)
    } finally {
      setConfirmAllBusy(false)
    }
  }, [target, absences, onAbsenceUpdated])

  const handleSaveName = useCallback(async (): Promise<void> => {
    if (target === null) return
    const trimmed = lensName.trim()
    if (trimmed === '') {
      setNameError(t('sections.lensPanel.nameEmpty'))
      return
    }
    if (!existingLensId) {
      // The body row is always created by the resolver before the panel opens.
      // A null existingLensId means the lens list fetch failed — the user
      // should close and reopen the panel once the model is resolved.
      setNameError(t('sections.lensPanel.bodyUnresolved'))
      return
    }
    setNameSaving(true)
    setNameError(null)
    log.info(
      'section',
      `InspectLensBodyPanel: naming body=${existingLensId} formation=${target.formationId} ` +
        `ordinal=${target.bodyOrdinal} name="${trimmed}"`,
    )
    try {
      const result = await api.geology.nameBody(target.projectId, target.modelId, existingLensId, {
        formation_id: target.formationId,
        body_ordinal: target.bodyOrdinal,
        name: trimmed,
        primary_section_id: null,
      })
      onLensNamed(result.body_id, result.was_created)
      log.success(
        'section',
        `InspectLensBodyPanel: body ${result.body_id} ` +
          `${result.was_created ? 'created' : 'updated'} with name="${trimmed}"`,
      )
    } catch (err) {
      log.warn('section', 'InspectLensBodyPanel: nameBody failed', err)
      setNameError(t('sections.lensPanel.saveNameFailed'))
    } finally {
      setNameSaving(false)
    }
  }, [target, lensName, existingLensId, onLensNamed])

  const handleOfferCompanion = useCallback((): void => {
    if (target === null) return
    // A companion requires a named lens.  If there's no existing lens id,
    // surface a short error rather than silently failing.
    if (existingLensId === null) {
      setNameError(t('sections.lensPanel.saveNameForCompanion'))
      nameInputRef.current?.focus()
      return
    }
    onOfferCompanion(existingLensId, lensName.trim() || existingLensName)
    onClose()
  }, [target, existingLensId, lensName, existingLensName, onOfferCompanion, onClose])

  // ---------------------------------------------------------------------------
  // Derived display values
  // ---------------------------------------------------------------------------

  const open = target !== null
  if (!open) return <></>

  const formation = formations.find(f => f.id === target.formationId)
  const formationName = formation?.name ?? target.formationId
  const inferredCount = absences.filter(a => a.source === 'inferred').length
  const hasAnyInferred = inferredCount > 0

  // Group absences by source for display.
  const bySource = new Map<string, FormationAbsenceItem[]>()
  for (const a of absences) {
    if (!bySource.has(a.source)) bySource.set(a.source, [])
    bySource.get(a.source)!.push(a)
  }
  const sourceOrder: string[] = ['observed', 'manual', 'inferred']

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Modal
      open={open}
      onCancel={onClose}
      labelledBy="inspect-lens-body-title"
      busy={nameSaving || confirmAllBusy}
      cardClassName="w-[480px] max-h-[80vh] flex flex-col"
      testid="inspect-lens-body-panel"
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-3 border-b border-border-default shrink-0">
        <h2
          id="inspect-lens-body-title"
          className="text-base font-semibold text-text-primary leading-tight"
        >
          {formationName}
        </h2>
        <p className="text-xs text-text-secondary mt-0.5">
          {t('sections.lensPanel.bodyLabel')}{' '}
          <span className="font-mono font-medium text-text-primary">#{target.bodyOrdinal}</span>
        </p>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">
        {/* Present investigations */}
        {presentInvestigationIds.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
              {t('sections.lens.presentAt')}
            </h3>
            <ul className="space-y-1">
              {presentInvestigationIds.map(id => (
                <li key={id} className="flex items-center gap-2 text-sm text-text-primary">
                  <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                  {investigationLabels.get(id) ?? id}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Absence evidence */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
              {t('sections.lens.absentAt')}
            </h3>
            {hasAnyInferred && (
              <button
                type="button"
                data-testid="inspect-lens-confirm-all"
                onClick={() => void handleConfirmAll()}
                disabled={confirmAllBusy}
                className="text-xs text-accent hover:text-accent-muted disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {confirmAllBusy ? t('sections.lensPanel.confirming') : t('sections.lensPanel.confirmAllAuto', { count: inferredCount })}
              </button>
            )}
          </div>

          {absencesLoading ? (
            <p className="text-xs text-text-muted italic">{t('common.loading')}</p>
          ) : absences.length === 0 ? (
            <p className="text-xs text-text-muted italic">{t('sections.lens.noAbsenceRecords')}</p>
          ) : (
            <ul className="space-y-1.5">
              {sourceOrder.flatMap(src => {
                const rows = bySource.get(src) ?? []
                return rows.map(a => {
                  const badge = SOURCE_BADGE[a.source] ?? SOURCE_BADGE.manual
                  const label = investigationLabels.get(a.investigation_id) ?? a.investigation_id
                  return (
                    <li
                      key={a.id}
                      className="flex items-center gap-2 text-sm text-text-primary"
                    >
                      <span className="w-2 h-2 rounded-full bg-red-400/70 shrink-0" />
                      <span className="flex-1 truncate">{label}</span>
                      <span
                        className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                      {a.source === 'inferred' && (
                        <button
                          type="button"
                          onClick={() => void handleConfirmAbsence(a)}
                          className="shrink-0 text-xs text-accent hover:text-accent-muted"
                          title={t('sections.lens.promoteToManual')}
                        >
                          {t('common.confirm')}
                        </button>
                      )}
                    </li>
                  )
                })
              })}
            </ul>
          )}
        </section>

        {/* Lens name */}
        <section>
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
            {t('sections.lens.name')}
          </h3>
          <div className="flex gap-2">
            <input
              ref={nameInputRef}
              type="text"
              data-testid="inspect-lens-name-input"
              value={lensName}
              onChange={e => {
                setLensName(e.target.value)
                setNameError(null)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') void handleSaveName()
              }}
              placeholder={t('sections.lens.namePlaceholder')}
              className={[
                'flex-1 text-sm rounded border px-3 py-1.5 bg-surface-overlay text-text-primary',
                'placeholder:text-text-muted focus:outline-none focus:ring-1',
                nameError
                  ? 'border-red-400 focus:ring-red-400'
                  : 'border-border-default focus:ring-accent',
              ].join(' ')}
              disabled={nameSaving}
            />
            <Button
              variant="primary"
              size="sm"
              data-testid="inspect-lens-save-name"
              onClick={() => void handleSaveName()}
              disabled={nameSaving}
            >
              {nameSaving ? t('sections.lensPanel.saving') : t('common.save')}
            </Button>
          </div>
          {nameError && (
            <p className="mt-1 text-xs text-red-500">{nameError}</p>
          )}
        </section>

        {/* Lens boundary render style (#163f Slice 2). Only meaningful once
            the lens has a body row; differences are visible once the user has
            added shaping nodes on the section. */}
        {existingLensId !== null && (
          <section data-testid="inspect-lens-style">
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
              {t('sections.lens.boundaryStyle')}
            </h3>
            <div className="flex gap-1.5">
              {(['straight', 'blocky', 'rounded'] as const).map(style => (
                <button
                  key={style}
                  type="button"
                  data-testid={`inspect-lens-style-${style}`}
                  onClick={() => void handleStyleChange(style)}
                  disabled={styleSaving}
                  className={[
                    'flex-1 text-xs rounded border px-2 py-1.5 capitalize transition-colors',
                    renderStyle === style
                      ? 'border-accent bg-accent/15 text-text-primary'
                      : 'border-border-default text-text-secondary hover:bg-surface-overlay',
                  ].join(' ')}
                >
                  {t(
                    style === 'straight'
                      ? 'sections.lens.styleStraight'
                      : style === 'blocky'
                        ? 'sections.lens.styleBlocky'
                        : 'sections.lens.styleRounded',
                  )}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {t('sections.lens.boundaryStyleHint')}
            </p>
          </section>
        )}
      </div>

      {/* Footer actions */}
      <div className="px-5 py-3 border-t border-border-default flex items-center justify-between gap-3 shrink-0">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleOfferCompanion}
          disabled={existingLensId === null}
          title={
            existingLensId === null
              ? t('sections.lensPanel.saveNameFirst')
              : t('sections.lensPanel.companionHint')
          }
        >
          {t('sections.lens.perpendicularSection')}
        </Button>
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </Modal>
  )
}
