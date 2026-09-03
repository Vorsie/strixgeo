// The unit list — the INSPECTOR half of the Parameters per-unit surface, now
// the owner-ruled body TREE (spec §1, 2026-08-27, variant B).
//
// Owner ruling R3 (2026-08-27, verbatim): "honestly i do not like the list
// view here. The statistics should be the main item, switch statistics and
// list from pane." The distribution statistics own the canvas; this pane is
// the roster the engineer picks from, and a row click drives the canvas (via
// ``coordinator.selectedParameterUnit``).
//
// THE TREE (owner ruling, verbatim: "it is best to geometrically split all
// litho bodies first. That gives you the first depth of the tree, the geotech
// subsplit then lives beneath that."):
//
//   LITHO UNIT ▸ LITHO BODY ▸ NAD CLASS ▸ GEOTECH BODY
//
// Litho units are ALWAYS listed — this is what kills the old "litho units are
// unreachable when a geotech model exists" gap, so the litho/geotech either-or
// roster (and its loading race) is GONE. ``parameterBodyTree`` owns the
// structure, the labels, the counts and the single-child collapse; this file
// renders it and owns only the expand state + the listbox a11y.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Layers } from 'lucide-react'

import { useT } from '../../../i18n/translate'
import { bodyUnionsToGroupPairs, geotechGroupOrdinals } from '../../../utils/geotechGroupOrdinals'
import { EmptyState, LoadingState } from '../../EmptyState'
import { useShell } from '../../ShellContext'
import {
  buildParameterTree,
  scopeKey,
  type ParameterTreeNode,
} from './parameterBodyTree'
import { useBodyUnions } from './useBodyUnions'
import { useModelBodies } from './useModelBodies'
import UnitGroupActionBar from './UnitGroupActionBar'
import { useUnitGrouping } from './useUnitGrouping'

/** One visible tree row after the expand state is applied. */
interface FlatRow {
  node: ParameterTreeNode
  depth: number
}

/**
 * The keys of every ancestor of the selected node (not the node itself), so a
 * jump-arrived selection expands its whole path (PU17 precedent).
 */
function ancestorsOfSelection(
  nodes: readonly ParameterTreeNode[],
  selectedKey: string | null,
): ReadonlySet<string> {
  const out = new Set<string>()
  if (selectedKey === null) return out
  const walk = (node: ParameterTreeNode, ancestors: string[]): boolean => {
    if (scopeKey(node.scope) === selectedKey) {
      for (const a of ancestors) out.add(a)
      return true
    }
    const nextAncestors = [...ancestors, scopeKey(node.scope)]
    return node.children.some(child => walk(child, nextAncestors))
  }
  nodes.forEach(node => walk(node, []))
  return out
}

/**
 * The keys of litho-body nodes that open by DEFAULT — a litho body whose only
 * child is its single packing class.
 *
 * Owner ruling 2026-09-02 (verbatim: "i see some litho bodies whose submenus i
 * cannot open ... only one packing class ... don't collapse because the
 * pakkingsdichtheid label disappears"): a single-class litho body must show
 * that class row — the pakkingsdichtheid label — without an extra click. Each
 * such key is SEEDED open once, into the real expand state (see the effect in
 * ``UnitListPane``), so the row stays a normal, fully collapsible tree node
 * rather than a force-open one with an inert chevron.
 */
function defaultOpenLithoBodyKeys(
  nodes: readonly ParameterTreeNode[],
): ReadonlySet<string> {
  const out = new Set<string>()
  const walk = (node: ParameterTreeNode): void => {
    if (
      node.scope.kind === 'litho-body' &&
      node.children.length === 1 &&
      node.children[0].scope.kind === 'geotech-class'
    ) {
      out.add(scopeKey(node.scope))
    }
    node.children.forEach(walk)
  }
  nodes.forEach(walk)
  return out
}

/** Flatten the tree to the rows currently visible, in display order. */
function flattenVisible(
  nodes: readonly ParameterTreeNode[],
  isOpen: (key: string) => boolean,
  depth: number,
): FlatRow[] {
  const rows: FlatRow[] = []
  for (const node of nodes) {
    rows.push({ node, depth })
    if (node.children.length > 0 && isOpen(scopeKey(node.scope))) {
      rows.push(...flattenVisible(node.children, isOpen, depth + 1))
    }
  }
  return rows
}

