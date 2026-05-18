// Lithology stage inspector — model picker, stale-surface banner,
// read-only formation roster, and workflow guidance footer.
//
// Slice C of #55 litho peer-stage scaffolding.
//
// Design decisions (system-architect):
//   • ModelKindPicker unchanged at top (model select/create lifecycle).
//   • Stale-surface info banner when lithoStaleSurfaceCount > 0 —
//     READ-ONLY status; no Build button here.  Build lives on Sections
//     (cross-sections are the editing surface).  Mirrors how
//     GeologyInspector's crossings banner has no action button.
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

import { EmptyState } from '../../EmptyState'
import { useShell } from '../../ShellContext'
import ModelKindPicker from './ModelKindPicker'

/**
 * Inspector for the Lithology stage.
 *
 * Shows the model-kind picker, an optional stale-surface info banner,
 * a read-only formation roster with contact counts, and workflow
 * guidance pointing engineers to the Sections stage.
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

          {/* Read-only formation roster.
              Formations are project-scoped shared vocabulary; CRUD stays in
              GeologyInspector.  This roster is an information display only:
              colour swatch, name, and contact count for this litho model.
              GeologyInspector's FormationRow is a private internal function
              and is not exported; a local <li> is the right tool here. */}
          {lithoFormations.length === 0 ? (
            <EmptyState
              icon={<Layers3 />}
              title="No litho formations yet"
              hint="Accept CPT suggestions or draw contacts on a section — each accepted layer creates a formation here."
              compact
            />
          ) : (
            <ul className="flex flex-col gap-0.5" aria-label="Litho formations">
              {lithoFormations.map(f => {
                const contactCount = lithoContacts.filter(
                  c => c.formation_id === f.id,
                ).length
                return (
                  <li
                    key={f.id}
                    className="flex items-center gap-2 px-1 py-1 rounded text-xs text-text-primary"
                    data-testid={`litho-formation-row-${f.id}`}
                  >
                    {/* Colour swatch */}
                    <span
                      className="h-3 w-3 flex-shrink-0 rounded-sm border border-border-subtle"
                      style={{ backgroundColor: f.color }}
                      aria-hidden="true"
                    />
                    {/* Formation name — takes remaining space */}
                    <span className="flex-1 truncate">{f.name}</span>
                    {/* Contact count badge */}
                    <span
                      className="text-[10px] tabular-nums text-text-muted"
                      title={`${contactCount} contact${contactCount === 1 ? '' : 's'} in this model`}
                    >
                      {contactCount}
                    </span>
                  </li>
                )
              })}
            </ul>
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
