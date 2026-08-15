// Geotechnical stage inspector — roster of NAD packing units.
//
// Mirrors LithologyInspector's roster shape: reads geotechFormations from
// the geoModel bus, sorts by display_order then nad_class (ascending), and
// renders a flat <ul> of rows. Each row shows:
//   • A NAD-class colour swatch (nadClassColor — NOT f.color).
//   • The packing-class name (nadClassName) as the primary label.
//   • A "CPT est." badge when nad_class !== null (CPT-derived classification).
//   • A contact-count badge (geotechContacts filtered to this formation).
//
// Empty state: when geotechFormations is empty, guidance to run "Subdivide
// all bodies".

import { FlaskConical } from 'lucide-react'

import type {
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoLayerResponse,
} from '../../../api/client'
import { formatNadClass } from '../../../utils/formatNadClass'
import { nadClassColor, nadClassName } from '../../../utils/nadClasses'
import {
  useGeotechBodySelection,
} from '../../../utils/geotechBodySelectionStore'
import { EmptyState } from '../../EmptyState'
import { useShell } from '../../ShellContext'

// ---------------------------------------------------------------------------
// Presentation-layer constants
// ---------------------------------------------------------------------------

/**
 * Human-readable label for each CPT assignment source token.
 * Translate at the presentation boundary — store the raw backend token,
 * look up the label here.
 */
const ASSIGNMENT_SOURCE_LABELS: Record<string, string> = {
  cpt_interpolated: 'CPT interpolated',
  body_min: 'Body minimum',
  absolute_min: 'Absolute minimum',
  unresolved: 'Unresolved',
}

/**
 * Tailwind classes for each aggregated confidence tier.
 *
 * B2 (WCAG): amber is reserved for unsaved-state markers (memory
 * project_dirty_amber_color); red is reserved for errors. Use neutral slate for
 * medium (attention without error connotation) and orange for low (attention
 * without error connotation).
 */
const CONFIDENCE_BADGE_CLASS: Record<'low' | 'medium' | 'high', string> = {
  high: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  medium: 'bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-300',
  low: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
}

/** Capitalised label for a confidence tier (for badge text). */
const CONFIDENCE_LABELS: Record<'low' | 'medium' | 'high', string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Aggregate the confidence of all geotechLayers belonging to a formation.
 *
 * Rule: any 'low' → 'low'; any 'medium' (no 'low') → 'medium';
 * all 'high' → 'high'; no layers for this formation → null.
 *
 * Parameters
 * ----------
 * layers
 *     All geotech layers in the active model.
 * formationId
 *     The formation to aggregate for.
 *
 * Returns
 * -------
 * 'low' | 'medium' | 'high' | null
 *     Aggregated confidence, or null when no layers exist for the formation.
 */
function aggregateConfidence(
  layers: readonly LithoLayerResponse[],
  formationId: string,
): 'low' | 'medium' | 'high' | null {
  const fLayers = layers.filter(l => l.formation_id === formationId)
  if (fLayers.length === 0) return null
  if (fLayers.some(l => l.confidence === 'low')) return 'low'
  if (fLayers.some(l => l.confidence === 'medium')) return 'medium'
  return 'high'
}

/** Where a unit's NAD class came from, for the provenance badge. */
type ClassProvenance = 'cpt' | 'partial' | 'none'

/**
 * Classify where a unit's NAD class came from.
 *
 * The confidence a band persists IS its provenance: ``subdivide_all_bodies`` and the
 * ``cpt_interpolated`` borehole fill write 'medium' / 'high' from a real qc window,
 * while the borehole fallbacks (``body_min``, ``absolute_min`` — see
 * ``divide_boreholes._BOREHOLE_CONFIDENCE_MAP``) write 'low'.
 *
 * Aggregation is NOT worst-wins here, and that is the point. Worst-wins is right for
 * the confidence badge (one weak band weakens the unit) and wrong for provenance: a
 * unit with 141 cone bands and one fallback has emphatically had a cone in it, and
 * labelling it "No CPT" is as untrue as stamping "CPT est." on a pure fallback. The
 * mixture gets its own answer instead of being rounded to either end.
 *
 * Parameters
 * ----------
 * layers
 *     All geotech layers in the active model.
 * formationId
 *     The unit to classify.
 *
 * Returns
 * -------
 * ClassProvenance
 *     ``'cpt'`` when every band came from a qc window, ``'partial'`` when some did,
 *     ``'none'`` when none did (or the unit has no bands at all).
 */
