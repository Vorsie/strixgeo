// Export stage canvas — THE export hub (installer #35, owner ruling: "the Export
// stage becomes the only export surface ... build the export hub").
//
// Every export the app can produce lives here as a card, grouped by model level:
//   * Cross-section  — Section DXF (any axis)
//   * Stratigraphy   — Plaxis 3D (whole model)
//   * Lithology      — fence DXF
//   * Geotechnical   — D-Stability (.stix), D-Sheet Piling (.shi), Plaxis 2D, fence DXF
//   * Report         — PDF drawing sheet (litho / geotech axis)
//
// D-Stability and Plaxis 2D are geotechnical-only (owner ruling, installer #42:
// "we only need geotech exports to plaxis and d modules"); the lithology group
// keeps just its fence DXF.
//
// One shared cross-section picker drives every section-scoped card; the axis-
// flexible cards (Section DXF, the PDF sheet) carry their own model-level picker.
// The section toolbar's single "Export…" verb and the 3-D stages' "Export…"
// verbs jump here (``exportDeepLinkTarget``), pre-selecting the section + axis.
//
// This component is presentation only — all state + export handlers live in
// ``useExportHub`` (keeps the file under the god-component cap, debt #201).

import { useState } from 'react'
import { Download, FileOutput, Cpu, Mountain, Ruler, FileText, Network } from 'lucide-react'

import { useT } from '../../../i18n/translate'
import type { MessageKey } from '../../../i18n/locales/en'
import type { SectionModelAxis } from '../../../hooks/useSections'
import { SheetPreviewDialog } from '../sections/SheetPreviewDialog'
import { useExportHub } from './useExportHub'

/**
 * Center canvas for the Export stage — the export hub.
 *
 * Returns
 * -------
 * JSX.Element
 *     The grouped card grid.
 */
