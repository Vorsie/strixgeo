// Application Settings dialog. Reached from File → Settings… (Ctrl+,).
//
// Project-scoped: every setting here persists in ``project.view_state``
// so it travels with the .gmproj bundle and the next collaborator
// opens the file with the same tuning. There is no per-user / per-
// machine pref store today — when one becomes necessary (UI theme,
// recent-projects retention, etc.) it lands as a separate section
// here and writes to electron-store / userData instead of view_state.
//
// Section scaffold: the dialog renders a left rail of section labels +
// a right pane of controls. v1 has one section ("Litho segmenter") so
// the rail is a placeholder; the structure is in place for additional
// sections (Map / Sections / Export) without re-wiring.

import { Settings as SettingsIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import Button from './ui/Button'
import Modal from './ui/Modal'
import {
  LITHO_SEGMENTER_DEFAULTS,
  LITHO_SEGMENTER_MIN_THICKNESS_BOUNDS,
  type LithoSegmenterPrefs,
} from '../utils/lithoSegmenterPrefs'

interface Props {
  open: boolean
  /** Initial values seeded from ``project.view_state``. The dialog
   *  re-seeds on every open so a Cancel from an in-flight edit doesn't
   *  leak draft state into the next session. */
  initialLithoSegmenter: LithoSegmenterPrefs
  /** Whether a project is loaded. When false, the dialog still opens
   *  but project-scoped sections are read-only — there's no view_state
   *  to persist into. */
  hasProject: boolean
  onCancel: () => void
  /** Fires when the user clicks Save. The caller threads the patch
   *  through ``applyViewStatePatch`` so the .gmproj round-trip stays
   *  in App.tsx. */
  onSubmitLithoSegmenter: (next: LithoSegmenterPrefs) => void
}

export default function SettingsDialog({
  open,
  initialLithoSegmenter,
  hasProject,
  onCancel,
  onSubmitLithoSegmenter,
}: Props): JSX.Element | null {
  const [draft, setDraft] = useState<LithoSegmenterPrefs>(initialLithoSegmenter)

  // Re-seed the draft every time the dialog opens so a Cancel in one
  // session doesn't leak into the next, and so the dialog reflects the
  // latest saved value if the project was patched outside this dialog.
  useEffect(() => {
    if (open) setDraft(initialLithoSegmenter)
  }, [open, initialLithoSegmenter])

  if (!open) return null

  const { min, max } = LITHO_SEGMENTER_MIN_THICKNESS_BOUNDS
  const thickness = draft.minimumLayerThicknessM
  const thicknessOutOfRange =
    !Number.isFinite(thickness) || thickness < min || thickness > max
  const dirty =
    draft.minimumLayerThicknessM !== initialLithoSegmenter.minimumLayerThicknessM

  function handleSave(): void {
    if (!dirty || thicknessOutOfRange) return
    onSubmitLithoSegmenter(draft)
  }

  function handleReset(): void {
    setDraft({ ...LITHO_SEGMENTER_DEFAULTS })
  }

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="settings-title"
      cardClassName="w-[640px] max-h-[80vh] flex flex-col"
    >
      <div className="flex flex-col flex-1 min-h-0">
        <div className="px-6 pt-5 pb-3 border-b border-border-subtle flex items-center gap-2">
          <SettingsIcon size={16} className="text-text-muted" />
          <h2
            id="settings-title"
            className="text-base font-semibold text-text-primary"
          >
            Settings
          </h2>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Section rail. Single section today; scaffolded for future
              additions (Map / Sections / Export). Selected state is
              hard-coded for v1 — when section #2 lands this becomes a
              useState pick. */}
          <div className="w-44 border-r border-border-subtle py-3 px-2 text-xs">
            <div className="px-2 py-1.5 rounded bg-surface-card text-text-primary font-medium">
              Litho segmenter
            </div>
          </div>

          {/* Section body. */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                Litho segmenter
              </h3>
              <p className="text-xs text-text-muted mt-0.5">
                Tuning for the "Suggest" verb on the Litho axis. Stored
                per project — travels with the .gmproj file.
              </p>
            </div>

            <div>
              <label
                htmlFor="settings-min-thickness"
                className="block text-[11px] font-medium text-text-secondary mb-1"
              >
                Minimum layer thickness (m)
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="settings-min-thickness"
                  type="range"
                  min={min}
                  max={3.0}
                  step={0.05}
                  value={Math.min(thickness, 3.0)}
                  onChange={e =>
                    setDraft({
                      ...draft,
                      minimumLayerThicknessM: Number(e.target.value),
                    })
                  }
                  disabled={!hasProject}
                  className="flex-1 accent-accent"
                  aria-label="Minimum layer thickness slider"
                />
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={0.05}
                  value={thickness}
                  onChange={e => {
                    const v = Number(e.target.value)
                    setDraft({
                      ...draft,
                      // Allow out-of-range values to land in the
                      // controlled input so the user can clear + retype;
                      // the validation gate below blocks the Save.
                      minimumLayerThicknessM: Number.isFinite(v) ? v : thickness,
                    })
                  }}
                  disabled={!hasProject}
                  className={`w-20 border rounded px-2 py-1 text-sm bg-surface-overlay text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent ${
                    thicknessOutOfRange
                      ? 'border-status-danger'
                      : 'border-border-default'
                  }`}
                  aria-label="Minimum layer thickness in metres"
                  aria-invalid={thicknessOutOfRange}
                />
                <span className="text-xs text-text-muted">m</span>
              </div>
              <p className="text-[11px] text-text-muted mt-1.5 leading-snug">
                Layers thinner than this are merged into their neighbour.
                Lower values catch thin clay drapes (0.10–0.20 m);
                higher values produce a coarser, more readable column.
                Range {min}–{max} m. Default {LITHO_SEGMENTER_DEFAULTS.minimumLayerThicknessM} m.
              </p>
              {!hasProject && (
                <p className="text-[11px] text-status-amber mt-1">
                  Open or create a project to change this setting.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-border-subtle flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={handleReset} disabled={!hasProject}>
            Reset to defaults
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={!dirty || thicknessOutOfRange || !hasProject}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
