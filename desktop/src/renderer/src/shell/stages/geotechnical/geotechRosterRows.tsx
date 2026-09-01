// The two row renderers for the geotech units roster: the litho-body node (L2)
// and the packing-body leaf (L3).
//
// Split out of GeotechnicalUnitRoster so that file stays under the 500-line
// god-component cap (debt #201) and reads as the tree wiring alone. The badges
// these rows put on a leaf live in geotechBadges.tsx; the tree arithmetic lives
// in geotechUnitTree.ts.

import { useState } from 'react'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'

import { useT } from '../../../i18n/translate'
import { ConfidenceBadge, ProvenanceBadge } from './geotechBadges'
import type { GeotechLithoBodyNode, GeotechPackingBody } from './geotechUnitTree'

// ---------------------------------------------------------------------------
// GeotechPackingBodyRow — one selectable packing (geotech) body, the leaf
// ---------------------------------------------------------------------------

/**
 * One selectable packing body (L3 leaf).
 *
 * Clicking the body's label selects it — the same geotech-body selection the
 * section fade and the inspector's readout read (owner dogfeed 2026-09-01:
 * "i can only see packing but can't select the subbodies there"). A picked
 * colour is edited on the leaf: the swatch writes the body's HOME geotech unit's
 * ``color_override``, since the colour is a per-class (per-unit) property.
 *
 * The swatch and the select action are SIBLINGS, not nested — an interactive
 * ``<input>`` inside a ``<button>`` is invalid, so the row is a flex ``<li>``.
 *
 * Parameters
 * ----------
 * body
 *     The packing-body leaf from the tree builder.
 * isSelected
 *     Whether this body is the selected one (carries the selection ring).
 * onSelect
 *     Fired with the body id on click; absent → the label is inert.
 * onPickColor
 *     Commits a colour choice for the body's home unit; ``null`` clears it.
 *
 * Returns
 * -------
 * JSX.Element
 *     One list item.
 */
