// The geotech unit roster — soil header ▸ NAD class row ▸ unit instances.
//
// Split out of GeotechnicalInspector so neither file carries the whole stage
// (debt #201, god-component pressure). The inspector owns the panel chrome and
// the selected-body readout; this file owns the tree and its expand state; the
// badges live in geotechBadges.tsx because both levels of the tree render them.
//
// The owner approved the shape on 2026-08-26 after pasting the flat version —
// ~94 rows in which the same soil repeated dozens of times, rows with no bands
// sat between rows with hundreds, and two rendered as nothing but the
// character "0". Mockup: blend_viewer/geotech_ui_tidy_ideas.html, panel 2.
//
// The arithmetic (grouping, summed band counts, worst-badge roll-up, the
// show-empty partition) lives in geotechUnitTree.ts so it is testable without
// a DOM. This file is the rendering.
//
// Row identity: a class row carried by exactly ONE unit IS that unit — same
// bands, same badges, same count — so it takes that unit's test ids. A class
// row carried by several takes the class key instead, and the per-unit ids move
// to the instance rows underneath.

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import type {
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoLayerResponse,
} from '../../../api/client'
import { formatLithoDisplayName } from '../../../utils/lithoLabels'
import { ConfidenceBadge, ProvenanceBadge } from './geotechBadges'
import { buildGeotechUnitTree } from './geotechUnitTree'
import type { GeotechClassRow, GeotechUnitInstance } from './geotechUnitTree'

// ---------------------------------------------------------------------------
// GeotechUnitInstanceRow — one unit under a shared class row
// ---------------------------------------------------------------------------

/**
 * One unit instance, shown when its class row is expanded.
 *
 * Lean by design: the class row above already carries the swatch and the
 * rolled-up badges, so the instance adds only what differs between siblings —
 * its own name (disambiguated by source litho unit), its own band count and its
 * own badges. That difference is the reason to expand at all: the roll-up shows
 * the worst value in the group, and this is where you see which one it was.
 *
 * Parameters
 * ----------
 * instance
 *     The unit instance to render.
 * nadClass
 *     The class row's NAD class — drives whether a provenance badge applies.
 * isSelected
 *     Whether this unit is the selected body's formation.
 *
 * Returns
 * -------
 * JSX.Element
 *     One list item.
 */
function GeotechUnitInstanceRow({
  instance,
  nadClass,
  isSelected,
}: {
  instance: GeotechUnitInstance
  nadClass: number | null
  isSelected: boolean
}): JSX.Element {
  return (
    <li
      className={[
        'flex items-center gap-2 px-1 py-0.5 pl-5 rounded text-[11px] text-text-secondary',
        isSelected ? 'bg-blue-50 ring-1 ring-blue-400 dark:bg-blue-900/20 dark:ring-blue-500' : '',
      ].join(' ')}
      data-testid={`geotech-unit-row-${instance.formationId}`}
    >
      <span className="flex-1 truncate" title={instance.label}>
        {instance.label}
      </span>
      <ProvenanceBadge
        provenance={instance.provenance}
        nadClass={nadClass}
        idKey={instance.formationId}
      />
      <ConfidenceBadge confidence={instance.confidence} idKey={instance.formationId} />
      <span
        className="text-[10px] tabular-nums text-text-muted flex-shrink-0"
        title={`${instance.bandCount} contact${instance.bandCount === 1 ? '' : 's'} in this model`}
        data-testid={`geotech-unit-contact-count-${instance.formationId}`}
      >
        {instance.bandCount}
      </span>
    </li>
  )
}

// ---------------------------------------------------------------------------
// GeotechClassRowItem — one NAD class under a soil header
// ---------------------------------------------------------------------------

/**
 * One NAD-class row, with its instances when expanded.
 *
 * The label is the firmness / density word alone — the soil is the header above
 * and repeating it was most of what made the flat roster unreadable. Badges are
 * the WORST value among the row's instances so one weak unit cannot hide inside
 * a group that reads healthy.
 *
 * Parameters
 * ----------
 * row
 *     The class row from the tree builder.
 * expanded
 *     Whether the instance list is open.
 * onToggle
 *     Called with the row key when the expander is activated.
 * selectedFormationId
 *     Formation id of the selected body, or null.
 *
 * Returns
 * -------
 * JSX.Element
 *     The class row plus, when expanded, its instance list.
 */
