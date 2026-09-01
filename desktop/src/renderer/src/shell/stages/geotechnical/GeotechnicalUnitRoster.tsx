// The geotech unit roster — soil header ▸ litho body ▸ packing body.
//
// Owner ruling 2026-08-31 (walk interview), verbatim: "main litho is first
// level, one down is all litho bodies that are geometrically disconnected, one
// down is all disconnected packing bodies. Then if you group they get like a
// group 1 in parentheses behind." So the axis is three levels: the main litho
// (soil) header, one node per geometrically-disconnected LITHO body under it,
// and the selectable PACKING (geotech) bodies under each litho body.
//
// Split out of GeotechnicalInspector so neither file carries the whole stage
// (debt #201). The inspector owns the panel chrome and the selected-body
// readout; this file owns the tree and its expand state; the badges live in
// geotechBadges.tsx. The arithmetic (grouping, band-count roll-up, ordering, the
// group tag) lives in geotechUnitTree.ts so it is testable without a DOM.

import { useMemo, useState } from 'react'
import { useT } from '../../../i18n/translate'
import { useLanguage } from '../../../i18n/languageSelect'
import { ChevronDown, ChevronRight } from 'lucide-react'

import type {
  BodyListItem,
  BodyUnionListItem,
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoLayerResponse,
} from '../../../api/client'
import { geotechGroupOrdinals } from './geotechGroupOrdinals'
import { GeotechLithoBodyGroup } from './geotechRosterRows'
import { buildGeotechUnitTree } from './geotechUnitTree'

// ---------------------------------------------------------------------------
// GeotechnicalUnitRoster — the tree
// ---------------------------------------------------------------------------

interface GeotechnicalUnitRosterProps {
  /** Geotechnical formations to display (pre-filtered to isGeotechUnit). */
  geotechFormations: readonly GeologicalFormationResponse[]
  /** Accepted contacts in the active geotech model — the header count. */
  geotechContacts: readonly FormationContactResponse[]
  /** All geotech layers — the leaf band counts + badges. */
  geotechLayers: readonly LithoLayerResponse[]
  /** Litho units, for composing the L2 litho-body label. */
  lithoFormations: readonly GeologicalFormationResponse[]
  /** The geotech model's bodies (``GET .../bodies``) — the L3 leaves. */
  geotechBodies?: readonly BodyListItem[]
  /**
   * The LITHO model's bodies keyed by id (``GET .../bodies`` on the parent litho
   * model, debt #278 D2) — the L2 nodes. Absent → every stamped packing body
   * still groups by its ``parent_litho_body_id``, but the L2 label degrades to
   * an id prefix.
   */
  lithoBodies?: ReadonlyMap<string, BodyListItem>
  /**
   * The geotech model's manual body unions (``GET .../body-unions``, debt #278
   * D4) — the source of the "(group N)" leaf tag. Absent → no tags.
   */
  bodyUnions?: readonly BodyUnionListItem[]
  /**
   * Commit a colour choice for every unit a swatch stands for; ``null`` clears
   * the choice and returns them to the automatic packing colour.
   */
  onPickColor: (formationIds: readonly string[], color: string | null) => void
  /** The selected geotech body id — the matching leaf receives the selection ring. */
  selectedBodyId?: string | null
  /** Select a geotech body (a leaf click). Absent → the leaves are read-only. */
  onSelectBody?: (bodyId: string) => void
}

/**
 * The geotech unit roster: soil ▸ litho body ▸ packing body.
 *
 * Soil groups and litho-body nodes both start EXPANDED — the owner's complaint
 * was that he could not SEE the packing bodies to select them, so the leaves are
 * visible by default; collapsing is collapsed-by-exception (a CLOSED set), so
 * the tree never briefly renders collapsed while the rosters load.
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
  geotechBodies,
  lithoBodies,
  bodyUnions,
  onPickColor,
  selectedBodyId = null,
  onSelectBody,
}: GeotechnicalUnitRosterProps): JSX.Element {
  const t = useT()
  // Subscribe so the roster (and its language-aware unit-tree memo) re-render
  // when the interface language flips.
  const lang = useLanguage()
  const [collapsedSoils, setCollapsedSoils] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [collapsedBodies, setCollapsedBodies] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )

  // Litho unit id → display name, so the L2 litho-body label reads "SILT · #0".
  const lithoUnitNameById = useMemo(
    () => new Map(lithoFormations.map(f => [f.id, f.name])),
    [lithoFormations],
  )

  // The roster's reduced view of the geotech body list — id, home unit, ordinal,
  // name, litho parent and crossed formations. The builder homes each under its
  // parent litho body.
  const bodyRefs = useMemo(
    () =>
      (geotechBodies ?? []).map(b => ({
        id: b.id,
        formation_id: b.formation_id,
        body_ordinal: b.body_ordinal,
        name: b.name,
        parentLithoBodyId: b.parent_litho_body_id ?? null,
        geoFormations: (b.geo_formations ?? []).map(g => g.name),
      })),
    [geotechBodies],
  )

  // D4: the manual-group numbers, derived from the union pairs' current bodies.
  const groupByBodyId = useMemo(
    () =>
      geotechGroupOrdinals(
        (bodyUnions ?? []).map(u => ({
          a: { bodyId: u.anchor_a.body_id, bodyOrdinal: u.anchor_a.body_ordinal },
          b: { bodyId: u.anchor_b.body_id, bodyOrdinal: u.anchor_b.body_ordinal },
        })),
      ),
    [bodyUnions],
  )

  const tree = useMemo(
    () =>
      buildGeotechUnitTree({
        units: geotechFormations,
        contacts: geotechContacts,
        layers: geotechLayers,
        bodies: bodyRefs,
        lithoBodies,
        lithoUnitNameById,
        groupByBodyId,
      }),
    // ``lang``: the tree's labels come from language-aware helpers, so it must
    // rebuild when the language flips.
    [
      geotechFormations,
      geotechContacts,
      geotechLayers,
      bodyRefs,
      lithoBodies,
      lithoUnitNameById,
      groupByBodyId,
      lang,
    ],
  )

  function toggleSoil(soil: string): void {
    setCollapsedSoils(prev => {
      const next = new Set(prev)
      if (next.has(soil)) next.delete(soil)
      else next.add(soil)
      return next
    })
  }

  function toggleBody(key: string): void {
    setCollapsedBodies(prev => {
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

      <ul className="flex flex-col gap-0.5" aria-label={t('geotech.soilGroups')}>
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
                  aria-label={t('geotech.soilBodies', { soil: group.soil })}
                >
                  {group.lithoBodies.map(node => (
                    <GeotechLithoBodyGroup
                      key={node.key}
                      node={node}
                      expanded={!collapsedBodies.has(node.key)}
                      onToggle={toggleBody}
                      selectedBodyId={selectedBodyId}
                      onSelectBody={onSelectBody}
                      onPickColor={onPickColor}
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
