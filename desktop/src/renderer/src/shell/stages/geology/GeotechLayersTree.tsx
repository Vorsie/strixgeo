// Nested LAYERS legend for the geotech 3-D pane — soil ▸ NAD class ▸ body.
//
// Replaces the flat per-formation list inside Geology3DViewer's Layers panel
// when the viewed model is a geotech one (owner ruling 2026-08-26). The flat
// list degenerates there: every litho unit is subdivided into packing classes,
// so the panel becomes dozens of rows whose text is identical and whose colours
// are adjacent shades of one ramp. Three levels, closed at soil level:
//
//   ▸ SAND                       14 bodies   ← eye hides the whole family
//     ▸ medium dense                     5   ← eye hides the class
//       #0                               👁  ← eye hides one body
//
// The tree SHAPE is built by the pure ``buildGeotechLegendTree``; this module
// is presentation + expansion state only.
//
// Same tree serves Solid and Fence mode. In Fence mode the walls are keyed by
// formation, so the family/class eyes bite and the per-body eye does not (the
// solids are not rendered at all there) — the body rows stay listed there
// rather than vanishing mid-flip.
//
// WHICH rows exist is the builder's call, not this module's, and it differs per
// mode: only what the scene paints gets a row (owner ruling 2026-08-26 — "why
// are there suboptions like this ... not yet classified?"). So the row SET does
// change with the view mode, deliberately. See ``geotechLegendTree``.

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { useT } from '../../../i18n/translate'

import type {
  GeotechLegendBodyNode,
  GeotechLegendClassNode,
  GeotechLegendFamilyNode,
} from '../../../utils/geotechLegendTree'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GeotechLayersTreeProps {
  /** The grouped tree from ``buildGeotechLegendTree``. */
  tree: readonly GeotechLegendFamilyNode[]
  /** Formations currently hidden in the 3-D scene. */
  hiddenFormationIds: ReadonlySet<string>
  /** Individual bodies currently hidden in the 3-D scene. */
  hiddenBodyIds: ReadonlySet<string>
  /**
   * Hide (``hide === true``) or show every formation in ``formationIds``.
   *
   * A family / class row resolves the direction itself so the caller stays a
   * dumb set-mutator: a row with anything still visible hides everything;
   * a fully hidden row shows everything.
   */
  onToggleFormations: (formationIds: readonly string[], hide: boolean) => void
  /** Hide or show one body solid. */
  onToggleBody: (bodyId: string, hide: boolean) => void
}

// ---------------------------------------------------------------------------
// Row primitives
// ---------------------------------------------------------------------------

/** Colour chip shared by all three levels; hidden rows show an outline only. */
function Swatch({ color, hidden }: { color: string; hidden: boolean }): JSX.Element {
  return (
    <span
      data-testid="geotech-legend-swatch"
      className="inline-block w-3 h-3 rounded-sm shrink-0 border border-border-default"
      style={hidden ? { borderColor: color } : { backgroundColor: color }}
      aria-hidden="true"
    />
  )
}