function GeotechClassRowItem({
  row,
  expanded,
  onToggle,
  selectedFormationId,
}: {
  row: GeotechClassRow
  expanded: boolean
  onToggle: (key: string) => void
  selectedFormationId: string | null
}): JSX.Element {
  // A class carried by one unit IS that unit, so the row answers to that unit's
  // ids; several units share the class key instead.
  const single = row.instances.length === 1 ? row.instances[0] : null
  const idKey = single !== null ? single.formationId : row.key
  const expandable = row.instances.length > 1

  // The ring shows on the class row whenever ANY of its units is selected, so a
  // selection inside a collapsed row is still visible without expanding. A
  // selected body always has a layer, so its unit is never behind "show empty".
  const holdsSelection =
    selectedFormationId !== null && row.instances.some(i => i.formationId === selectedFormationId)

  return (
    <li className="flex flex-col">
      <div
        className={[
          'flex items-center gap-2 px-1 py-0.5 rounded text-xs text-text-primary',
          holdsSelection
            ? 'bg-blue-50 ring-1 ring-blue-400 dark:bg-blue-900/20 dark:ring-blue-500'
            : '',
        ].join(' ')}
        data-testid={`geotech-unit-row-${idKey}`}
      >
        {expandable ? (
          <button
            type="button"
            onClick={() => onToggle(row.key)}
            aria-expanded={expanded}
            className="flex-shrink-0 rounded text-text-muted hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title={
              expanded
                ? 'Collapse the units carrying this class'
                : `Show the ${row.instances.length} units carrying this class`
            }
            data-testid={`geotech-class-expander-${row.key}`}
          >
            {expanded ? (
              <ChevronDown size={11} aria-hidden="true" />
            ) : (
              <ChevronRight size={11} aria-hidden="true" />
            )}
          </button>
        ) : (
          // Keeps single-unit rows aligned with expandable siblings.
          <span className="w-[11px] flex-shrink-0" aria-hidden="true" />
        )}

        {/* NAD class colour swatch — nadClassColor(nad_class), NOT f.color. The
            NAD colour is the presentation truth (density ramp within each soil
            family), independent of any stored formation colour. */}
        <span
          className="h-3 w-3 flex-shrink-0 rounded-sm border border-border-subtle"
          style={{ backgroundColor: row.color }}
          aria-hidden="true"
          data-testid={`geotech-unit-swatch-${idKey}`}
        />

        <span
          className="flex-1 truncate"
          title={row.nadClass === null ? undefined : `NAD ${row.nadClass}`}
        >
          {row.label}
        </span>

        {expandable && (
          <span
            className="text-[10px] text-text-muted flex-shrink-0"
            title={`${row.instances.length} separate units carry this class`}
          >
            ×{row.instances.length}
          </span>
        )}

        <ProvenanceBadge provenance={row.provenance} nadClass={row.nadClass} idKey={idKey} />
        <ConfidenceBadge confidence={row.confidence} idKey={idKey} />

        <span
          className="text-[10px] tabular-nums text-text-muted flex-shrink-0"
          title={`${row.bandCount} contact${row.bandCount === 1 ? '' : 's'} in this model`}
          data-testid={`geotech-unit-contact-count-${idKey}`}
        >
          {row.bandCount}
        </span>
      </div>

      {expandable && expanded && (
        <ul className="flex flex-col gap-0.5" aria-label={`Units classed ${row.label}`}>
          {row.instances.map(instance => (
            <GeotechUnitInstanceRow
              key={instance.formationId}
              instance={instance}
              nadClass={row.nadClass}
              isSelected={instance.formationId === selectedFormationId}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// GeotechnicalUnitRoster — the tree
// ---------------------------------------------------------------------------

interface GeotechnicalUnitRosterProps {
  /** Geotechnical formations to display (pre-filtered to isGeotechUnit). */
  geotechFormations: readonly GeologicalFormationResponse[]
  /** Accepted contacts in the active geotech model — the band counts. */
  geotechContacts: readonly FormationContactResponse[]
  /** All geotech layers — the provenance + confidence source. */
  geotechLayers: readonly LithoLayerResponse[]
  /** Litho units, for naming a geotech unit's source when several share a class. */
  lithoFormations: readonly GeologicalFormationResponse[]
  /**
   * Formation id of the body currently selected via the sample dot (S2).
   * The row holding it receives a blue selection tint + ring.
   */
  selectedFormationId?: string | null
}

/**
 * The geotech unit roster: soil ▸ NAD class ▸ instances.
 *
 * Soil groups start EXPANDED — the NAD class row is the level an engineer works
 * at, and starting collapsed would hide it behind a click every session. Class
 * rows start collapsed; their instances are a detail you open when the
 * rolled-up badge says one of them is worth looking at.
 *
 * Units with nothing in this model are behind the "show empty" toggle rather
 * than gone. They are the ledger of ground the geotech stage has not classified
 * yet, so they stay reachable.
 *
 * Parameters
 * ----------
 * geotechFormations
 *     NAD units derived from the project formations list.
 * geotechContacts
 *     Accepted geotech contacts for the band counts.
 * geotechLayers
 *     Geotech layers for the provenance + confidence badges.
 * lithoFormations
 *     Litho units, used to name a unit's source when a class carries several.
 * selectedFormationId
 *     Selected body's formation id, or null.
 *
 * Returns
 * -------
 * JSX.Element
 *     Header counters, the show-empty toggle, and the tree.
 */
export default function GeotechnicalUnitRoster({
  geotechFormations,
  geotechContacts,
  geotechLayers,
  lithoFormations,
  selectedFormationId = null,
}: GeotechnicalUnitRosterProps): JSX.Element {
  const [showEmpty, setShowEmpty] = useState(false)
  // Collapsed-by-exception, not expanded-by-effect: tracking the CLOSED set
  // makes "everything open" the initial state with no effect to sync, so the
  // tree cannot briefly render collapsed while the layers load.
  const [collapsedSoils, setCollapsedSoils] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [expandedClasses, setExpandedClasses] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )

  // A geotech unit's stored name is the raw token ("KLEI (geotech)"); the roster
  // names its SOURCE litho unit instead, in English (debt #96).
  const sourceLithoNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of lithoFormations) {
      m.set(
        f.id,
        f.litho_main_soil_code != null
          ? formatLithoDisplayName(f.litho_main_soil_code, f.litho_admixtures)
          : f.name,
      )
    }
    return m
  }, [lithoFormations])

  const tree = useMemo(
    () =>
      buildGeotechUnitTree({
        units: geotechFormations,
        contacts: geotechContacts,
        layers: geotechLayers,
        sourceLithoNameById,
        showEmpty,
      }),
    [geotechFormations, geotechContacts, geotechLayers, sourceLithoNameById, showEmpty],
  )

  function toggleSoil(soil: string): void {
    setCollapsedSoils(prev => {
      const next = new Set(prev)
      if (next.has(soil)) next.delete(soil)
      else next.add(soil)
      return next
    })
  }

  function toggleClass(key: string): void {
    setExpandedClasses(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[10px] uppercase tracking-wide text-text-muted"
          title="Geotech units that describe ground in this model. The rest carry no bands and sit behind 'show empty'."
          data-testid="geotech-roster-summary"
        >
          {tree.unitCount} with bands
        </span>
        {/* Reversible view state — fires immediately, no confirm (docs/ux.md). */}
        {tree.emptyCount > 0 && (
          <button
            type="button"
            onClick={() => setShowEmpty(v => !v)}
            aria-pressed={showEmpty}
            className="flex-shrink-0 rounded text-[10px] text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title={
              showEmpty
                ? 'Hide units with nothing in this model'
                : 'Show units with nothing in this model — ground the geotech stage has not classified yet'
            }
            data-testid="geotech-show-empty-toggle"
          >
            {showEmpty ? 'hide empty' : `show empty (${tree.emptyCount})`}
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-0.5" aria-label="Geotechnical NAD units">
        {tree.groups.map(group => {
          const expanded = !collapsedSoils.has(group.soil)
          return (
            <li key={group.soil} className="flex flex-col">
              <button
                type="button"
                onClick={() => toggleSoil(group.soil)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                title={expanded ? 'Collapse this soil' : 'Expand this soil'}
                data-testid={`geotech-soil-header-${group.soil}`}
              >
                {expanded ? (
                  <ChevronDown size={11} className="text-text-muted" aria-hidden="true" />
                ) : (
                  <ChevronRight size={11} className="text-text-muted" aria-hidden="true" />
                )}
                <span className="flex-1 truncate text-[11px] font-semibold text-text-primary">
                  {group.soil}
                </span>
                <span className="flex-shrink-0 text-[10px] tabular-nums text-text-muted">
                  {group.bandCount} band{group.bandCount === 1 ? '' : 's'}
                </span>
              </button>

              {expanded && (
                <ul className="flex flex-col gap-0.5 pl-3" aria-label={`${group.soil} classes`}>
                  {group.classes.map(row => (
                    <GeotechClassRowItem
                      key={row.key}
                      row={row}
                      expanded={expandedClasses.has(row.key)}
                      onToggle={toggleClass}
                      selectedFormationId={selectedFormationId}
                    />
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
