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

/** Tailwind classes for each aggregated confidence tier. */
const CONFIDENCE_BADGE_CLASS: Record<'low' | 'medium' | 'high', string> = {
  high: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  low: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
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
}: GeotechnicalUnitRowProps): JSX.Element {
  const contactCount = geotechContacts.filter(c => c.formation_id === f.id).length
  // Translate at the presentation boundary: nadClassName + nadClassColor
  // are the UI lookup fns; the raw nad_class integer is domain truth.
  const color = nadClassColor(f.nad_class)
  const label = nadClassName(f.nad_class)
  const nadLabel = f.nad_class !== null ? `NAD ${f.nad_class}` : undefined

  return (
    <li
      className="flex items-center gap-2 px-1 py-0.5 rounded text-xs text-text-primary"
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

      {/* "CPT est." badge — only on CPT-classified units (nad_class !== null).
          A null nad_class is a degenerate fallback (no CPTs for the lithology);
          the row shows a neutral swatch + no label, never a "No qc" text. */}
      {f.nad_class !== null && (
        <span
          className="text-[10px] rounded px-1 py-0 bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 flex-shrink-0"
          title="Classification derived from CPT qc series"
          data-testid={`cpt-est-badge-${f.id}`}
        >
          CPT est.
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
          {bodySelection.assignmentSource !== null && (
            <div className="mt-0.5 text-text-muted">
              {/* Display the human-readable translation; fall back to the raw token
                  if a future token is added before the lookup table is updated. */}
              Sample source:{' '}
              {ASSIGNMENT_SOURCE_LABELS[bodySelection.assignmentSource] ??
                bodySelection.assignmentSource}
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