export function GeotechPackingBodyRow({
  body,
  isSelected,
  onSelect,
  onPickColor,
}: {
  body: GeotechPackingBody
  isSelected: boolean
  onSelect?: (bodyId: string) => void
  onPickColor: (formationIds: readonly string[], color: string | null) => void
}): JSX.Element {
  const t = useT()
  // Live colour while the wheel is open; the write happens on blur, so one
  // decision is one PATCH rather than one per drag step.
  const [pendingColor, setPendingColor] = useState<string | null>(null)
  const shownColor = pendingColor ?? body.color

  return (
    <li
      className="flex items-center gap-2 pl-5"
      data-testid={`geotech-body-leaf-${body.bodyId}`}
    >
      {/* The swatch IS the colour control (owner ruling 2026-08-26). It draws
          ``body.color``: the picked colour where one was chosen, else the NAD
          density ramp. A label wrapping an sr-only native input, so the whole
          square is the hit target. */}
      <label
        className="h-3 w-3 flex-shrink-0 cursor-pointer rounded-sm border border-border-subtle focus-within:ring-2 focus-within:ring-accent"
        style={{ backgroundColor: shownColor }}
        title={t('geotech.chooseColor', { color: shownColor })}
        data-testid={`geotech-body-swatch-${body.bodyId}`}
      >
        <input
          type="color"
          className="sr-only"
          value={shownColor}
          // The swatch edits the whole HOME UNIT (every body of this class), so
          // its accessible name must name the unit ("SILT · SF"), not this one
          // body ("SILT · SF #0") — that would imply a per-body edit it does not
          // make (ux-reviewer 2026-09-01).
          aria-label={t('geotech.colorForUnit', { label: body.unitLabel })}
          onChange={e => setPendingColor(e.currentTarget.value)}
          onBlur={() => {
            const picked = pendingColor
            setPendingColor(null)
            // Only a real change is a decision — re-opening the wheel and
            // closing it again must not write.
            if (picked !== null && picked !== body.color) onPickColor([body.unitId], picked)
          }}
          data-testid={`geotech-body-color-input-${body.bodyId}`}
        />
      </label>

      {/* Reversible, so it fires immediately with no confirm (docs/ux.md). It
          CLEARS the pick rather than writing today's automatic colour. */}
      {body.colorOverride !== null && (
        <button
          type="button"
          className="flex-shrink-0 rounded text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          title={t('geotech.resetAutoColour')}
          onClick={() => onPickColor([body.unitId], null)}
          data-testid={`geotech-body-color-reset-${body.bodyId}`}
        >
          <RotateCcw size={10} aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        onClick={() => onSelect?.(body.bodyId)}
        aria-pressed={isSelected}
        className={[
          'flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] text-text-secondary transition-colors',
          isSelected
            ? 'bg-blue-50 ring-1 ring-blue-400 dark:bg-blue-900/20 dark:ring-blue-500'
            : 'hover:bg-surface-sunken/40',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        ].join(' ')}
        data-testid={`geotech-body-row-${body.bodyId}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate" title={body.label}>
            {body.label}
            {/* D4: the manual-group tag — "(group N)" — when the body was joined
                into a multi-member group ("Join with…" verb). */}
            {body.groupNumber !== null && (
              <span
                className="ml-1 text-text-muted"
                data-testid={`geotech-body-group-${body.bodyId}`}
              >
                {t('geotech.groupTag', { count: body.groupNumber })}
              </span>
            )}
          </span>
          {body.geoFormations.length > 0 && (
            <span
              className="block truncate text-[10px] font-normal text-text-muted"
              title={body.geoFormations.join(' + ')}
              data-testid={`geotech-body-geo-${body.bodyId}`}
            >
              {body.geoFormations.join(' + ')}
            </span>
          )}
        </span>
        <ProvenanceBadge provenance={body.provenance} nadClass={body.nadClass} idKey={body.bodyId} />
        <ConfidenceBadge confidence={body.confidence} idKey={body.bodyId} />
        <span
          className="text-[10px] tabular-nums text-text-muted flex-shrink-0"
          title={
            body.bandCount === 1
              ? t('geotech.contactLabel', { count: body.bandCount })
              : t('geotech.contactsLabel', { count: body.bandCount })
          }
          data-testid={`geotech-body-contact-count-${body.bodyId}`}
        >
          {body.bandCount}
        </span>
      </button>
    </li>
  )
}

// ---------------------------------------------------------------------------
// GeotechLithoBodyGroup — one geometrically-disconnected litho body, the L2 node
// ---------------------------------------------------------------------------

/**
 * One litho-body node (L2), with its packing bodies when expanded.
 *
 * The label reads the way a litho body reads everywhere else ("SILT · #0") so
 * the pane, the CS jump breadcrumb and the body-menu name the same mass. The
 * fallback bucket (``lithoBodyId === null``, a packing body whose litho parent
 * is not yet stamped) shows a neutral "No litho body" label instead.
 *
 * Parameters
 * ----------
 * node
 *     The litho-body node from the tree builder.
 * expanded
 *     Whether the packing-body list is open.
 * onToggle
 *     Called with the node key when the expander is activated.
 * selectedBodyId
 *     The selected packing body id, for the leaf selection ring.
 * onSelectBody
 *     Select a packing body.
 * onPickColor
 *     Colour edit, forwarded to the leaf swatch.
 *
 * Returns
 * -------
 * JSX.Element
 *     The node row plus, when expanded, its packing-body list.
 */
export function GeotechLithoBodyGroup({
  node,
  expanded,
  onToggle,
  selectedBodyId,
  onSelectBody,
  onPickColor,
}: {
  node: GeotechLithoBodyNode
  expanded: boolean
  onToggle: (key: string) => void
  selectedBodyId: string | null
  onSelectBody?: (bodyId: string) => void
  onPickColor: (formationIds: readonly string[], color: string | null) => void
}): JSX.Element {
  const t = useT()
  const label = node.lithoBodyId === null ? t('geotech.noLithoBody') : node.label
  // The ring shows on the node when the selected body is one of its leaves, so a
  // selection inside a collapsed node stays visible without expanding.
  const holdsSelection =
    selectedBodyId !== null && node.packingBodies.some(p => p.bodyId === selectedBodyId)

  return (
    <li className="flex flex-col">
      <div
        className={[
          'flex items-center gap-2 rounded px-1 py-0.5 text-xs text-text-primary',
          holdsSelection
            ? 'bg-blue-50 ring-1 ring-blue-400 dark:bg-blue-900/20 dark:ring-blue-500'
            : '',
        ].join(' ')}
        data-testid={`geotech-litho-body-${node.key}`}
      >
        <button
          type="button"
          onClick={() => onToggle(node.key)}
          aria-expanded={expanded}
          className="flex-shrink-0 rounded text-text-muted hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          title={expanded ? t('geotech.collapseLithoBody') : t('geotech.expandLithoBody')}
          data-testid={`geotech-litho-body-expander-${node.key}`}
        >
          {expanded ? (
            <ChevronDown size={11} aria-hidden="true" />
          ) : (
            <ChevronRight size={11} aria-hidden="true" />
          )}
        </button>
        <span className="flex-1 truncate" title={label}>
          {label}
        </span>
        {/* When collapsed, the worst-wins roll-up keeps the "No CPT" exception
            (and confidence) visible without expanding the node — the badges
            otherwise ride the individual leaves (ux-reviewer 2026-09-01). */}
        {!expanded && (
          <>
            <ProvenanceBadge provenance={node.provenance} nadClass={node.nadClass} idKey={node.key} />
            <ConfidenceBadge confidence={node.confidence} idKey={node.key} />
          </>
        )}
        <span
          className="text-[10px] tabular-nums text-text-muted flex-shrink-0"
          title={
            node.bandCount === 1
              ? t('geotech.contactLabel', { count: node.bandCount })
              : t('geotech.contactsLabel', { count: node.bandCount })
          }
          data-testid={`geotech-litho-body-count-${node.key}`}
        >
          {node.bandCount}
        </span>
      </div>

      {expanded && (
        <ul
          className="flex flex-col gap-0.5"
          aria-label={t('geotech.packingBodiesIn', { label })}
        >
          {node.packingBodies.map(body => (
            <GeotechPackingBodyRow
              key={body.bodyId}
              body={body}
              isSelected={body.bodyId === selectedBodyId}
              onSelect={onSelectBody}
              onPickColor={onPickColor}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
