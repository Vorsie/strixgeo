/**
 * Litho composition picker for the click-to-place litho-contact workflow.
 *
 * Opens after the user picks a depth on a borehole or CPT in the cross-section
 * when the section axis is 'lithostratigraphic'.  Presents two tabs:
 *
 *   Tab 1 "Existing units" — lists every litho formation in the active model,
 *   grouped by parent geological formation.  Litho units whose parent is null
 *   appear in an "Unassigned" group at the bottom.  Each row shows the
 *   Dutch display name from ``lithoDisplayName`` + a lithology colour
 *   swatch.  Clicking a row calls ``onSelect`` and closes the modal.
 *
 *   Tab 2 "New unit" — composition builder: a main-soil segmented control
 *   (GRIND / ZAND / SILT / KLEI / VEEN) + a growable admixture row list
 *   (soil-code dropdown, amount dropdown, "locally" checkbox, remove button) +
 *   a live ``lithoDisplayName`` preview that updates as the user builds.
 *   Confirm calls ``onCreateLithoUnit`` (which creates the formation +
 *   contact and seeds the section server-side) then closes — it does NOT
 *   chain ``onSelect`` (that would re-create the contact; review B1).
 *
 * Existing litho units carry ``parent_formation_name`` server-resolved from the
 * project formation set (Slice 5 / debt #67).  The group headings in Tab 1 are
 * derived from that field directly — no client-side join needed.  The
 * ``parentFormationName`` PROP is the geological context at the click point
 * (comes from the section's geology TIN slice); it is resolved at commit time
 * and is therefore still ``null`` for brand-new placements, which show a
 * neutral "resolved automatically" note.
 *
 * Phase-2 exclusions (do NOT add): instance_ordinal, litho_correlation_edge,
 * connect/correlate gesture, .gmproj correlation round-trip, search/filter.
 */

import { useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'

import type { AdmixtureItem, GeologicalFormationResponse } from '../../api/client'
import { log } from '../../utils/log'
import { LITHOLOGY_COLORS, LITHOLOGY_FALLBACK_COLOR } from '../../utils/lithoConstants'
import {
  admixtureAmountOptions,
  admixtureSoilOptions,
  lithoBaseLabel,
  lithoDisplayName,
} from '../../utils/lithoLabels'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { useT } from '../../i18n/translate'
import { useLanguage } from '../../i18n/languageSelect'

// ---------------------------------------------------------------------------
// Domain vocabulary — the base-lithology labels come from
// utils/lithoConstants (LITHOLOGY_LABELS) and the admixture soil / amount
// dropdown options from the shared ``admixtureSoilOptions`` /
// ``admixtureAmountOptions`` helpers, so every consumer (picker, ghost
// composition editor) reads one source of truth AND follows the UI language
// (owner ruling 2026-09-06 — the picker rendered English "Clay (KL)" in the
// Dutch UI). The option VALUE stays the raw DOV code; the label is translated
// at the presentation boundary and the raw token is the option tooltip.
// ---------------------------------------------------------------------------

const MAIN_SOIL_CODES = ['GRIND', 'ZAND', 'SILT', 'KLEI', 'VEEN'] as const
type MainSoilCode = (typeof MAIN_SOIL_CODES)[number]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Group litho formations by parent_formation_id.
 *
 * Uses ``parent_formation_name`` (server-resolved, Slice 5) as the group
 * heading when available; falls back to the ``geoFormations`` join for
 * units whose name has not yet been resolved (orphan-safe).  Groups are
 * ordered by the parent geo formation's ``display_order`` so the list
 * follows the geological column order.
 */
function groupByParent(
  lithoFormations: readonly GeologicalFormationResponse[],
  geoFormations: readonly GeologicalFormationResponse[],
): Array<{ groupName: string; parentId: string | null; formations: GeologicalFormationResponse[] }> {
  const geoById = new Map(geoFormations.map(f => [f.id, f]))
  // Map of parentId → first seen parent_formation_name (server-resolved).
  const parentNameById = new Map<string, string>()
  const grouped = new Map<string | null, GeologicalFormationResponse[]>()

  for (const f of lithoFormations) {
    const key = f.parent_formation_id ?? null
    const bucket = grouped.get(key) ?? []
    bucket.push(f)
    grouped.set(key, bucket)
    // Collect the server-resolved name if present — any unit in the group
    // carries the same parent name, so first-seen is fine.
    if (key !== null && f.parent_formation_name !== null && !parentNameById.has(key)) {
      parentNameById.set(key, f.parent_formation_name)
    }
  }

  // Build result: named geo-parent groups first, then "Unassigned".
  const result: ReturnType<typeof groupByParent> = []
  for (const [parentId, formations] of grouped) {
    if (parentId === null) continue
    // Prefer server-resolved name; fall back to geo-join name; last resort id.
    const groupName =
      parentNameById.get(parentId) ?? geoById.get(parentId)?.name ?? parentId
    result.push({ groupName, parentId, formations })
  }
  // Sort named groups by geo parent display_order so the list follows the
  // geological column order.
  result.sort((a, b) => {
    const aOrder = geoById.get(a.parentId ?? '')?.display_order ?? 0
    const bOrder = geoById.get(b.parentId ?? '')?.display_order ?? 0
    return aOrder - bOrder
  })
  // Append Unassigned group at the bottom.
  const unassigned = grouped.get(null)
  if (unassigned && unassigned.length > 0) {
    result.push({ groupName: 'Unassigned', parentId: null, formations: unassigned })
  }
  return result
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LithoCompositionPickerProps {
  open: boolean
  /** All litho-model formations — used for the "Existing units" tab. */
  lithoFormations: readonly GeologicalFormationResponse[]
  /** Geological-model formations — used for the parent-group headings. */
  geoFormations: readonly GeologicalFormationResponse[]
  /** Anchor context surfaced in the subtitle. */
  anchor: {
    kind: 'cpt' | 'borehole'
    name: string
    depth_m: number
    elevationM: number
  } | null
  /**
   * Name of the geological formation at the click depth, shown as
   * "within: <name>" (new-unit placement context).  Resolved server-side
   * from the geology TIN at commit time — the section always passes
   * ``null`` because this requires a TIN lookup that runs at commit, not
   * on click.  When ``null`` the picker shows a neutral "resolved
   * automatically" note, NOT an alarming warning (review S1).
   *
   * NOTE: this is distinct from ``parent_formation_name`` on EXISTING
   * litho units (Slice 5 / debt #67) — those are already server-resolved
   * and surfaced directly in the "Existing units" group headings.
   */
  parentFormationName: string | null
  /** Filter the "Existing units" tab to litho units whose
   *  ``parent_formation_id`` matches this id.  When non-null, only
   *  litho units within the geological formation at the click depth
   *  appear in the list — owner directive 2026-05-27 dogfeed
   *  refinement ("can you make the picker so that it only suggest
   *  litho's in the geological unit in which we're clicking?").
   *  When ``null`` (no geological formation resolved at the click,
   *  or geological backdrop absent), the unfiltered roster shows. */
  parentFormationId?: string | null
  /** Existing-unit path — called with the formation id the user picked. */
  onSelect: (formationId: string) => Promise<void> | void
  /**
   * New-unit path — called with the composed main soil code + admixtures.
   *
   * On success the caller creates the formation server-side, chains into
   * ``onSelect`` with the new id, and closes the dialog.  On failure (or when
   * the caller returns ``null``) the dialog stays open.
   */
  onCreateLithoUnit: (
    mainSoilCode: string,
    admixtures: AdmixtureItem[],
  ) => Promise<{ formationId: string } | null>
  onCancel: () => void
}

// ---------------------------------------------------------------------------
// Admixture row state
// ---------------------------------------------------------------------------

interface AdmixtureRow {
  id: number // stable React key
  soil_code: string
  amount: string
  locally: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Two-tab modal for placing a litho contact on the cross-section.
 *
 * Tab 1 "Existing units": pick from the model's litho formations.
 * Tab 2 "New unit": build a composition and create a new formation.
 */
export default function LithoCompositionPickerDialog({
  open,
  lithoFormations,
  geoFormations,
  anchor,
  parentFormationName,
  parentFormationId = null,
  onSelect,
  onCreateLithoUnit,
  onCancel,
}: LithoCompositionPickerProps): JSX.Element | null {
  const t = useT()
  // The active language, subscribed so the dropdowns re-render on a language
  // flip. The admixture soil / amount options are localised at the presentation
  // boundary (owner ruling 2026-09-06): the raw DOV code is the option value,
  // the label follows the UI language, and the raw token is the option tooltip.
  const language = useLanguage()
  const soilOptions = admixtureSoilOptions(language)
  const amountOptions = admixtureAmountOptions(language)
  // Debt #151 dogfeed refinement 2026-05-27 — filter to litho units
  // within the geological formation at the click depth.  Non-null
  // ``parentFormationId`` narrows the roster; null falls back to the
  // full list (e.g. no geological backdrop loaded).
  const filteredLithoFormations = useMemo(() => {
    if (parentFormationId === null) return lithoFormations
    return lithoFormations.filter(f => f.parent_formation_id === parentFormationId)
  }, [lithoFormations, parentFormationId])
  type Tab = 'existing' | 'new'
  const [activeTab, setActiveTab] = useState<Tab>('existing')

  // --- Tab 1 state ---
  const [busyId, setBusyId] = useState<string | null>(null)

  // --- Tab 2 state ---
  const [mainCode, setMainCode] = useState<MainSoilCode>('ZAND')
  const [admixRows, setAdmixRows] = useState<AdmixtureRow[]>([])
  const [creating, setCreating] = useState(false)
  // Per-instance monotonic id for admixture row React keys (review C1 —
  // was a module-level counter shared across all dialog instances).
  const rowIdRef = useRef(0)

  // Live preview from the current Tab 2 composition.
  const previewLabel = lithoDisplayName(
    mainCode,
    admixRows.map(r => ({ soil_code: r.soil_code, amount: r.amount, locally: r.locally })),
  )

  // Reset Tab 2 state when the dialog closes so re-opening is fresh.
  function handleCancel(): void {
    setMainCode('ZAND')
    setAdmixRows([])
    setActiveTab('existing')
    onCancel()
  }

  // --- Tab 1: existing-unit pick ---
  async function pickExisting(formationId: string): Promise<void> {
    if (busyId !== null || creating) return
    setBusyId(formationId)
    try {
      await onSelect(formationId)
      setActiveTab('existing')
    } finally {
      setBusyId(null)
    }
  }

  // --- Tab 2: admixture row management ---
  function addAdmixtureRow(): void {
    setAdmixRows(prev => [
      ...prev,
      { id: ++rowIdRef.current, soil_code: 'KL', amount: '', locally: false },
    ])
  }

  function removeAdmixtureRow(id: number): void {
    setAdmixRows(prev => prev.filter(r => r.id !== id))
  }

  function updateAdmixtureRow(
    id: number,
    patch: Partial<Omit<AdmixtureRow, 'id'>>,
  ): void {
    setAdmixRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }

  // --- Tab 2: confirm ---
  async function handleCreateConfirm(): Promise<void> {
    if (creating || busyId !== null) return
    setCreating(true)
    try {
      const admixtures: AdmixtureItem[] = admixRows.map(r => ({
        soil_code: r.soil_code,
        amount: r.amount,
        locally: r.locally,
      }))
      // Diagnostic log (dogfeed 2026-05-23 "create new layer does
      // nothing"): trace each leg of the flow so the user can pin
      // the silent-failure point from the console next time. The
      // log calls are cheap and gated on the parent's logger.
      log.debug('litho-picker', 'create confirm', { mainCode, admixtures })
      const result = await onCreateLithoUnit(mainCode, admixtures)
      log.debug('litho-picker', 'create result', { result })
      if (result !== null) {
        // onCreateLithoUnit already created the formation AND the contact
        // AND seeded the section server-side (accept-litho-suggestions +
        // applyUpdatedSection). Do NOT chain into onSelect — that re-POSTs
        // the same contact, hits DuplicateContactError (409) and fires a
        // false error toast on every successful placement (review B1).
        // The work is done; just reset Tab 2 state and close.
        handleCancel()
      } else {
        // Silent-failure surface (dogfeed 2026-05-23). The dialog
        // stays open if result is null — without this log the user
        // sees "save did nothing" with no signal why. Most common
        // cause: SectionsCanvas guard `!activeLithoModel ||
        // !selectedSection` fires (also logged backend-side).
        log.warn(
          'litho-picker',
          'onCreateLithoUnit returned null — no contact created. ' +
            'Likely cause: no active litho model OR no selected section ' +
            'at the moment the dialog confirmed. Check the section is open.',
        )
      }
    } finally {
      setCreating(false)
    }
  }

  const busy = busyId !== null || creating
  const groups = groupByParent(filteredLithoFormations, geoFormations)

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      labelledBy="litho-picker-title"
      busy={busy}
      cardClassName="w-[32rem]"
    >
      <div className="p-5">
        {/* Title */}
        <h2
          id="litho-picker-title"
          className="text-base font-semibold text-text-primary mb-1"
        >
          {t('composition.topOfWhichLithoUnit')}
        </h2>

        {/* Anchor subtitle */}
        {anchor && (
          <p className="text-xs text-text-secondary mb-2">
            {t('dialog.pickerAnchorPre')}{' '}
            <span className="font-medium text-text-primary">{anchor.name}</span>{' '}
            {t('dialog.pickerAnchorAt', {
              depth: anchor.depth_m.toFixed(2),
              taw: `${anchor.elevationM >= 0 ? '+' : ''}${anchor.elevationM.toFixed(2)}`,
            })}
          </p>
        )}

        {/* Parent-formation context / no-context warning */}
        {parentFormationName !== null ? (
          <p className="text-xs text-text-secondary mb-3">
            {t('composition.within')}{' '}
            <span className="font-medium text-text-primary">{parentFormationName}</span>
          </p>
        ) : (
          <p className="text-xs text-text-secondary mb-3">
            {t('composition.parentAutoResolved')}
          </p>
        )}

        {/* Tab bar */}
        <div className="flex border-b border-border-subtle mb-3">
          {(['existing', 'new'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              disabled={busy}
              className={[
                'px-3 py-1.5 text-xs font-medium -mb-px border-b-2 transition-colors',
                activeTab === tab
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-text-secondary hover:text-text-primary',
                busy ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              {tab === 'existing' ? t('composition.tabExisting') : t('composition.tabNew')}
            </button>
          ))}
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Tab 1 — Existing units                                           */}
        {/* ---------------------------------------------------------------- */}
        {activeTab === 'existing' && (
          <div className="max-h-72 overflow-y-auto -mx-2 px-2">
            {filteredLithoFormations.length === 0 ? (
              <p className="text-xs text-text-muted italic px-1 py-3">
                {parentFormationId !== null && lithoFormations.length > 0
                  ? t('composition.noUnitsInFormation')
                  : t('composition.noUnitsInModel')}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {groups.map(group => (
                  <div key={group.parentId ?? '__unassigned__'}>
                    <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1 px-1">
                      {group.parentId === null ? t('composition.unassigned') : group.groupName}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {group.formations.map(f => {
                        const color =
                          f.litho_main_soil_code
                            ? (LITHOLOGY_COLORS[f.litho_main_soil_code] ?? LITHOLOGY_FALLBACK_COLOR)
                            : LITHOLOGY_FALLBACK_COLOR
                        const displayName = lithoDisplayName(
                          f.litho_main_soil_code ?? '',
                          f.litho_admixtures,
                        )
                        return (
                          <li key={f.id}>
                            <button
                              onClick={() => void pickExisting(f.id)}
                              disabled={busy}
                              className={[
                                'w-full flex items-center gap-2 px-2 py-2 rounded text-left',
                                'border border-border-default hover:border-accent hover:bg-surface-page',
                                'disabled:opacity-60 disabled:cursor-not-allowed transition-colors',
                              ].join(' ')}
                            >
                              <span
                                className="inline-block w-4 h-4 rounded border border-border-default shrink-0"
                                style={{ backgroundColor: color }}
                              />
                              <span className="flex flex-col min-w-0">
                                <span className="text-xs font-medium text-text-primary truncate">
                                  {displayName || f.name}
                                </span>
                                {f.parent_formation_name !== null && (
                                  <span className="text-[10px] text-text-muted truncate">
                                    {t('composition.under', { name: f.parent_formation_name })}
                                  </span>
                                )}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Tab 2 — New unit                                                 */}
        {/* ---------------------------------------------------------------- */}
        {activeTab === 'new' && (
          <div className="flex flex-col gap-3">
            {/* Main soil segmented control */}
            <div>
              <p className="text-xs text-text-secondary mb-1.5">{t('composition.mainLithology')}</p>
              <div className="flex gap-1 flex-wrap">
                {MAIN_SOIL_CODES.map(code => {
                  const color = LITHOLOGY_COLORS[code] ?? LITHOLOGY_FALLBACK_COLOR
                  return (
                    <button
                      key={code}
                      onClick={() => setMainCode(code)}
                      disabled={busy}
                      className={[
                        'flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border transition-colors',
                        mainCode === code
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                          : 'border-border-default text-text-secondary hover:border-accent hover:bg-surface-page',
                        busy ? 'opacity-50 cursor-not-allowed' : '',
                      ].join(' ')}
                    >
                      <span
                        className="inline-block w-3 h-3 rounded-sm shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      {lithoBaseLabel(code, language)}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Admixture rows */}
            <div>
              <p className="text-xs text-text-secondary mb-1.5">{t('composition.admixtures')}</p>
              <div className="flex flex-col gap-1.5">
                {admixRows.map(row => (
                  <div key={row.id} className="flex items-center gap-1.5">
                    {/* Soil code */}
                    <select
                      value={row.soil_code}
                      onChange={e => updateAdmixtureRow(row.id, { soil_code: e.target.value })}
                      disabled={busy}
                      className="min-w-0 flex-1 text-xs border border-border-default rounded px-1.5 py-1 bg-surface-overlay text-text-primary disabled:opacity-50"
                      aria-label={t('composition.admixtureSoilCode')}
                    >
                      {soilOptions.map(opt => (
                        <option key={opt.code} value={opt.code} title={opt.title}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {/* Amount */}
                    <select
                      value={row.amount}
                      onChange={e => updateAdmixtureRow(row.id, { amount: e.target.value })}
                      disabled={busy}
                      className="min-w-0 flex-1 text-xs border border-border-default rounded px-1.5 py-1 bg-surface-overlay text-text-primary disabled:opacity-50"
                      aria-label={t('composition.admixtureAmount')}
                    >
                      {amountOptions.map(opt => (
                        <option key={opt.code} value={opt.code} title={opt.title}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {/* Locally checkbox */}
                    <label className="flex shrink-0 items-center gap-1 text-xs text-text-secondary select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={row.locally}
                        onChange={e => updateAdmixtureRow(row.id, { locally: e.target.checked })}
                        disabled={busy}
                        className="rounded"
                      />
                      {t('composition.locally')}
                    </label>
                    {/* Remove */}
                    <button
                      onClick={() => removeAdmixtureRow(row.id)}
                      disabled={busy}
                      className="shrink-0 text-text-muted hover:text-red-600 disabled:opacity-40"
                      title={t('composition.removeAdmixture')}
                      aria-label={t('composition.removeAdmixture')}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={addAdmixtureRow}
                disabled={busy}
                className="mt-1.5 flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary disabled:opacity-40"
              >
                <Plus size={11} />
                {t('composition.addAdmixture')}
              </button>
            </div>

            {/* Live preview */}
            <div className="rounded border border-border-subtle bg-surface-page px-3 py-2">
              <p className="text-[10px] text-text-muted uppercase tracking-wide mb-0.5">{t('composition.preview')}</p>
              <p
                className="text-sm font-medium text-text-primary"
                data-testid="litho-preview"
              >
                {previewLabel}
              </p>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex justify-end items-center gap-2 mt-4 pt-3 border-t border-border-subtle">
          <Button variant="secondary" size="md" onClick={handleCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          {activeTab === 'new' && (
            <Button
              variant="primary"
              size="md"
              onClick={() => void handleCreateConfirm()}
              disabled={busy}
            >
              {creating ? t('composition.creating') : t('composition.createUnit')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
