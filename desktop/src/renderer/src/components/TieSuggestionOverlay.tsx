/**
 * Overlay that renders auto-proposed tie-sections as green dashed ghost lines
 * on the Leaflet map.  Right-click a ghost line to Accept or Reject it via a
 * context menu (mirrors the correlation-edge right-click menu in
 * CorrelationEdgesOverlay).  No left-click action; no red reject dot.
 *
 * The context menu is rendered via ``createPortal`` into ``document.body`` so
 * it escapes the react-leaflet SVG element tree and appears at the correct
 * viewport position.  ContextMenu's ``portal="fixed"`` variant positions the
 * panel at ``clientX / clientY`` viewport coordinates, which is exactly what
 * a Leaflet ``contextmenu`` event's ``originalEvent`` carries.
 *
 * @module components/TieSuggestionOverlay
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Polyline, Tooltip } from 'react-leaflet'
import type { LeafletMouseEvent } from 'leaflet'
import ContextMenu from './ui/ContextMenu'
import { tieToLatLngLine } from '../utils/tieToLatLngLine'
import type { SuggestedTie } from '../utils/tieAutoSuggest'

// ---------------------------------------------------------------------------
// TieContextMenu
// ---------------------------------------------------------------------------

/** State stored while the menu is open. */
interface TieMenuState {
  /** Viewport X for ContextMenu portal="fixed". */
  x: number
  /** Viewport Y for ContextMenu portal="fixed". */
  y: number
  /** Index into the ties array — passed back to onAccept / onReject. */
  index: number
}

export interface TieContextMenuProps {
  /** Viewport X (clientX) for the menu anchor. */
  x: number
  /** Viewport Y (clientY) for the menu anchor. */
  y: number
  /** Index of the tie in the ties array. */
  index: number
  /** Fired when the user picks "Accept tie". */
  onAccept: (index: number) => void
  /** Fired when the user picks "Reject tie". */
  onReject: (index: number) => void
  /** Fired on outside-click or Esc. */
  onClose: () => void
}

/**
 * Accept / Reject menu for one tie ghost.
 *
 * Mirrors the correlation-edge right-click menu (EdgeContextMenu in
 * CorrelationEdgesOverlay).  Uses ContextMenu's ``portal="fixed"`` variant
 * so it positions correctly at viewport coordinates over the Leaflet map.
 *
 * Parameters
 * ----------
 * x, y
 *     Viewport coordinates (clientX / clientY) for the menu origin.
 * index
 *     Index of the tie; forwarded to onAccept / onReject unchanged.
 * onAccept
 *     Fired with ``index`` when the user picks "Accept tie".
 * onReject
 *     Fired with ``index`` when the user picks "Reject tie".
 * onClose
 *     Fired on outside-click or Esc.
 *
 * Returns
 * -------
 * JSX.Element
 *     DOM-positioned context menu (portal="fixed").
 */
export function TieContextMenu({
  x,
  y,
  index,
  onAccept,
  onReject,
  onClose,
}: TieContextMenuProps): JSX.Element {
  return (
    <ContextMenu
      portal="fixed"
      x={x}
      y={y}
      minWidth={160}
      testid="tie-context-menu"
      onClose={onClose}
      items={[
        {
          label: 'Accept tie',
          onClick: () => onAccept(index),
          testid: 'tie-context-accept',
        },
        {
          // Not danger-styled: rejecting only drops the ghost from the
          // in-memory suggestion list (no API/DB write) and is fully reversible
          // by clicking "Suggest tie-sections" again — unlike the correlation
          // menu's genuinely-destructive "Delete correlation".
          label: 'Reject tie',
          onClick: () => onReject(index),
          testid: 'tie-context-reject',
        },
      ]}
    />
  )
}

// ---------------------------------------------------------------------------
// TieSuggestionOverlay
// ---------------------------------------------------------------------------

export interface TieSuggestionOverlayProps {
  /** Auto-proposed tie-sections from the suggest algorithm. */
  ties: readonly SuggestedTie[]
  /** EPSG code for coordinate projection. */
  epsg: number
  /** Index-keyed accept handler (creates the section). */
  onAccept: (index: number) => void
  /** Index-keyed reject handler (drops the suggestion). */
  onReject: (index: number) => void
}

/**
 * Green dashed ghost tie-section proposals on the Leaflet map.
 *
 * Each polyline is right-clickable — a context menu offers "Accept tie" and
 * "Reject tie".  There is no left-click action and no red reject dot
 * (both removed in favour of the context menu).
 *
 * Drawn in the existing ``section-overlays`` pane so it participates in the
 * map's standard z-ordering.
 *
 * Parameters
 * ----------
 * ties
 *     Proposed tie-sections from the suggest algorithm.
 * epsg
 *     EPSG code used to project each tie to LatLng pairs.
 * onAccept
 *     Called with the tie's index when the user picks "Accept tie".
 * onReject
 *     Called with the tie's index when the user picks "Reject tie".
 *
 * Returns
 * -------
 * JSX.Element
 *     The polyline overlays plus an optional portal-rendered context menu.
 */
export function TieSuggestionOverlay({
  ties,
  epsg,
  onAccept,
  onReject,
}: TieSuggestionOverlayProps): JSX.Element {
  const [menu, setMenu] = useState<TieMenuState | null>(null)

  return (
    <>
      {ties.map((tie, i) => (
        <Polyline
          key={`tie-ghost-${i}`}
          positions={tieToLatLngLine(tie, epsg)}
          pane="section-overlays"
          pathOptions={{ color: '#22c55e', weight: 3, opacity: 0.75, dashArray: '7 5' }}
          eventHandlers={{
            contextmenu: (e: LeafletMouseEvent) => {
              // Prevent the browser/Leaflet default context menu and stop the
              // event from bubbling to the map (which would pan or open its own
              // menu).
              e.originalEvent.preventDefault()
              e.originalEvent.stopPropagation()
              setMenu({
                x: e.originalEvent.clientX,
                y: e.originalEvent.clientY,
                index: i,
              })
            },
          }}
        >
          {/* Discoverability: right-click is the first right-clickable thing on
              the map, so telegraph the gesture on hover (sticky = follows the
              cursor along the line). */}
          <Tooltip sticky>Proposed tie-section — right-click to Accept or Reject</Tooltip>
        </Polyline>
      ))}
      {menu !== null &&
        createPortal(
          <TieContextMenu
            x={menu.x}
            y={menu.y}
            index={menu.index}
            onAccept={idx => {
              setMenu(null)
              onAccept(idx)
            }}
            onReject={idx => {
              setMenu(null)
              onReject(idx)
            }}
            onClose={() => setMenu(null)}
          />,
          document.body,
        )}
    </>
  )
}