/**
 * Unit roster (the body tree) for the Parameters inspector.
 *
 * Takes no props — state is sourced from ``useShell()`` (rendered from
 * ``ParametersInspector``, a no-props stage slot).
 *
 * Returns
 * -------
 * JSX.Element
 *     The tree, a loading state while the layers are in flight, or an empty
 *     state when the project has no litho units at all.
 */
export default function UnitListPane(): JSX.Element {
  const {
    project,
    geoModel: {
      lithoFormations,
      geotechFormations,
      lithoLayers,
      geotechLayers,
      geotechLayersLoaded,
      activeLithoModel,
      activeGeotechModel,
      requestGeotechLayersRefetch,
    },
    coordinator: {
      selectedParameterUnit,
      setSelectedParameterUnit,
      bodyRecomputeLithoNonce,
      bodyRecomputeGeotechNonce,
      requestBodyRecompute,
    },
    toasts: { toast },
  } = useShell()
  const t = useT()

  // Both rosters — the body labels (and F1 homes) ride their axis's recompute
  // nonce (F9). A no-model axis fetches nothing.
  const lithoBodies = useModelBodies(
    project?.id ?? null,
    activeLithoModel?.id ?? null,
    bodyRecomputeLithoNonce,
  )
  const geotechBodies = useModelBodies(
    project?.id ?? null,
    activeGeotechModel?.id ?? null,
    bodyRecomputeGeotechNonce,
  )

  // D1: number the manual groups from the geotech model's body unions ("Join
  // with…"), then hand the map to the tree so a grouped geotech-body leaf shows
  // "(group N)". A missing/failed list degrades to no tags (``useBodyUnions``).
  const bodyUnions = useBodyUnions(
    project?.id ?? null,
    activeGeotechModel?.id ?? null,
    bodyRecomputeGeotechNonce,
  )
  const groupByBodyId = useMemo(
    () => geotechGroupOrdinals(bodyUnionsToGroupPairs(bodyUnions)),
    [bodyUnions],
  )

  // The right-pane "Group" / "Ungroup" gesture (owner finding 2026-09-03): a
  // checkbox multi-select over the geotech-body rows + a bulk bar that fires the
  // SAME body-union client the section-canvas Join uses. Called before the early
  // returns so its internal hooks stay unconditional.
  const grouping = useUnitGrouping({
    projectId: project?.id ?? null,
    geotechModelId: activeGeotechModel?.id ?? null,
    geotechLayers,
    geotechFormations: geotechFormations ?? [],
    bodyUnions,
    groupByBodyId,
    requestBodyRecompute,
    requestGeotechLayersRefetch,
    toast,
    t,
  })

  const tree = useMemo(
    () =>
      buildParameterTree({
        lithoFormations,
        geotechFormations: geotechFormations ?? [],
        lithoLayers,
        geotechLayers,
        lithoBodies,
        geotechBodies,
        groupByBodyId,
      }),
    [
      lithoFormations,
      geotechFormations,
      lithoLayers,
      geotechLayers,
      lithoBodies,
      geotechBodies,
      groupByBodyId,
    ],
  )

  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set())
  const toggleExpanded = (key: string): void => {
    setExpandedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectedKey = selectedParameterUnit === null ? null : scopeKey(selectedParameterUnit)
  const ancestorKeys = useMemo(
    () => ancestorsOfSelection(tree, selectedKey),
    [tree, selectedKey],
  )
  // Single-class litho bodies open by default so their lone packing-class row
  // (the pakkingsdichtheid label) shows without an extra click — owner ruling
  // 2026-09-02. Computed before the early returns to keep the hook order fixed.
  const autoOpenKeys = useMemo(() => defaultOpenLithoBodyKeys(tree), [tree])

  // Seed each single-class litho body OPEN once, the first time it appears in
  // the tree. Seeding into the real expand state (not a force-open override)
  // keeps the row a normal, fully collapsible node: its chevron and ArrowLeft
  // behave like every other row. The ref tracks what has already been seeded so
  // a manual collapse survives a later tree rebuild (body recompute, nonce bump)
  // — a key the user deliberately closed is never re-opened.
  const seededOpenKeys = useRef<Set<string>>(new Set())
  useEffect(() => {
    const toSeed = [...autoOpenKeys].filter(key => !seededOpenKeys.current.has(key))
    if (toSeed.length === 0) return
    for (const key of toSeed) seededOpenKeys.current.add(key)
    setExpandedKeys(prev => {
      const next = new Set(prev)
      for (const key of toSeed) next.add(key)
      return next
    })
  }, [autoOpenKeys])

  // F12 — while the geotech layers are loading, the geotech subsplit is
  // unknown; show honest loading rather than a tree that grows children the
  // moment they land. (After every hook — no early-return hook-order trap.)
  if (!geotechLayersLoaded) {
    return (
      <div className="py-6" data-testid="parameters-unit-list-loading">
        <LoadingState label={t('params.loadingUnitRoster')} />
      </div>
    )
  }

  if (tree.length === 0) {
    return (
      <EmptyState
        icon={<Layers />}
        title={t('params.noUnitsYet')}
        hint={t('params.noUnitsHintTree')}
      />
    )
  }

  const orphanTotal = tree.reduce((sum, node) => sum + (node.orphanCount ?? 0), 0)
  const isOpen = (key: string): boolean => expandedKeys.has(key) || ancestorKeys.has(key)
  const rows = flattenVisible(tree, isOpen, 0)

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="parameters-unit-list">
      <div className="px-3 py-2 border-b border-border-subtle shrink-0">
        <div className="text-[10px] uppercase tracking-wide text-text-muted">{t('params.unitsHeader')}</div>
      </div>

      {/* The bulk bar sits at the TOP of the list when a body selection is
          active (docs/ux.md: "N selected · Group · Clear"). */}
      {grouping.count > 0 && (
        <UnitGroupActionBar
          count={grouping.count}
          guard={grouping.guard}
          hasGrouped={grouping.hasGroupedInSelection}
          busy={grouping.busy}
          onGroup={grouping.group}
          onUngroup={grouping.ungroup}
          onClear={grouping.clear}
        />
      )}

      <ul role="listbox" aria-label={t('params.unitsHeader')} className="flex-1 min-h-0 overflow-auto">
        {rows.map(({ node, depth }) => {
          const key = scopeKey(node.scope)
          const expandable = node.children.length > 0
          // Only geotech bodies are groupable, so only their rows carry a
          // multi-select checkbox (the guard + the union client are body-level).
          const checkableBodyId = node.scope.kind === 'geotech-body' ? node.scope.bodyId : null
          return (
            <NodeRow
              key={key}
              node={node}
              depth={depth}
              selected={selectedKey === key}
              expandable={expandable}
              expanded={expandable && isOpen(key)}
              onSelect={() => setSelectedParameterUnit(node.scope)}
              onToggleExpand={() => toggleExpanded(key)}
              checkableBodyId={checkableBodyId}
              checked={checkableBodyId !== null && grouping.isChecked(checkableBodyId)}
              onToggleCheck={checkableBodyId !== null ? () => grouping.toggle(checkableBodyId) : undefined}
            />
          )
        })}
      </ul>

      <div className="px-3 py-2 text-[10px] text-text-muted border-t border-border-subtle shrink-0">
        {orphanTotal > 0 && (
          <div data-testid="parameters-orphan-footer">
            {/* Geotech bands with no covering litho band — never given an
                invented home in the tree (spec §1), counted honestly here. */}
            {t(orphanTotal === 1 ? 'params.orphanBandsOne' : 'params.orphanBandsMany', {
              n: orphanTotal,
            })}
          </div>
        )}
        {/* The Phase-5 note the old dash columns carried — still visible. */}
        <div className="mt-1" data-testid="parameters-unit-phase5-note">
          {t('params.phase5NoteUnitList')}
        </div>
      </div>
    </div>
  )
}