export default function ExportCanvas(): JSX.Element {
  const t = useT()
  const hub = useExportHub()

  // Axis pickers for the two axis-flexible cards, seeded from the toolbar jump.
  const [dxfAxis, setDxfAxis] = useState<SectionModelAxis>(hub.seedAxis)
  const [pdfAxis, setPdfAxis] = useState<'lithostratigraphic' | 'geotechnical'>(
    hub.seedAxis === 'geotechnical' ? 'geotechnical' : 'lithostratigraphic',
  )
  const [pdfOpen, setPdfOpen] = useState(false)

  const busy = hub.busy

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center gap-3 mb-1">
          <Download size={22} className="text-text-secondary" />
          <h1 className="text-lg font-semibold text-text-primary">{t('export.heading')}</h1>
        </div>
        <p className="text-sm text-text-secondary mb-6 leading-snug">{t('export.hubBlurb')}</p>

        {/* Shared cross-section picker — drives every section-scoped card. */}
        {hub.hasSections ? (
          <div className="mb-6 flex items-center gap-2">
            <label
              className="text-xs font-medium text-text-secondary shrink-0"
              htmlFor="export-section-select"
            >
              {t('export.crossSectionPickerLabel')}
            </label>
            <select
              id="export-section-select"
              data-testid="export-section-select"
              value={hub.sectionId ?? ''}
              onChange={e => hub.setSectionId(e.target.value)}
              disabled={busy !== null}
              className="flex-1 min-w-0 text-xs rounded border border-border-default bg-surface-overlay text-text-primary px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              {hub.sections.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {/* ── Cross-section ────────────────────────────────────────────── */}
        <Group title={t('export.groupCrossSection')}>
          <ExportCard
            icon={<FileOutput size={18} />}
            title={t('export.cardSectionDxfTitle')}
            description={t('export.cardSectionDxfDesc')}
            lastPath={hub.lastPathFor('section-dxf')}
          >
            {!hub.hasSections ? (
              <Guide message={t('export.guideNoSections')} />
            ) : hub.section === null ? (
              <Guide message={t('export.guidePickSection')} />
            ) : (
              <ControlRow>
                <AxisSelect
                  id="export-dxf-axis"
                  value={dxfAxis}
                  onChange={setDxfAxis}
                  disabled={busy !== null}
                  options={['geological', 'lithostratigraphic', 'geotechnical']}
                />
                <ActionButton
                  label={busy === 'section-dxf' ? t('export.exporting') : t('export.exportDxf')}
                  onClick={() => void hub.runSectionDxf(dxfAxis)}
                  disabled={busy !== null}
                  testid="export-canvas-dxf"
                />
              </ControlRow>
            )}
          </ExportCard>
        </Group>

        {/* ── Stratigraphy ─────────────────────────────────────────────── */}
        <Group title={t('export.groupStratigraphy')}>
          <ExportCard
            icon={<Cpu size={18} />}
            title={t('export.cardPlaxis3dTitle')}
            description={t('export.cardPlaxis3dDesc')}
            lastPath={hub.lastPathFor('plaxis3d')}
          >
            {!hub.hasStratModel ? (
              <Guide message={t('export.guideNoStratModel')} />
            ) : (
              <ControlRow justifyEnd>
                <ActionButton
                  label={busy === 'plaxis3d' ? t('export.exporting') : t('export.exportPlaxis3d')}
                  onClick={() => void hub.runPlaxis3d()}
                  disabled={busy !== null}
                  testid="export-canvas-plaxis3d"
                />
              </ControlRow>
            )}
          </ExportCard>
        </Group>

        {/* ── Lithology ────────────────────────────────────────────────── */}
        {/* D-Stability + Plaxis 2D are geotechnical-only (owner, installer #42);
            the lithology group keeps only its fence DXF. */}
        <Group title={t('export.groupLithology')}>
          <ExportCard
            icon={<Network size={18} />}
            title={t('export.cardLithoFenceTitle')}
            description={t('export.cardLithoFenceDesc')}
            lastPath={hub.lastPathFor('litho-fence')}
          >
            {!hub.hasLithoModel ? (
              <Guide message={t('export.guideNoLithoModel')} />
            ) : (
              <ControlRow justifyEnd>
                <ActionButton
                  label={busy === 'litho-fence' ? t('export.exporting') : t('export.exportFence')}
                  onClick={() => void hub.runFence('litho')}
                  disabled={busy !== null}
                  testid="export-canvas-litho-fence"
                />
              </ControlRow>
            )}
          </ExportCard>
        </Group>

        {/* ── Geotechnical ─────────────────────────────────────────────── */}
        <Group title={t('export.groupGeotechnical')}>
          <ExportCard
            icon={<Mountain size={18} />}
            title={t('export.dStability')}
            description={t('export.cardGeotechDstabilityDesc')}
            lastPath={hub.lastPathFor('geotech-dstability')}
          >
            <SectionExportBody
              hasModel={hub.hasGeotechModel}
              modelGuide={t('export.guideNoGeotechModel')}
              hasSections={hub.hasSections}
              hasSection={hub.section !== null}
              t={t}
            >
              <ControlRow justifyEnd>
                <ActionButton
                  label={busy === 'geotech-dstability' ? t('export.exporting') : t('export.exportStix')}
                  onClick={() => void hub.runDseries('dstability', 'geotechnical')}
                  disabled={busy !== null}
                  testid="export-canvas-dstability"
                />
              </ControlRow>
            </SectionExportBody>
          </ExportCard>

          <ExportCard
            icon={<Ruler size={18} />}
            title={t('export.dSheetPiling')}
            description={t('export.cardGeotechDsheetDesc')}
            lastPath={hub.lastPathFor('geotech-dsheet')}
          >
            <SectionExportBody
              hasModel={hub.hasGeotechModel}
              modelGuide={t('export.guideNoGeotechModel')}
              hasSections={hub.hasSections}
              hasSection={hub.section !== null}
              t={t}
            >
              <ControlRow justifyEnd>
                <ActionButton
                  label={busy === 'geotech-dsheet' ? t('export.exporting') : t('export.exportShi')}
                  onClick={() => void hub.runDseries('dsheetpiling', 'geotechnical')}
                  disabled={busy !== null}
                  testid="export-canvas-dsheetpiling"
                />
              </ControlRow>
            </SectionExportBody>
          </ExportCard>

          <ExportCard
            icon={<Cpu size={18} />}
            title={t('export.cardGeotechPlaxis2dTitle')}
            description={t('export.cardGeotechPlaxis2dDesc')}
            lastPath={hub.lastPathFor('plaxis2d-geotechnical')}
          >
            <SectionExportBody
              hasModel={hub.hasGeotechModel}
              modelGuide={t('export.guideNoGeotechModel')}
              hasSections={hub.hasSections}
              hasSection={hub.section !== null}
              t={t}
            >
              <ControlRow justifyEnd>
                <ActionButton
                  label={
                    busy === 'plaxis2d-geotechnical'
                      ? t('export.exporting')
                      : t('export.exportPlaxis2d')
                  }
                  onClick={() => void hub.runPlaxis2d('geotechnical')}
                  disabled={busy !== null}
                  testid="export-canvas-geotech-plaxis2d"
                />
              </ControlRow>
            </SectionExportBody>
          </ExportCard>

          <ExportCard
            icon={<Network size={18} />}
            title={t('export.cardGeotechFenceTitle')}
            description={t('export.cardGeotechFenceDesc')}
            lastPath={hub.lastPathFor('geotech-fence')}
          >
            {!hub.hasGeotechModel ? (
              <Guide message={t('export.guideNoGeotechModel')} />
            ) : (
              <ControlRow justifyEnd>
                <ActionButton
                  label={busy === 'geotech-fence' ? t('export.exporting') : t('export.exportFence')}
                  onClick={() => void hub.runFence('geotech')}
                  disabled={busy !== null}
                  testid="export-canvas-geotech-fence"
                />
              </ControlRow>
            )}
          </ExportCard>
        </Group>

        {/* ── Report ───────────────────────────────────────────────────── */}
        <Group title={t('export.groupReport')}>
          <ExportCard
            icon={<FileText size={18} />}
            title={t('export.cardPdfTitle')}
            description={t('export.cardPdfDesc')}
            lastPath={null}
          >
            {!hub.hasLithoModel && !hub.hasGeotechModel ? (
              <Guide message={t('export.guideNoLithoModel')} />
            ) : !hub.hasSections ? (
              <Guide message={t('export.guideNoSections')} />
            ) : hub.section === null ? (
              <Guide message={t('export.guidePickSection')} />
            ) : (
              <ControlRow>
                <AxisSelect
                  id="export-pdf-axis"
                  value={pdfAxis}
                  onChange={v => setPdfAxis(v as 'lithostratigraphic' | 'geotechnical')}
                  disabled={busy !== null}
                  options={['lithostratigraphic', 'geotechnical']}
                />
                <ActionButton
                  label={t('export.openPreview')}
                  onClick={() => setPdfOpen(true)}
                  disabled={busy !== null}
                  testid="export-canvas-pdf"
                />
              </ControlRow>
            )}
          </ExportCard>
        </Group>
      </div>

      {/* The SAME PDF preview + print dialog the Sections toolbar opened. */}
      <SheetPreviewDialog
        open={pdfOpen}
        onClose={() => setPdfOpen(false)}
        section={hub.section}
        isGeotech={pdfAxis === 'geotechnical'}
        hasGeotechModel={hub.hasGeotechModel}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/** A titled group of export cards. */
function Group({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="mb-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

/**
 * A section-scoped card body: shows the first unmet prerequisite as guidance
 * (no model → no sections → no section chosen), else the card's controls.
 */
function SectionExportBody({
  hasModel,
  modelGuide,
  hasSections,
  hasSection,
  t,
  children,
}: {
  hasModel: boolean
  modelGuide: string
  hasSections: boolean
  hasSection: boolean
  t: (key: MessageKey) => string
  children: React.ReactNode
}): JSX.Element {
  if (!hasModel) return <Guide message={modelGuide} />
  if (!hasSections) return <Guide message={t('export.guideNoSections')} />
  if (!hasSection) return <Guide message={t('export.guidePickSection')} />
  return <>{children}</>
}

interface ExportCardProps {
  icon: React.ReactNode
  title: string
  description: string
  lastPath: string | null
  children: React.ReactNode
}

/** One export-target card: icon + title + description + action slot + last path. */
function ExportCard({ icon, title, description, lastPath, children }: ExportCardProps): JSX.Element {
  const t = useT()
  return (
    <div className="bg-surface-overlay border border-border-default rounded-lg p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="text-text-secondary mt-0.5">{icon}</div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <p className="text-xs text-text-secondary leading-snug mt-0.5">{description}</p>
        </div>
      </div>
      {children}
      {lastPath !== null ? (
        <p className="text-[11px] text-text-muted mt-2 truncate" title={lastPath}>
          {t('export.lastSaved').replace('{path}', lastPath)}
        </p>
      ) : null}
    </div>
  )
}

/** The controls row of a card (picker + button), right-aligned when asked. */
function ControlRow({
  children,
  justifyEnd,
}: {
  children: React.ReactNode
  justifyEnd?: boolean
}): JSX.Element {
  return (
    <div className={['flex items-center gap-2', justifyEnd ? 'justify-end' : ''].join(' ')}>
      {children}
    </div>
  )
}

/** Muted guidance shown when an export prerequisite is unmet. */
function Guide({ message }: { message: string }): JSX.Element {
  return (
    <p className="text-xs text-text-muted leading-snug bg-surface-app rounded px-3 py-2">
      {message}
    </p>
  )
}

/** A model-level picker for an axis-flexible card. */
function AxisSelect({
  id,
  value,
  onChange,
  disabled,
  options,
}: {
  id: string
  value: SectionModelAxis
  onChange: (axis: SectionModelAxis) => void
  disabled: boolean
  options: readonly SectionModelAxis[]
}): JSX.Element {
  const t = useT()
  const labelFor = (axis: SectionModelAxis): string =>
    axis === 'geological'
      ? t('export.axisGeological')
      : axis === 'lithostratigraphic'
        ? t('export.axisLithological')
        : t('export.axisGeotechnical')
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {t('export.axisLabel')}
      </label>
      <select
        id={id}
        data-testid={id}
        value={value}
        onChange={e => onChange(e.target.value as SectionModelAxis)}
        disabled={disabled}
        className="flex-1 min-w-0 text-xs rounded border border-border-default bg-surface-overlay text-text-primary px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        {options.map(o => (
          <option key={o} value={o}>
            {labelFor(o)}
          </option>
        ))}
      </select>
    </>
  )
}

interface ActionButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
  testid?: string
}

/** Accent-filled export action button (same language as the old hub buttons). */
function ActionButton({ label, onClick, disabled, testid }: ActionButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
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
