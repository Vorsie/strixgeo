// Lithology stage inspector — model picker, stale-surface banner,
// read-only formation roster grouped under geological parents, and
// workflow guidance footer.
//
// Slice C of #55 litho peer-stage scaffolding.
// Phase 1 update: lithoFormations roster is now grouped under parent
// geological formations ordered ascending by display_order (oldest
// first, matching the geological superposition convention used by all
// other renderers). Litho units without a parent_formation_id are
// collected under an "Unassigned" group at the bottom.
//
// Design decisions (system-architect):
//   • ModelKindPicker unchanged at top (model select/create lifecycle).
//   • Stale-surface info banner when lithoStaleSurfaceCount > 0 —
//     READ-ONLY status; no Build button here.  Build lives in
//     LithologyToolbar (moved from SectionsToolbar in Phase 1).
//     Mirrors how GeologyInspector's crossings banner has no action.
//   • Read-only lithoFormations roster per formation: colour swatch,
//     name, and contact count.  NO drag/edit/delete — formations are
//     project-scoped shared vocabulary; CRUD stays in GeologyInspector.
//     GeologyInspector's internal FormationRow is a private function
//     (not exported); do NOT reuse or extract it — rule-of-three not
//     met.  A local ~15-line <li> suffices.
//   • Guidance footer pointing engineers to Sections.
//   • EmptyState primitive for the no-model / empty-roster branches.
//   • Semantic tokens for chrome — no raw dark: pairs.

import { Layers3 } from 'lucide-react'

import type { GeologicalFormationResponse } from '../../../api/client'
import { EmptyState } from '../../EmptyState'
import { useShell } from '../../ShellContext'
import ModelKindPicker from './ModelKindPicker'

/**
 * Inspector for the Lithology stage.
 *
 * Shows the model-kind picker, an optional stale-surface info banner,
 * a read-only formation roster grouped under parent geological formations
 * ordered by ``display_order`` (ascending = oldest first, geological
 * superposition convention), and workflow guidance pointing engineers to
 * the Sections stage.
 *
 * Returns
 * -------
 * JSX.Element
 *     The inspector panel content.
 */
