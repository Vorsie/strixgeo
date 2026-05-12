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
 *   * Name label above the cap (no rotation — symbol labels handle
 *     collision via the nudge pass, not in-place rotation).
 *   * Tie-back diagonal when displaced: a small tick at the top of
 *     the plot at the column's true X, connected by a thin grey
 *     line to the column cap at its nudged X. Reads as "this
 *     column is drawn here but belongs there."
 *   * Native ``<title>`` tooltips on hover give the engineer the
 *     numeric depth + offset without clicking.
 */

import type { BoreholeListItem, CptListItem } from '../../api/client'
import ColumnGlyph from './ColumnGlyph'
import type { PlacedColumn } from './utils'

export default function InvestigationColumns({
  columns,
  levelToScreen,
  plotTop,
  plotBottom,
  onSelectCpt,
  onSelectBorehole,
  hideStickIds,
}: {
  columns: PlacedColumn[]
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
  onSelectCpt: ((id: string) => void) | undefined
  onSelectBorehole: ((id: string) => void) | undefined
  /** Set of investigation IDs that already have a data band rendered
   * (CPT plot or borelog lithology strip). For these the cap + body
   * line + tie-back diagonal are redundant — the band itself is the
   * "this is where the test sits" visual — so ColumnGlyph hides the
   * stick. Name + elevation labels stay as identifiers. */
  hideStickIds?: ReadonlySet<string>
}): JSX.Element {
  return (
    <g>
      {columns.map(col => {
        const item = col.proj.item
        const depth =
          col.kind === 'cpt'
            ? (item as CptListItem).max_depth_m
            : (item as BoreholeListItem).total_depth_m
        const onClick =
          col.kind === 'cpt'
            ? onSelectCpt
              ? () => onSelectCpt(item.id)
              : undefined
            : onSelectBorehole
              ? () => onSelectBorehole(item.id)
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
            hideStick={hideStickIds?.has(item.id) ?? false}
          />
        )
      })}
    </g>
  )
}
