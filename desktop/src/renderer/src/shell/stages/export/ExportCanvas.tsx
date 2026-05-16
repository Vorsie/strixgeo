// Export stage canvas — the workflow spine's terminal stage.
//
// Debt #30: the export verbs (section DXF, model Plaxis 3D) used to live
// ONLY in the Sections toolbar. An engineer following the spine
// (Data → Geology → Sections → Geotechnical → Export) hit a "coming soon"
// stub at the exact moment they needed to take the result home — a
// launch-demo dead-end. This canvas surfaces every available export target
// as an actionable card so the spine no longer terminates in an empty room.
//
// The canvas does NOT own any export logic: the handlers (save-dialog +
// file-write + toast) live on the ShellContext bus and are shared verbatim
// with the Sections toolbar so the two affordances stay in lockstep.
//
// Cards self-disable with stage-pointing guidance when a prerequisite is
// missing (no section / no active model) — the same "tell the user where
// to go" pattern the Geology empty-state uses, rather than a silent
// disabled button.

import { useState } from 'react'
import { Download, FileOutput, Cpu } from 'lucide-react'

import { useShell } from '../../ShellContext'

/**
 * Center canvas for the Export stage.
 *
 * Renders one card per available export target. All data + handlers are
 * sourced from ``useShell()`` — no props are accepted directly (matches
 * the ``StageDescriptor.CanvasComponent`` contract).
 *
 * Returns
 * -------
 * JSX.Element
 *     The export hub element.
 */