function classifyClassProvenance(
  layers: readonly LithoLayerResponse[],
  formationId: string,
): ClassProvenance {
  const fLayers = layers.filter(l => l.formation_id === formationId)
  if (fLayers.length === 0) return 'none'
  const fromCone = fLayers.some(l => l.confidence === 'high' || l.confidence === 'medium')
  if (!fromCone) return 'none'
  return fLayers.some(l => l.confidence === 'low') ? 'partial' : 'cpt'
}

// ---------------------------------------------------------------------------
// GeotechnicalUnitRow — one NAD unit row (module scope — inner component
// re-identifies every parent render and React would unmount/remount it)
// ---------------------------------------------------------------------------

interface GeotechnicalUnitRowProps {
  /** The geotechnical formation (NAD unit) to display. */
  f: GeologicalFormationResponse
  /** All contacts in the active geotech model — used for per-unit count. */
  geotechContacts: readonly FormationContactResponse[]
  /**
   * Aggregated confidence level for this unit's layers, or null when no
   * layers exist (no badge rendered).
   */
  confidenceLevel: 'low' | 'medium' | 'high' | null
  /** Where this unit's NAD class came from — drives the provenance badge. */
  classProvenance: ClassProvenance
  /**
   * Whether this row is the currently-selected body's formation (S2 — blue
   * selection tint + ring so the roster highlights the selected body).
   */
  isSelected?: boolean
}

/**
 * One row in the geotech NAD unit roster.
 *
 * Renders a colour swatch (NAD class colour), the packing-class name, a
 * "CPT est." badge when the class is CPT-derived, and a contact-count badge.
 *
 * Parameters
 * ----------
 * f
 *     The geotechnical formation row.
 * geotechContacts
 *     All contacts in the active geotech model for per-unit contact counting.
 * confidenceLevel
 *     Aggregated confidence, or null to suppress the badge.
 * classProvenance
 *     Where the unit's class came from — ``'cpt'`` / ``'partial'`` / ``'none'``.
 *
 * Returns
 * -------
 * JSX.Element
 *     One list item.
 */
