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
import { useT } from '../../../i18n/translate'

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
    coordinator: { handleExportSectionDxf, handleExportSectionPlaxis2d },
  } = useShell()
  const t = useT()

  // One section picker drives every section-scoped export (DXF +
  // Plaxis 2D). Default to whatever the user last selected in the
  // Sections stage; fall back to the first section so the control is
  // never empty. Local state — StageCanvas remounts this component on
  // every stage entry, so it always re-seeds from the current selection.
  const [sectionId, setSectionId] = useState<string | null>(
    selectedSectionId ?? sections[0]?.id ?? null,
  )
  // Which section-scoped export is in flight ('dxf' | 'plaxis2d'),
  // null when idle. A single flag (not one per button) so the picker
  // and both buttons disable together while either export runs.
  const [sectionBusy, setSectionBusy] = useState<'dxf' | 'plaxis2d' | null>(null)
  const [exportingPlaxis3d, setExportingPlaxis3d] = useState(false)

  const hasModel = activeGeologicalModel !== null
  const hasSections = sections.length > 0
  const section = sections.find(s => s.id === sectionId) ?? null

  async function handleSectionExport(target: 'dxf' | 'plaxis2d'): Promise<void> {
    if (!section || !activeGeologicalModel || sectionBusy !== null) return
    setSectionBusy(target)
    try {
      const fn =
        target === 'dxf' ? handleExportSectionDxf : handleExportSectionPlaxis2d
      await fn(project.id, section.id, section.name, activeGeologicalModel.id)
    } finally {
      setSectionBusy(null)
    }
  }

  async function handlePlaxis3d(): Promise<void> {
    if (!activeGeologicalModel || exportingPlaxis3d) return
    setExportingPlaxis3d(true)
    try {
      await handleExportModelPlaxis3d()
    } finally {
      setExportingPlaxis3d(false)
    }
  }

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="flex items-center gap-3 mb-1">
          <Download size={22} className="text-text-secondary" />
          <h1 className="text-lg font-semibold text-text-primary">{t('export.heading')}</h1>
        </div>
        <p className="text-sm text-text-secondary mb-6 leading-snug">
          {t('export.canvasBlurb')}
        </p>

        <div className="flex flex-col gap-3">
          {/* Section-scoped exports — one picker, DXF + Plaxis 2D. */}
          <ExportCard
            icon={<FileOutput size={18} />}
            title={t('export.crossSection')}
            description={t('export.sectionBlurb')}
          >
            {!hasModel ? (
              <Guidance>
                {t('export.guidanceNoModelPre')}
                <Stage>{t('export.geology')}</Stage>
                {t('export.guidanceNoModelPost')}
              </Guidance>
            ) : !hasSections ? (
              <Guidance>
                {t('export.guidanceNoSectionsPre')}
                <Stage>{t('export.sections')}</Stage>
                {t('export.guidanceNoSectionsPost')}
              </Guidance>
            ) : (
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="export-section-select">
                  {t('export.crossSectionToExport')}
                </label>
                <select
                  id="export-section-select"
                  value={sectionId ?? ''}
                  onChange={e => setSectionId(e.target.value)}
                  disabled={sectionBusy !== null}
                  className="flex-1 min-w-0 text-xs rounded border border-border-default bg-surface-overlay text-text-primary px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                >
                  {sections.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <ActionButton
                  label={sectionBusy === 'dxf' ? t('export.exporting') : t('export.exportDxf')}
                  onClick={() => void handleSectionExport('dxf')}
                  disabled={!section || sectionBusy !== null}
                />
                <ActionButton
                  label={
                    sectionBusy === 'plaxis2d' ? t('export.exporting') : t('export.exportPlaxis2d')
                  }
                  onClick={() => void handleSectionExport('plaxis2d')}
                  disabled={!section || sectionBusy !== null}
                />
              </div>
            )}
          </ExportCard>

          {/* Geological model → Plaxis 3D (model-wide, not section-scoped) */}
          <ExportCard
            icon={<Cpu size={18} />}
            title={t('export.geologyPlaxis3d')}
            description={t('export.geologyBlurb')}
          >
            {!hasModel ? (
              <Guidance>
                {t('export.guidanceNoModelPre')}
                <Stage>{t('export.geology')}</Stage>
                {t('export.guidanceNoModelPost')}
              </Guidance>
            ) : (
              <div className="flex justify-end">
                <ActionButton
                  label={exportingPlaxis3d ? t('export.exporting') : t('export.exportPlaxis3d')}
                  onClick={() => void handlePlaxis3d()}
                  disabled={exportingPlaxis3d}
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