export default function ExportCanvas(): JSX.Element {
  const {
    project,
    sections: { sections, selectedSectionId },
    geoModel: { activeGeologicalModel, handleExportModelPlaxis3d },
    coordinator: { handleExportSectionDxf },
  } = useShell()

  // Default the DXF section picker to whatever the user last selected in
  // the Sections stage; fall back to the first section so the control is
  // never empty when sections exist. Local state — StageCanvas remounts
  // this component on every stage entry, so it always re-seeds from the
  // current selection.
  const [dxfSectionId, setDxfSectionId] = useState<string | null>(
    selectedSectionId ?? sections[0]?.id ?? null,
  )
  const [exportingDxf, setExportingDxf] = useState(false)
  const [exportingPlaxis, setExportingPlaxis] = useState(false)

  const hasModel = activeGeologicalModel !== null
  const hasSections = sections.length > 0
  const dxfSection = sections.find(s => s.id === dxfSectionId) ?? null

  async function handleDxf(): Promise<void> {
    if (!dxfSection || !activeGeologicalModel || exportingDxf) return
    setExportingDxf(true)
    try {
      await handleExportSectionDxf(
        project.id,
        dxfSection.id,
        dxfSection.name,
        activeGeologicalModel.id,
      )
    } finally {
      setExportingDxf(false)
    }
  }

  async function handlePlaxis3d(): Promise<void> {
    if (!activeGeologicalModel || exportingPlaxis) return
    setExportingPlaxis(true)
    try {
      await handleExportModelPlaxis3d()
    } finally {
      setExportingPlaxis(false)
    }
  }

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="flex items-center gap-3 mb-1">
          <Download size={22} className="text-text-secondary" />
          <h1 className="text-lg font-semibold text-text-primary">Export</h1>
        </div>
        <p className="text-sm text-text-secondary mb-6 leading-snug">
          Hand the ground model off to a downstream design tool. Layer
          geometry is the integration unit — per-layer parameters are set
          in the destination tool.
        </p>

        <div className="flex flex-col gap-3">
          {/* Cross-section → DXF */}
          <ExportCard
            icon={<FileOutput size={18} />}
            title="Cross-section → DXF"
            description="Export one cross-section's layer geometry as a DXF — the universal exchange format every CAD / design tool reads."
          >
            {!hasModel ? (
              <Guidance>
                No active geological model. Define formations and place
                contacts in the <Stage>Geology</Stage> stage first.
              </Guidance>
            ) : !hasSections ? (
              <Guidance>
                No cross-sections yet. Create one in the{' '}
                <Stage>Sections</Stage> stage.
              </Guidance>
            ) : (
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="dxf-section-select">
                  Cross-section to export
                </label>
                <select
                  id="dxf-section-select"
                  value={dxfSectionId ?? ''}
                  onChange={e => setDxfSectionId(e.target.value)}
                  disabled={exportingDxf}
                  className="flex-1 min-w-0 text-xs rounded border border-border-default bg-surface-overlay text-text-primary px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                >
                  {sections.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <ActionButton
                  label={exportingDxf ? 'Exporting…' : 'Export DXF'}
                  onClick={() => void handleDxf()}
                  disabled={!dxfSection || exportingDxf}
                />
              </div>
            )}
          </ExportCard>

          {/* Geological model → Plaxis 3D */}
          <ExportCard
            icon={<Cpu size={18} />}
            title="Geological model → Plaxis 3D"
            description="Export the whole model as a runnable plxscripting Python script — one Mohr-Coulomb placeholder soil + one borehole per investigation."
          >
            {!hasModel ? (
              <Guidance>
                No active geological model. Define formations and place
                contacts in the <Stage>Geology</Stage> stage first.
              </Guidance>
            ) : (
              <div className="flex justify-end">
                <ActionButton
                  label={exportingPlaxis ? 'Exporting…' : 'Export Plaxis 3D'}
                  onClick={() => void handlePlaxis3d()}
                  disabled={exportingPlaxis}
                />
              </div>
            )}
          </ExportCard>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Internal presentation helpers
// ---------------------------------------------------------------------------

interface ExportCardProps {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}

/**
 * One export-target card: icon + title + description + an action slot.
 *
 * Parameters
 * ----------
 * icon
 *     Lucide icon element (18 px).
 * title
 *     Card heading naming the source → target.
 * description
 *     One-line explanation of what the export produces.
 * children
 *     The action row (picker + button) or a ``<Guidance>`` block when a
 *     prerequisite is unmet.
 *
 * Returns
 * -------
 * JSX.Element
 *     The card element.
 */
function ExportCard({ icon, title, description, children }: ExportCardProps): JSX.Element {
  return (
    <div className="bg-surface-overlay border border-border-default rounded-lg p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="text-text-secondary mt-0.5">{icon}</div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          <p className="text-xs text-text-secondary leading-snug mt-0.5">
            {description}
          </p>
        </div>
      </div>
      {children}
    </div>
  )
}

/**
 * Muted guidance block shown when an export prerequisite is unmet.
 *
 * Parameters
 * ----------
 * children
 *     The guidance text (may embed ``<Stage>`` spans).
 *
 * Returns
 * -------
 * JSX.Element
 *     The guidance element.
 */
function Guidance({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <p className="text-xs text-text-muted leading-snug bg-surface-app rounded px-3 py-2">
      {children}
    </p>
  )
}

/**
 * Emphasised stage name inside a ``<Guidance>`` sentence.
 *
 * Parameters
 * ----------
 * children
 *     The stage label text.
 *
 * Returns
 * -------
 * JSX.Element
 *     The emphasised span.
 */
function Stage({ children }: { children: React.ReactNode }): JSX.Element {
  return <span className="font-medium text-text-secondary">{children}</span>
}

interface ActionButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
}

/**
 * Accent-filled export action button (same visual language as the
 * Sections toolbar's primary verb, so the two affordances read as one).
 *
 * Parameters
 * ----------
 * label
 *     Button text (swaps to "Exporting…" while in flight).
 * onClick
 *     Action handler.
 * disabled
 *     When true, the button is non-interactive and dimmed.
 *
 * Returns
 * -------
 * JSX.Element
 *     The button element.
 */
function ActionButton({ label, onClick, disabled }: ActionButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors whitespace-nowrap',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        disabled
          ? 'bg-accent/40 text-text-on-accent cursor-not-allowed'
          : 'bg-accent text-text-on-accent hover:bg-accent-muted',
      ].join(' ')}
    >
      {label}
    </button>
  )
}