function GeotechnicalUnitRow({
  f,
  geotechContacts,
  confidenceLevel,
  classProvenance,
  isSelected = false,
}: GeotechnicalUnitRowProps): JSX.Element {
  const contactCount = geotechContacts.filter(c => c.formation_id === f.id).length
  // Translate at the presentation boundary: nadClassName + nadClassColor
  // are the UI lookup fns; the raw nad_class integer is domain truth.
  const color = nadClassColor(f.nad_class)
  const label = nadClassName(f.nad_class)
  const nadLabel = formatNadClass(null, f.nad_class) ?? undefined

  // S2: blue tint + ring when this row's formation matches the selected body.
  const selectedClass = isSelected
    ? 'bg-blue-50 ring-1 ring-blue-400 dark:bg-blue-900/20 dark:ring-blue-500'
    : ''

  return (
    <li
      className={`flex items-center gap-2 px-1 py-0.5 rounded text-xs text-text-primary ${selectedClass}`}
      data-testid={`geotech-unit-row-${f.id}`}
    >
      {/* NAD class colour swatch — nadClassColor(nad_class), NOT f.color.
          The NAD colour is the presentation truth (density ramp within each
          soil family), independent of any stored formation colour. */}
      <span
        className="h-3 w-3 flex-shrink-0 rounded-sm border border-border-subtle"
        style={{ backgroundColor: color }}
        aria-hidden="true"
        data-testid={`geotech-unit-swatch-${f.id}`}
      />

      {/* Packing-class name as primary text; raw "NAD {n}" as tooltip. */}
      <span
        className="flex-1 truncate"
        title={nadLabel}
      >
        {label}
      </span>

      {/* Provenance badge — keyed on where the BANDS came from, not on
          ``nad_class !== null``.
          A non-null NAD class does NOT imply a cone touched the soil: the
          borehole packing fill also emits ``body_min`` (the weakest class seen
          elsewhere in the body) and ``absolute_min`` (a hard-coded lithology
          floor from ``geotech_subdivision_constants``, used when the body holds
          no same-lithology CPT data at all). Both persist as confidence 'low'
          (``divide_boreholes._BOREHOLE_CONFIDENCE_MAP``), while CPT-derived
          bands persist 'high' / 'medium'. Stamping "derived from CPT qc series"
          on a fallback presents an invented value as a measured one — Data
          Integrity rules 1 and 2.
          The MIXTURE gets its own badge rather than being rounded to either
          end: on the dev model 9 of 14 units carry a single fallback band among
          dozens of cone-derived ones, and calling those "No CPT" is its own
          untrue statement (and would erase the honest badge from the roster).
          A null nad_class stays badge-free: the row is degenerate and shows a
          neutral swatch with no label. */}
      {f.nad_class !== null && classProvenance === 'cpt' && (
        <span
          className="text-[10px] rounded px-1 py-0 bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 flex-shrink-0"
          title="Classification derived from CPT qc series"
          data-testid={`cpt-est-badge-${f.id}`}
        >
          CPT est.
        </span>
      )}
      {f.nad_class !== null && classProvenance === 'partial' && (
        <span
          className="text-[10px] rounded px-1 py-0 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 flex-shrink-0"
          title="Most bands derived from CPT qc series. At least one had no cone in its body, so it took the weakest class seen there instead. Check the low-confidence bands before use."
          data-testid={`partial-cpt-badge-${f.id}`}
        >
          CPT est. (partial)
        </span>
      )}
      {f.nad_class !== null && classProvenance === 'none' && (
        <span
          className="text-[10px] rounded px-1 py-0 bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-300 flex-shrink-0"
          title="No CPT data behind this class. It took the weakest class seen in the body, or the lithology floor. Verify before use."
          data-testid={`no-cpt-badge-${f.id}`}
        >
          No CPT
        </span>
      )}

      {/* Confidence badge — aggregated from geotech layers for this unit.
          Not rendered when no layers exist (borehole-only unit or pre-subdivide). */}
      {confidenceLevel !== null && (
        <span
          className={`text-[10px] rounded px-1 py-0 ${CONFIDENCE_BADGE_CLASS[confidenceLevel]} flex-shrink-0`}
          title="Aggregated confidence of the packing-class assignment across all CPT layers"
          data-testid={`confidence-badge-${f.id}`}
        >
          {CONFIDENCE_LABELS[confidenceLevel]}
        </span>
      )}

      {/* Contact count — mirrors the litho roster badge. */}
      <span
        className="text-[10px] tabular-nums text-text-muted flex-shrink-0"
        title={`${contactCount} contact${contactCount === 1 ? '' : 's'} in this model`}
        data-testid={`geotech-unit-contact-count-${f.id}`}
      >
        {contactCount}
      </span>
    </li>
  )
}

// ---------------------------------------------------------------------------
// GeotechnicalUnitRoster — flat sorted roster
// ---------------------------------------------------------------------------

interface GeotechnicalUnitRosterProps {
  /** Geotechnical formations to display (pre-filtered to isGeotechUnit). */
  geotechFormations: readonly GeologicalFormationResponse[]
  /** All contacts in the active geotech model. */
  geotechContacts: readonly FormationContactResponse[]
  /** All geotech layers — used to aggregate per-formation confidence. */
  geotechLayers: readonly LithoLayerResponse[]
  /**
   * Formation id of the body currently selected via the sample dot (S2).
   * When set, the matching row receives a blue selection tint + ring.
   */
  selectedFormationId?: string | null
}