export default function LithologyInspector(): JSX.Element {
  const {
    geoModel: {
      activeGeologicalModel,
      activeLithoModel,
      formations,
      lithoFormations,
      lithoContacts,
      lithoStaleSurfaceCount,
    },
  } = useShell()

  // No geological backbone — the litho model requires one as a parent.
  if (activeGeologicalModel === null) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="text-xs font-semibold text-text-primary">Lithology model</div>
        <p className="text-[11px] leading-snug text-text-muted">
          Create a geological model first (Geology stage) — a lithostratigraphic
          model refines it.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-xs font-semibold text-text-primary">Lithology model</div>

      {/* Model select / create lifecycle — relocated from GeologyInspector
          header per #55 re-scope.  Same component + hook layer. */}
      <ModelKindPicker />

      {activeLithoModel === null ? (
        /* No active litho model: compact guidance */
        <EmptyState
          icon={<Layers3 />}
          title="No lithology model"
          hint="Create a lithology model above, then open the Sections stage to draw contacts."
          compact
        />
      ) : (
        <>
          {/* Stale-surface info banner — read-only status, no action here.
              The Build verb lives on the Sections toolbar (cross-sections are
              the editing surface).  Mirrors the GeologyInspector crossings
              banner which also carries no action button. */}
          {lithoStaleSurfaceCount > 0 && (
            <div
              className="text-[11px] leading-snug rounded px-2 py-1.5 bg-surface-sunken border border-border-subtle text-text-secondary"
              data-testid="litho-stale-banner"
            >
              {lithoStaleSurfaceCount} litho surface
              {lithoStaleSurfaceCount === 1 ? '' : 's'} stale — Build on Sections.
            </div>
          )}

          {/* Read-only formation roster grouped under parent geological formations.
              Geological parents ordered ascending by display_order (oldest=0
              first — geological superposition convention used by all renderers).
              Litho units share a parent via parent_formation_id; units without
              a parent are shown under an "Unassigned" group at the bottom.
              Formations are project-scoped shared vocabulary; CRUD stays in
              GeologyInspector.  GeologyInspector's FormationRow is private;
              a local <li> is the right tool — rule-of-three not met. */}
          {lithoFormations.length === 0 ? (
            <EmptyState
              icon={<Layers3 />}
              title="No litho formations yet"
              hint="Accept CPT suggestions or draw contacts on a section — each accepted layer creates a formation here."
              compact
            />
          ) : (
            <LithoFormationRoster
              geoFormations={formations}
              lithoFormations={lithoFormations}
              lithoContacts={lithoContacts}
            />
          )}

          {/* Workflow guidance footer — always visible when a model is active. */}
          <p className="text-[11px] leading-snug text-text-muted">
            Draw contacts on Sections, then Build to update surfaces.
          </p>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// LithoFormationRoster — grouped read-only roster of litho units
// ---------------------------------------------------------------------------

interface LithoFormationRosterProps {
  /** Parent geological formations — ordered ascending by display_order. */
  geoFormations: readonly GeologicalFormationResponse[]
  /** Litho units in the active litho model. */
  lithoFormations: readonly GeologicalFormationResponse[]
  /** All contacts in the active litho model — used for per-unit count. */
  lithoContacts: readonly import('../../../api/client').FormationContactResponse[]
}

/**
 * Renders lithostratigraphic units grouped under their parent geological
 * formations, ordered ascending by the geological formation's
 * ``display_order`` (oldest first — superposition convention).
 *
 * Units without a ``parent_formation_id`` fall into an "Unassigned" group
 * at the bottom.  Each unit row shows: colour swatch, name, and contact
 * count within the active litho model.
 *
 * Parameters
 * ----------
 * geoFormations
 *     Geological formations sorted by display_order.  Units inherit the
 *     parent's ordering.
 * lithoFormations
 *     Litho units to display — may have parent_formation_id = null.
 * lithoContacts
 *     All contacts in the litho model for per-unit contact counting.
 *
 * Returns
 * -------
 * JSX.Element
 *     The grouped roster element.
 */
function LithoFormationRoster({
  geoFormations,
  lithoFormations,
  lithoContacts,
}: LithoFormationRosterProps): JSX.Element {
  // Group litho units by parent_formation_id.
  const byParent = new Map<string | null, GeologicalFormationResponse[]>()
  for (const lf of lithoFormations) {
    const key = lf.parent_formation_id ?? null
    const existing = byParent.get(key) ?? []
    existing.push(lf)
    byParent.set(key, existing)
  }

  // Build the ordered parent sequence: geological formations ascending by
  // display_order, keeping only those with at least one litho child.
  const sortedParents = [...geoFormations].sort((a, b) => a.display_order - b.display_order)
  const parentsWithChildren = sortedParents.filter(gf => byParent.has(gf.id))
  const unassigned = byParent.get(null) ?? []

  function LithoUnitRow({ f }: { f: GeologicalFormationResponse }): JSX.Element {
    const contactCount = lithoContacts.filter(c => c.formation_id === f.id).length
    return (
      <li
        key={f.id}
        className="flex items-center gap-2 px-1 py-0.5 rounded text-xs text-text-primary"
        data-testid={`litho-formation-row-${f.id}`}
      >
        <span
          className="h-3 w-3 flex-shrink-0 rounded-sm border border-border-subtle"
          style={{ backgroundColor: f.color }}
          aria-hidden="true"
        />
        <span className="flex-1 truncate">{f.name}</span>
        <span
          className="text-[10px] tabular-nums text-text-muted"
          title={`${contactCount} contact${contactCount === 1 ? '' : 's'} in this model`}
        >
          {contactCount}
        </span>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-2" aria-label="Litho formations">
      {parentsWithChildren.map(gf => (
        <section key={gf.id} aria-label={gf.name}>
          {/* Parent geological formation header */}
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className="h-2.5 w-2.5 flex-shrink-0 rounded-sm border border-border-subtle opacity-60"
              style={{ backgroundColor: gf.color }}
              aria-hidden="true"
            />
            <span
              className="text-[10px] font-semibold text-text-muted uppercase tracking-wide truncate"
              title={gf.name}
            >
              {gf.name}
            </span>
          </div>
          {/* Litho units under this parent */}
          <ul className="flex flex-col gap-0.5 pl-3 border-l border-border-subtle">
            {(byParent.get(gf.id) ?? []).map(f => (
              <LithoUnitRow key={f.id} f={f} />
            ))}
          </ul>
        </section>
      ))}

      {/* Unassigned units — litho formations without a parent_formation_id */}
      {unassigned.length > 0 && (
        <section aria-label="Unassigned">
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-0.5">
            Unassigned
          </div>
          <ul className="flex flex-col gap-0.5">
            {unassigned.map(f => (
              <LithoUnitRow key={f.id} f={f} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
