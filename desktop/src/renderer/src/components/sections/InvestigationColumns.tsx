/**
 * Investigation columns (CPTs + boreholes) drawn on the section
 * canvas — a thin wrapper around per-column ``ColumnGlyph``.
 *
 * The layout pass (``utils/columnLayout.ts``) has already nudged
 * crowded projections rightward and tagged the displaced ones; we
 * just dispatch the right shape per kind and forward the click
 * handler.
 *
 * Rendering rules (live in ``ColumnGlyph``):
 *
 *   * top at the investigation's ``elevation_m`` (faded "unknown
 *     elevation" marker at level=0 when null — engineers should
 *     know the row can't be placed vertically),
 *   * bottom at elevation - depth (or no body when depth is null),
 *   * CPT = thin vertical line + circle cap, borehole = thin line
 *     + square cap. Same shape vocabulary as the map markers so
 *     the identity reads consistently.
 *   * Name label above the cap — mode controlled by ``labelModeById``
 *     (full three-row stack, rotated id, or none). The ``full``
 *     mode is the DOV "lengteprofiel" three-row convention. The
 *     ``rotated`` mode is the gINT/Strater dense-log convention.
 *   * Tie-back diagonal when displaced: a small tick at the top of
 *     the plot at the column's true X, connected by a thin grey
 *     line to the column cap at its nudged X. Reads as "this
 *     column is drawn here but belongs there."
 *   * Native ``<title>`` tooltips on hover give the engineer the
 *     numeric depth + offset without clicking.
 */

import ColumnGlyph from './ColumnGlyph'
import type { ColumnLabelMode } from '../../utils/columnLabelLod'
import type { PlacedColumn } from './utils'

export default function InvestigationColumns({
  columns,
  levelToScreen,
  plotTop,
  plotBottom,
  onSelectCpt,
  onSelectBorehole,
  onDoubleClickCpt,
  onDoubleClickBorehole,
  onColumnContextMenu,
  hideStickIds,
  labelModeById,
  calloutIds,
  onColumnHover,
}: {
  columns: PlacedColumn[]
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
  /** Single-click handler — currently always ``undefined`` (single-click
   * is intentionally inert to avoid accidental navigation during pan). */
  onSelectCpt: ((id: string) => void) | undefined
  /** Single-click handler — always ``undefined`` for the same reason. */
  onSelectBorehole: ((id: string) => void) | undefined
  /** Double-click handler — opens the CPT detail panel. Deliberate intent
   * required; does not conflict with single-click-to-pan gestures. */
  onDoubleClickCpt?: (id: string) => void
  /** Double-click handler — opens the borehole detail panel. */
  onDoubleClickBorehole?: (id: string) => void
  /** Right-click handler — receives the React event plus the column
   * (kind + id + display name) so the caller can position a context
   * menu and dispatch the chosen action against the right test. */
  onColumnContextMenu?: (
    e: React.MouseEvent,
    column: { kind: 'cpt' | 'borehole'; id: string; name: string },
  ) => void
  /** Set of investigation IDs that already have a data band rendered
   * (CPT plot or borelog lithology strip). For these the cap + body
   * line + tie-back diagonal are redundant — the band itself is the
   * "this is where the test sits" visual — so ColumnGlyph hides the
   * stick. Name + elevation labels stay as identifiers. */
  hideStickIds?: ReadonlySet<string>
  /** Per-column label level-of-detail mode keyed by investigation id.
   * Absent entries default to ``'full'``. Computed by SectionPanel
   * from ``selectVisibleLabels`` so the LOD decision is kept out of
   * the per-column render loop. */
  labelModeById?: ReadonlyMap<string, ColumnLabelMode>
  /** Set of investigation IDs whose forced-full label (selected or
   * hovered in a dense layout) should be rendered with the callout
   * offset to avoid occlusion by adjacent columns. */
  calloutIds?: ReadonlySet<string>
  /** Hover enter/leave callback. Forwards the hovered investigation id
   * (or ``null`` on leave) up to SectionPanel so the LOD can force
   * the hovered column to full regardless of spacing. */
  onColumnHover?: (id: string | null) => void
}): JSX.Element {
  return (
    <g>
      {columns.map(col => {
        // PlacedColumn is a discriminated union (debt #28). Walking
        // each branch lets TypeScript narrow ``col.proj.item`` to
        // the right type without a cast.
        const { item, depth } =
          col.kind === 'cpt'
            ? { item: col.proj.item, depth: col.proj.item.max_depth_m }
            : { item: col.proj.item, depth: col.proj.item.total_depth_m }
        const onClick =
          col.kind === 'cpt'
            ? onSelectCpt
              ? () => onSelectCpt(item.id)
              : undefined
            : onSelectBorehole
              ? () => onSelectBorehole(item.id)
              : undefined
        const onDoubleClick =
          col.kind === 'cpt'
            ? onDoubleClickCpt
              ? () => onDoubleClickCpt(item.id)
              : undefined
            : onDoubleClickBorehole
              ? () => onDoubleClickBorehole(item.id)
              : undefined
        const onContextMenu = onColumnContextMenu
          ? (e: React.MouseEvent) =>
              onColumnContextMenu(e, {
                kind: col.kind,
                id: item.id,
                name: item.name,
              })
          : undefined
        return (
          <ColumnGlyph
            key={`${col.kind}-${item.id}`}
            name={item.name}
            kind={col.kind}
            screenX={col.nudgedX}
            tieBackTrueX={col.displaced ? col.trueX : null}
            offset={col.proj.offset}
            elevation={item.elevation_m}
            depth={depth}
            levelToScreen={levelToScreen}
            plotTop={plotTop}
            plotBottom={plotBottom}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
            hideStick={hideStickIds?.has(item.id) ?? false}
            labelMode={labelModeById?.get(item.id) ?? 'full'}
            callout={calloutIds?.has(item.id) ?? false}
            onMouseEnter={onColumnHover ? () => onColumnHover(item.id) : undefined}
            onMouseLeave={onColumnHover ? () => onColumnHover(null) : undefined}
          />
        )
      })}
    </g>
  )
}