/** Expand/collapse caret; rendered only when the node has children. */
function Caret({
  testId,
  expanded,
  label,
  onToggle,
}: {
  testId: string
  expanded: boolean
  label: string
  onToggle: () => void
}): JSX.Element {
  const t = useT()
  return (
    <button
      type="button"
      data-testid={testId}
      aria-expanded={expanded}
      aria-label={
        expanded ? t('geology.collapseNamed', { label }) : t('geology.expandNamed', { label })
      }
      onClick={onToggle}
      className="shrink-0 p-0.5 -m-0.5 text-text-muted hover:text-text-primary transition-colors"
    >
      {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
    </button>
  )
}

/** Placeholder that keeps a caret-less row aligned with its siblings. */
function CaretSpacer(): JSX.Element {
  return <span className="inline-block w-[11px] shrink-0" aria-hidden="true" />
}

// ---------------------------------------------------------------------------
// GeotechLayersTree
// ---------------------------------------------------------------------------

/**
 * Render the nested geotech LAYERS legend.
 *
 * Expansion state is session-ephemeral and starts fully collapsed — the owner's
 * "closed by default at soil level". It is keyed on the node keys the builder
 * emits, so a rebuild of the tree (new solids, a re-subdivision) preserves
 * whatever the user had open.
 *
 * Parameters
 * ----------
 * tree
 *     Grouped families from ``buildGeotechLegendTree``.
 * hiddenFormationIds
 *     Formations hidden in the scene — drives the family / class eye state.
 * hiddenBodyIds
 *     Bodies hidden in the scene — drives the body eye state.
 * onToggleFormations
 *     Called with every formation id under the clicked row plus the direction.
 * onToggleBody
 *     Called with the clicked body id plus the direction.
 *
 * Returns
 * -------
 * JSX.Element
 *     The ``<li>`` rows for the Layers panel list.
 */
export function GeotechLayersTree({
  tree,
  hiddenFormationIds,
  hiddenBodyIds,
  onToggleFormations,
  onToggleBody,
}: GeotechLayersTreeProps): JSX.Element {
  const t = useT()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>())

  function toggleExpanded(key: string): void {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** A group reads as hidden only when EVERY formation under it is hidden. */
  const groupHidden = (formationIds: readonly string[]): boolean =>
    formationIds.length > 0 && formationIds.every(id => hiddenFormationIds.has(id))

  function renderBody(body: GeotechLegendBodyNode): JSX.Element {
    const hidden = hiddenBodyIds.has(body.bodyId)
    return (
      <li key={body.bodyId}>
        <button
          type="button"
          data-testid={`geotech-legend-body-${body.bodyId}`}
          onClick={() => onToggleBody(body.bodyId, !hidden)}
          title={
            hidden
              ? t('geology.showBodyIn3d', { label: body.label })
              : t('geology.hideBodyIn3d', { label: body.label })
          }
          className={`w-full flex items-center gap-2 pl-10 pr-2 py-0.5 text-left hover:bg-surface-page transition-colors ${hidden ? 'opacity-50' : ''}`}
        >
          <Swatch color={body.color} hidden={hidden} />
          <span
            className={`truncate ${hidden ? 'line-through text-text-muted' : 'text-text-secondary'}`}
          >
            {body.label}
          </span>
          {body.isFlagged && (
            <AlertTriangle
              size={10}
              className="text-amber-500 shrink-0 ml-auto"
              aria-label={t('geology.underConstrainedBody')}
            />
          )}
        </button>
      </li>
    )
  }

  function renderClass(cls: GeotechLegendClassNode): JSX.Element {
    const hidden = groupHidden(cls.formationIds)
    const isOpen = expanded.has(cls.key)
    return (
      <li key={cls.key}>
        <div className="flex items-center pl-4 pr-2 py-0.5 hover:bg-surface-page transition-colors">
          {cls.bodies.length > 0 ? (
            <Caret
              testId={`geotech-legend-caret-${cls.key}`}
              expanded={isOpen}
              label={cls.label}
              onToggle={() => toggleExpanded(cls.key)}
            />
          ) : (
            <CaretSpacer />
          )}
          <button
            type="button"
            data-testid={`geotech-legend-class-${cls.key}`}
            onClick={() => onToggleFormations(cls.formationIds, !hidden)}
            title={
              hidden
                ? t('geology.showNamedIn3d', { label: cls.label })
                : t('geology.hideNamedIn3d', { label: cls.label })
            }
            className={`flex-1 min-w-0 flex items-center gap-2 pl-1.5 text-left ${hidden ? 'opacity-50' : ''}`}
          >
            <Swatch color={cls.color} hidden={hidden} />
            <span
              className={`truncate ${hidden ? 'line-through text-text-muted' : 'text-text-primary'}`}
            >
              {cls.label}
            </span>
            <span className="ml-auto pl-1 tabular-nums text-[10px] text-text-muted shrink-0">
              {cls.bodyCount}
            </span>
          </button>
        </div>
        {isOpen && cls.bodies.length > 0 && <ul>{cls.bodies.map(renderBody)}</ul>}
      </li>
    )
  }

  return (
    <>
      {tree.map(family => {
        const hidden = groupHidden(family.formationIds)
        const isOpen = expanded.has(family.key)
        return (
          <li key={family.key}>
            <div className="flex items-center px-2 py-1 hover:bg-surface-page transition-colors">
              <Caret
                testId={`geotech-legend-caret-${family.key}`}
                expanded={isOpen}
                label={family.label}
                onToggle={() => toggleExpanded(family.key)}
              />
              <button
                type="button"
                data-testid={`geotech-legend-family-${family.key}`}
                onClick={() => onToggleFormations(family.formationIds, !hidden)}
                title={
                  hidden
                    ? t('geology.showNamedIn3d', { label: family.label })
                    : t('geology.hideNamedIn3d', { label: family.label })
                }
                className={`flex-1 min-w-0 flex items-center gap-2 pl-1.5 text-left ${hidden ? 'opacity-50' : ''}`}
              >
                <Swatch color={family.color} hidden={hidden} />
                <span
                  className={`truncate font-medium ${hidden ? 'line-through text-text-muted' : 'text-text-primary'}`}
                >
                  {family.label}
                </span>
                <span className="ml-auto pl-1 tabular-nums text-[10px] text-text-muted shrink-0">
                  {family.bodyCount}
                </span>
              </button>
            </div>
            {isOpen && <ul>{family.classes.map(renderClass)}</ul>}
          </li>
        )
      })}
    </>
  )
}
