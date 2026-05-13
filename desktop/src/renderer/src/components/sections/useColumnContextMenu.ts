/**
 * Right-click context menu state + handlers for the cross-section
 * (debt #30).
 *
 * Encapsulates the three things SectionPanel previously held inline:
 *
 *   * ``contextMenu`` state — the menu's container-local position +
 *     the column it was opened on. ``null`` when no menu is open.
 *   * ``handleColumnContextMenu`` — fired from a ColumnGlyph hit-box
 *     right-click (narrow 14 px strip around the column axis).
 *   * ``handleSvgContextMenu`` — wide-area fallback on the section
 *     ``<svg>``; hit-detects against the currently-visible placed
 *     columns by their nudgedX ± halfWidth, opens the menu when
 *     the cursor sits inside a column's visual band. Outside any
 *     column the browser default is still suppressed (preventDefault
 *     always) and any open menu is dismissed.
 *
 * The hook is stateless beyond the menu itself — coordination with
 * focus mode + the Esc keyboard handler stays in SectionPanel
 * because Esc spans both this hook's state and useFocusColumn's.
 */

import { useCallback, useState, type RefObject } from 'react'

import type { PlacedColumn } from './utils'

export interface ColumnContextMenuState {
  /** Container-local x where the menu's top-left renders. */
  x: number
  /** Container-local y where the menu's top-left renders. */
  y: number
  /** Column the user right-clicked. */
  kind: 'cpt' | 'borehole'
  id: string
  name: string
}

export interface UseColumnContextMenuResult {
  contextMenu: ColumnContextMenuState | null
  /** Called from ColumnGlyph's right-click hit-box. */
  handleColumnContextMenu: (
    e: React.MouseEvent,
    col: { kind: 'cpt' | 'borehole'; id: string; name: string },
  ) => void
  /** Wide-area fallback on the section ``<svg>``. */
  handleSvgContextMenu: (e: React.MouseEvent<SVGSVGElement>) => void
  /** Imperative dismiss — used by the Esc keyboard handler and the
   * menu's onClose. */
  dismiss: () => void
}

/**
 * Right-click context menu state + handlers.
 *
 * ``visibleColumns`` drives the SVG-level hit detection. ``containerRef``
 * is the relative wrapper the menu is positioned inside (the menu's
 * coordinates are container-local).
 */
export function useColumnContextMenu(
  visibleColumns: readonly PlacedColumn[],
  containerRef: RefObject<HTMLDivElement | null>,
): UseColumnContextMenuResult {
  const [contextMenu, setContextMenu] = useState<ColumnContextMenuState | null>(
    null,
  )

  const handleColumnContextMenu = useCallback(
    (
      e: React.MouseEvent,
      col: { kind: 'cpt' | 'borehole'; id: string; name: string },
    ) => {
      e.preventDefault()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      setContextMenu({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        kind: col.kind,
        id: col.id,
        name: col.name,
      })
    },
    [containerRef],
  )

  const handleSvgContextMenu = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      e.preventDefault()
      const containerRect = containerRef.current?.getBoundingClientRect()
      const svgRect = e.currentTarget.getBoundingClientRect()
      if (!containerRect) return
      const svgLocalX = e.clientX - svgRect.left
      let hit: { kind: 'cpt' | 'borehole'; id: string; name: string } | null = null
      let bestDist = Number.POSITIVE_INFINITY
      for (const col of visibleColumns) {
        const halfW = col.width / 2
        const dist = Math.abs(svgLocalX - col.nudgedX)
        if (dist <= halfW && dist < bestDist) {
          bestDist = dist
          hit = {
            kind: col.kind,
            id: col.proj.item.id,
            name: col.proj.item.name,
          }
        }
      }
      if (hit) {
        setContextMenu({
          x: e.clientX - containerRect.left,
          y: e.clientY - containerRect.top,
          kind: hit.kind,
          id: hit.id,
          name: hit.name,
        })
      } else {
        setContextMenu(null)
      }
    },
    [visibleColumns, containerRef],
  )

  const dismiss = useCallback(() => setContextMenu(null), [])

  return { contextMenu, handleColumnContextMenu, handleSvgContextMenu, dismiss }
}
