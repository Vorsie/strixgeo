// Lithology stage inspector — the home of the model-kind picker
// (relocated from the GeologyInspector header, #55 re-scope) plus a
// one-line workflow pointer. Formations are project-scoped shared
// vocabulary (not per-model), so there is no per-litho-model
// formation list to show until contacts exist — slice 2/3 populate
// them via the section editor. Keeping this minimal is deliberate:
// slice 1 only needs the picker to have a real, non-dead-end home.

import { useShell } from '../../ShellContext'
import ModelKindPicker from './ModelKindPicker'

/**
 * Inspector for the Lithology stage.
 *
 * Returns
 * -------
 * JSX.Element
 *     The picker + workflow guidance.
 */
export default function LithologyInspector(): JSX.Element {
  const {
    geoModel: { activeGeologicalModel, activeLithoModel },
  } = useShell()

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
        Lithology model
      </div>

      {activeGeologicalModel === null ? (
        <p className="text-[11px] leading-snug text-text-muted">
          Create a geological model first (Geology stage) — a
          lithostratigraphic model refines it.
        </p>
      ) : (
        <>
          {/* Relocated from the GeologyInspector header. Same
              component + hook layer; the inspector is the right home
              now that Lithology is a peer stage. */}
          <ModelKindPicker />
          <p className="text-[11px] leading-snug text-text-muted">
            {activeLithoModel === null
              ? 'Create a lithology model above, then open the Sections stage to draw its contacts.'
              : `Active: ${activeLithoModel.name}. Build it on the Sections stage — draw contacts or accept CPT-based suggestions, scoped to this model.`}
          </p>
        </>
      )}
    </div>
  )
}
