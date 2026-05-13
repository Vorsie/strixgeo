/**
 * Focus mode state + viewport-snap logic for the cross-section
 * (debt #30).
 *
 * Encapsulates SectionPanel's previous inline state:
 *
 *   * ``focusedColumn`` — the column currently in focus, or
 *     ``null`` for the normal multi-column view.
 *   * ``preFocusViewportRef`` / ``preFocusVexRef`` — snapshot of
 *     the viewport + VEX captured the first time the user enters
 *     focus, so ``exitFocus`` can restore it. Lives in refs, not
 *     state — the render path doesn't observe them.
 *   * ``enterFocus`` — snaps the viewport to a 40 m horizontal
 *     window centred on the column's projected along-distance and
 *     fits the vertical extent to the test's depth range. Sets
 *     VEX to 1.0 so proportions read naturally.
 *   * ``exitFocus`` — restores the snapshot + clears focus state.
 *
 * Event-driven by design (not effect-driven) — the previous
 * implementation had to stale-read viewport / vex / placedColumns
 * from closure inside a useEffect, which is exactly the pattern
 * that bites in subtle ways. With plain useCallbacks the current
 * values are captured naturally through the React closure on each
 * render (debt #21 resolved this; #30 just moves it).
 *
 * Sub-focus chains (entering focus on B while already focused on A)
 * preserve A's original snapshot as the eventual restore target —
 * ``preFocusViewportRef.current = viewport`` only fires when the
 * ref is ``null``, so subsequent enterFocus calls don't clobber the
 * truly-original framing.
 */

import { useCallback, useRef, useState } from 'react'

import type {
  BoreholeListItem,
  CptListItem,
} from '../../api/client'
import type { PlacedColumn, Viewport } from './utils'

// Horizontal window width (m) the focused view snaps to, centred on
// the column's projected along-distance. Wide enough to give the
// column band breathing room, narrow enough that the test reads as
// the obvious subject.
const FOCUS_X_HALF_WIDTH_M = 20

// Fallback test depth when the row has no max/total depth recorded —
// gives the focus zoom *something* sensible to fit against rather
// than collapsing to the surface.
const FOCUS_DEFAULT_DEPTH_M = 30

// Vertical padding (m) above the surface + below the test bottom
// when fitting the focused view. Keeps the column caps off the plot
// edge.
const FOCUS_LEVEL_PADDING_M = 2

export interface FocusTarget {
  kind: 'cpt' | 'borehole'
  id: string
  name: string
}

export interface UseFocusColumnResult {
  focusedColumn: FocusTarget | null
  /** Enter focus mode on the named column. No-ops when the column
   * isn't currently placed (e.g. it's been removed from the
   * project since the right-click event fired). */
  enterFocus: (target: FocusTarget) => void
  /** Exit focus mode — restore the pre-focus viewport + VEX if
   * captured. Safe to call when not in focus (no-op). */
  exitFocus: () => void
}

/**
 * Focus-column state + auto-zoom callbacks.
 *
 * Consumers pass setViewport + setVex so the hook can mutate the
 * parent's viewport state without owning it. ``placedColumns`` /
 * ``viewport`` / ``vex`` are read at callback-invocation time, so
 * the closure values stay current — no stale-read bugs.
 */
export function useFocusColumn(
  placedColumns: readonly PlacedColumn[],
  viewport: Viewport,
  vex: number,
  setViewport: (next: Viewport) => void,
  setVex: (next: number) => void,
): UseFocusColumnResult {
  const [focusedColumn, setFocusedColumn] = useState<FocusTarget | null>(null)

  // Snapshots live in refs (not state) because nothing renders
  // them — they're written on enter, read on exit.
  const preFocusViewportRef = useRef<Viewport | null>(null)
  const preFocusVexRef = useRef<number | null>(null)

  const enterFocus = useCallback(
    (target: FocusTarget) => {
      const col = placedColumns.find(
        c => c.kind === target.kind && c.proj.item.id === target.id,
      )
      if (!col) return
      // Only snapshot when not already in focus mode — sub-focus
      // chains preserve the truly-original framing as the restore
      // target.
      if (preFocusViewportRef.current === null) {
        preFocusViewportRef.current = viewport
        preFocusVexRef.current = vex
      }
      const elevation = col.proj.item.elevation_m
      const depth =
        col.kind === 'cpt'
          ? (col.proj.item as CptListItem).max_depth_m
          : (col.proj.item as BoreholeListItem).total_depth_m
      let newLevelMin = viewport.levelMin
      let newLevelMax = viewport.levelMax
      if (elevation !== null) {
        const dEff = depth ?? FOCUS_DEFAULT_DEPTH_M
        newLevelMax = elevation + FOCUS_LEVEL_PADDING_M
        newLevelMin = elevation - dEff - FOCUS_LEVEL_PADDING_M
      }
      setViewport({
        xMin: col.proj.along - FOCUS_X_HALF_WIDTH_M,
        xMax: col.proj.along + FOCUS_X_HALF_WIDTH_M,
        levelMin: newLevelMin,
        levelMax: newLevelMax,
      })
      setVex(1.0)
      setFocusedColumn(target)
    },
    [placedColumns, viewport, vex, setViewport, setVex],
  )

  const exitFocus = useCallback(() => {
    if (preFocusViewportRef.current !== null) {
      setViewport(preFocusViewportRef.current)
      preFocusViewportRef.current = null
    }
    if (preFocusVexRef.current !== null) {
      setVex(preFocusVexRef.current)
      preFocusVexRef.current = null
    }
    setFocusedColumn(null)
  }, [setViewport, setVex])

  return { focusedColumn, enterFocus, exitFocus }
}
