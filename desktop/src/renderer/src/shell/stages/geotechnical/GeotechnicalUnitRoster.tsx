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
// empty-row filter) lives in geotechUnitTree.ts so it is testable without a
// DOM. This file is the rendering.
//
// Row identity: a class row carried by exactly ONE unit IS that unit — same
// bands, same badges, same count — so it takes that unit's test ids. A class
// row carried by several takes the class key instead, and the per-unit ids move
// to the instance rows underneath.

import { useMemo, useState } from 'react'
import { useT } from '../../../i18n/translate'
import { useLanguage } from '../../../i18n/languageSelect'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'

import type {
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoLayerResponse,
} from '../../../api/client'
import { buildSourceLithoNameMap } from '../../../utils/sourceLithoNames'
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
  const t = useT()
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
        title={
          instance.bandCount === 1
            ? t('geotech.contactLabel', { count: instance.bandCount })
            : t('geotech.contactsLabel', { count: instance.bandCount })
        }
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
 * onPickColor
 *     Called with every formation id the row stands for and the chosen colour,
 *     or null to drop the choice and go back to the automatic packing colour.
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
  onPickColor,
  selectedFormationId,
}: {
  row: GeotechClassRow
  expanded: boolean
  onToggle: (key: string) => void
  onPickColor: (formationIds: readonly string[], color: string | null) => void
  selectedFormationId: string | null
}): JSX.Element {
  const t = useT()
  // A class carried by one unit IS that unit, so the row answers to that unit's
  // ids; several units share the class key instead.
  const single = row.instances.length === 1 ? row.instances[0] : null
  const idKey = single !== null ? single.formationId : row.key
  const expandable = row.instances.length > 1

  // Live colour while the wheel is open; the write happens on blur, so one
  // decision is one PATCH rather than one per drag step. Same shape as the
  // geological formation swatch in GeologyInspector.
  const [pendingColor, setPendingColor] = useState<string | null>(null)
  const shownColor = pendingColor ?? row.color

  // The ring shows on the class row whenever ANY of its units is selected, so a
  // selection inside a collapsed row is still visible without expanding. A
  // selected body always has a layer, so its unit is never one of the empty
  // ones the tree drops — the ring can always land somewhere.
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

        {/* The swatch IS the colour control (owner ruling 2026-08-26 —
            "Colours on the right hand pane need to be choosable if user
            wants"). It draws ``row.color``: the colour the engineer picked
            where he picked one, else the NAD density ramp — never the stored
            ``f.color``, which on a geotech unit is the lithology colour the
            materialiser copied. A label wrapping an sr-only native input, as
            the geological formation swatch does, so the whole 12 px square is
            the hit target. */}
        <label
          className="h-3 w-3 flex-shrink-0 cursor-pointer rounded-sm border border-border-subtle focus-within:ring-2 focus-within:ring-accent"
          style={{ backgroundColor: shownColor }}
          title={t('geotech.chooseColor', { color: shownColor })}
          data-testid={`geotech-unit-swatch-${idKey}`}
        >
          <input
            type="color"
            className="sr-only"
            value={shownColor}
            aria-label={t('geotech.colorForUnit', { label: row.label })}
            onChange={e => setPendingColor(e.currentTarget.value)}
            onBlur={() => {
              const picked = pendingColor
              setPendingColor(null)
              // Only a real change is a decision — re-opening the wheel and
              // closing it again must not write.
              if (picked !== null && picked !== row.color) {
                onPickColor(
                  row.instances.map(i => i.formationId),
                  picked,
                )
              }
            }}
            data-testid={`geotech-unit-color-input-${idKey}`}
          />
        </label>

        {/* Reversible, so it fires immediately with no confirm (docs/ux.md).
            It CLEARS the pick rather than writing today's automatic colour —
            writing it would freeze the unit at the colour its current class
            happens to have. */}
        {row.colorOverride !== null && (
          <button
            type="button"
            className="flex-shrink-0 rounded text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title={t('geotech.resetAutoColour')}
            onClick={() =>
              onPickColor(
                row.instances.map(i => i.formationId),
                null,
              )
            }
            data-testid={`geotech-unit-color-reset-${idKey}`}
          >
            <RotateCcw size={10} aria-hidden="true" />
          </button>
        )}

        <span
          className="flex-1 truncate"
          title={row.nadClass === null ? undefined : `NAD ${row.nadClass}`}
        >
          {row.label}
        </span>

        {expandable && (
          <span
            className="text-[10px] text-text-muted flex-shrink-0"
            title={t('geotech.unitsCarryClass', { count: row.instances.length })}
          >
            ×{row.instances.length}
          </span>
        )}

        <ProvenanceBadge provenance={row.provenance} nadClass={row.nadClass} idKey={idKey} />
        <ConfidenceBadge confidence={row.confidence} idKey={idKey} />

        <span
          className="text-[10px] tabular-nums text-text-muted flex-shrink-0"
          title={
            row.bandCount === 1
              ? t('geotech.contactLabel', { count: row.bandCount })
              : t('geotech.contactsLabel', { count: row.bandCount })
          }
          data-testid={`geotech-unit-contact-count-${idKey}`}
        >
          {row.bandCount}
        </span>
      </div>

      {expandable && expanded && (
        <ul className="flex flex-col gap-0.5" aria-label={t('geotech.unitsClassed', { label: row.label })}>
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
   * Commit a colour choice for every unit a row stands for; ``null`` clears the
   * choice and returns them to the automatic packing colour.
   */
  onPickColor: (formationIds: readonly string[], color: string | null) => void
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
 * Units with nothing in this model are not listed, and there is no control to
 * list them — owner ruling 2026-08-26: "if a bin is empty that means there is
 * nothing in it and nothing exists". A unit with no class but real bands is a
 * different thing entirely and stays: it is unclassified GROUND, not an empty
 * bin. See ``geotechUnitTree``'s module note for the exact predicate.
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
 * onPickColor
 *     Commits a colour choice for every unit a row stands for; null resets.
 * selectedFormationId
 *     Selected body's formation id, or null.
 *
 * Returns
 * -------
 * JSX.Element
 *     The header counter and the tree.
 */
export default function GeotechnicalUnitRoster({
  geotechFormations,
  geotechContacts,
  geotechLayers,
  lithoFormations,
  onPickColor,
  selectedFormationId = null,
}: GeotechnicalUnitRosterProps): JSX.Element {
  const t = useT()
  // Subscribe so the roster (and its language-aware unit-tree memo) re-render
  // when the interface language flips.
  const lang = useLanguage()
  // Collapsed-by-exception, not expanded-by-effect: tracking the CLOSED set
  // makes "everything open" the initial state with no effect to sync, so the
  // tree cannot briefly render collapsed while the layers load.
  const [collapsedSoils, setCollapsedSoils] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [expandedClasses, setExpandedClasses] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )

  // A geotech unit's stored name is the raw token ("KLEI (geotech)"); the roster
  // names its SOURCE litho unit instead, in English (debt #96). Shared with the
  // Parameters stage's per-unit table, which needs the identical map.
  const sourceLithoNameById = useMemo(
    () => buildSourceLithoNameMap(lithoFormations),
    [lithoFormations],
  )

  const tree = useMemo(
    () =>
      buildGeotechUnitTree({
        units: geotechFormations,
        contacts: geotechContacts,
        layers: geotechLayers,
        sourceLithoNameById,
      }),
    // ``lang``: the tree's labels come from language-aware helpers, so it must
    // rebuild when the language flips (the builder reads the language itself).
    [geotechFormations, geotechContacts, geotechLayers, sourceLithoNameById, lang],
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
          title={t('geotech.rosterBlurb')}
          data-testid="geotech-roster-summary"
        >
          {t('geotech.unitsWithBands', { count: tree.unitCount })}
        </span>
      </div>

      <ul className="flex flex-col gap-0.5" aria-label={t('geotech.nadUnits')}>
        {tree.groups.map(group => {
          const expanded = !collapsedSoils.has(group.soil)
          return (
            <li key={group.soil} className="flex flex-col">
              <button
                type="button"
                onClick={() => toggleSoil(group.soil)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                title={expanded ? t('geotech.collapseSoil') : t('geotech.expandSoil')}
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
                  {group.bandCount === 1
                    ? t('geotech.bandLabel', { count: group.bandCount })
                    : t('geotech.bandsLabel', { count: group.bandCount })}
                </span>
              </button>

              {expanded && (
                <ul
                  className="flex flex-col gap-0.5 pl-3"
                  aria-label={t('geotech.soilClasses', { soil: group.soil })}
                >
                  {group.classes.map(row => (
                    <GeotechClassRowItem
                      key={row.key}
                      row={row}
                      expanded={expandedClasses.has(row.key)}
                      onToggle={toggleClass}
                      onPickColor={onPickColor}
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