/**
 * Flat roster of geotechnical NAD units, ordered ascending by display_order
 * then nad_class (oldest / shallowest first — superposition convention).
 *
 * Parameters
 * ----------
 * geotechFormations
 *     NAD units derived from the project formations list.
 * geotechContacts
 *     All geotech contacts for per-unit contact counting.
 * geotechLayers
 *     All geotech layers for aggregating per-unit confidence badges.
 *
 * Returns
 * -------
 * JSX.Element
 *     The roster list element.
 */
function GeotechnicalUnitRoster({
  geotechFormations,
  geotechContacts,
  geotechLayers,
  selectedFormationId,
}: GeotechnicalUnitRosterProps): JSX.Element {
  // Sort ascending by display_order (superposition convention, oldest first),
  // then by nad_class ascending as a stable tiebreaker.
  const sorted = [...geotechFormations].sort((a, b) => {
    const byOrder = a.display_order - b.display_order
    if (byOrder !== 0) return byOrder
    const ac = a.nad_class ?? 0
    const bc = b.nad_class ?? 0
    return ac - bc
  })

  return (
    <ul className="flex flex-col gap-0.5" aria-label="Geotechnical NAD units">
      {sorted.map(f => (
        <GeotechnicalUnitRow
          key={f.id}
          f={f}
          geotechContacts={geotechContacts}
          confidenceLevel={aggregateConfidence(geotechLayers, f.id)}
          classProvenance={classifyClassProvenance(geotechLayers, f.id)}
          isSelected={selectedFormationId !== undefined && selectedFormationId !== null && f.id === selectedFormationId}
        />
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// GeotechnicalInspector — public component
// ---------------------------------------------------------------------------

/**
 * Inspector for the Geotechnical stage (F5 — NAD unit roster).
 *
 * Reads ``geotechFormations`` and ``geotechContacts`` from the shell's
 * ``geoModel`` bus and renders a flat roster of NAD packing-class units.
 * Each row shows the NAD colour swatch, the packing-class name, a "CPT est."
 * badge for CPT-derived classes, and the contact count in the active model.
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
  const {
    geoModel: { geotechFormations, geotechContacts, geotechLayers },
  } = useShell()
  // Reactive: re-renders when the engineer clicks a sample dot.
  const bodySelection = useGeotechBodySelection()

  // S2: derive the formation for the selected body so the inspector can name it
  // and highlight its roster row.
  const selectedLayer = bodySelection !== null
    ? geotechLayers.find(l => l.body_id === bodySelection.bodyId) ?? null
    : null
  const selectedFormation = selectedLayer !== null
    ? geotechFormations.find(f => f.id === selectedLayer.formation_id) ?? null
    : null

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-xs font-semibold text-text-primary">Geotech units</div>

      {geotechFormations.length === 0 ? (
        <EmptyState
          icon={<FlaskConical />}
          title="No geotech units yet"
          hint="Run 'Subdivide all bodies' to classify the lithostratigraphic units into NAD packing classes."
          compact
        />
      ) : (
        <GeotechnicalUnitRoster
          geotechFormations={geotechFormations}
          geotechContacts={geotechContacts}
          geotechLayers={geotechLayers}
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
          <span className="font-semibold text-text-primary">Selected body</span>

          {/* S2: show packing-class name + NAD number for the selected body so the
              inspector identifies the unit by name, not just by dot position. */}
          {selectedFormation !== null && (
            <div
              className="mt-0.5 font-medium text-text-secondary"
              data-testid="geotech-sample-source-formation"
            >
              {nadClassName(selectedFormation.nad_class)}
              {selectedFormation.nad_class !== null && (
                <span className="ml-1 text-text-muted font-normal">
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
              Sample source:{' '}
              <span title={bodySelection.assignmentSource}>
                {ASSIGNMENT_SOURCE_LABELS[bodySelection.assignmentSource] ??
                  bodySelection.assignmentSource}
              </span>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] leading-snug text-text-muted">
        NAD packing classes are CPT-derived estimates — verify against the
        borehole log before use.
      </p>
    </div>
  )
}