/** One selectable tree row (litho unit / litho body / class / geotech body). */
function NodeRow({
  node,
  depth,
  selected,
  expandable,
  expanded,
  onSelect,
  onToggleExpand,
  checkableBodyId,
  checked,
  onToggleCheck,
}: {
  node: ParameterTreeNode
  depth: number
  selected: boolean
  expandable: boolean
  expanded: boolean
  onSelect: () => void
  onToggleExpand: () => void
  /** The geotech body id this row can multi-select, or ``null`` (not groupable). */
  checkableBodyId: string | null
  /** Current checkbox state (only meaningful when ``checkableBodyId`` is set). */
  checked: boolean
  /** Toggle the checkbox; absent on non-groupable rows. */
  onToggleCheck?: () => void
}): JSX.Element {
  const t = useT()
  const key = scopeKey(node.scope)
  return (
    <li
      role="option"
      aria-selected={selected}
      // F11 (WCAG listbox rules): expandedness lives on the OPTION itself;
      // an expandable option states it, a leaf option states nothing.
      aria-expanded={expandable ? expanded : undefined}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
        // F11 — the keyboard path into the subtree: ArrowRight expands,
        // ArrowLeft collapses (the expander affordance is not focusable).
        if (expandable && e.key === 'ArrowRight' && !expanded) {
          e.preventDefault()
          onToggleExpand()
        }
        if (expandable && e.key === 'ArrowLeft' && expanded) {
          e.preventDefault()
          onToggleExpand()
        }
      }}
      style={{ paddingLeft: `${0.75 + depth * 0.9}rem` }}
      className={
        'pr-3 py-1.5 border-b border-border-subtle cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent ' +
        (selected ? 'bg-surface-sunken' : 'hover:bg-surface-sunken/40')
      }
      data-testid={`parameters-node-${key}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-primary">
        {/* Multi-select checkbox — geotech-body rows only (docs/ux.md: always
            visible, left of the row icon). ``tabIndex=-1`` keeps the listbox a
            single tab stop (F11); it is a mouse-first power-user affordance, and
            ``stopPropagation`` stops the click from also selecting the row. */}
        {checkableBodyId !== null && (
          <input
            type="checkbox"
            tabIndex={-1}
            checked={checked}
            aria-label={t('params.groupCheckboxAria', { label: node.label })}
            data-testid={`parameters-node-check-${key}`}
            onClick={e => e.stopPropagation()}
            onChange={() => onToggleCheck?.()}
            className="shrink-0 accent-accent cursor-pointer"
          />
        )}
        {expandable ? (
          // A SPAN, not a button (F11: no focusable descendant inside an
          // option). The option itself carries aria-expanded + the arrow keys,
          // so this is a purely visual mouse affordance, hidden from AT.
          <span
            aria-hidden="true"
            data-testid={`parameters-node-expander-${key}`}
            onClick={e => {
              e.stopPropagation()
              onToggleExpand()
            }}
            className="shrink-0 -ml-1 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-app"
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        ) : (
          <span aria-hidden="true" className="shrink-0 w-3" />
        )}
        <span className="truncate" data-testid={`parameters-node-label-${key}`}>
          {node.label}
        </span>
        {/* D1: the manual-group tag — "(group N)" — a shrink-0 SIBLING of the
            label (not nested in the truncate span) so a long label never clips
            it (owner ruling 2026-09-02; ux-reviewer 2026-09-02). */}
        {node.groupNumber != null && (
          <span
            className="ml-1 shrink-0 text-text-secondary"
            data-testid={`parameters-node-group-${key}`}
          >
            {t('geotech.groupTag', { count: node.groupNumber })}
          </span>
        )}
        <span
          className="ml-auto shrink-0 text-[10px] text-text-secondary tabular-nums"
          data-testid={`parameters-node-count-${key}`}
        >
          {/* F7: "N bands · M with cone" over exactly what the row's click
              pools, so a borehole-heavy node reads honestly. */}
          {t(node.bandCount === 1 ? 'params.nodeBandsOne' : 'params.nodeBandsMany', {
            n: node.bandCount,
            cone: node.coneBandCount,
          })}
        </span>
      </div>
    </li>
  )
}
