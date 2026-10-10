// Data stage toolbar — import actions wired from the ShellContext bus.
//
// Reproduces the import dropdown from Toolbar.tsx, now sourcing
// ``onImportCpt`` / ``onImportDov`` / ``onImportBoreholeDov`` / ``importing``
// / ``drawingBbox`` from ``useShell().investigations`` and
// ``useShell().investigations.bboxImportType``.
//
// The ThemeToggle from the old Toolbar.tsx moves to the StageToolbar right
// zone (committed in a subsequent step). This file owns only the stage-
// specific import verbs.

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Upload, Loader2, Waves } from 'lucide-react'

import { useShell } from '../../ShellContext'
import { PortalMenu, usePortalMenu } from '../../ToolbarPrimitives'
import type { ToolbarDropdownItem } from '../../ToolbarPrimitives'
import { useT, type Translator } from '../../../i18n/translate'
import LabSeriesImportDialog, {
  type LabSeriesImportSummary,
} from '../../../components/labSeries/LabSeriesImportDialog'
import { notifyLabSeriesChanged } from '../../../hooks/useLabSeriesRevision'
import { buildImportMenuItems } from './dataImportActions'

/**
 * Import action verbs for the Data stage toolbar.
 *
 * Rendered in the left zone of ``StageToolbar`` when the Data stage is
 * active.  Reads import state and handlers from ``useShell().investigations``
 * — no props required (matches the ``StageDescriptor.ToolbarComponent``
 * contract).
 *
 * Returns
 * -------
 * JSX.Element
 *     The toolbar verb buttons element.
 */
export default function DataToolbar(): JSX.Element {
  const shell = useShell()
  const {
    importing,
    dovImporting,
    bboxImportType,
    handleImportCpt,
    handleImportDov,
    handleImportBoreholeDov,
    handleImportBoreholeXml,
    handleImportCptPdf,
    handleImportBoreholePdf,
  } = shell.investigations
  // The guided tutorial's "Open the Import menu" step moves on by itself when
  // the dropdown opens (owner ruling 1, 2026-09-06). Read defensively: a partial
  // test shell (WS4 wires only the investigations slice) may omit coordinator,
  // and the setter itself is optional on the bus.
  const setImportMenuOpen = shell.coordinator?.setImportMenuOpen
  // Bed-override draw tool (owner ruling 2026-09-06). Optional on the bus; the
  // Data stage always has it, but read defensively for partial test shells.
  const bedOverrides = shell.bedOverrides
  const t = useT()
  // Raw lab import (2026-09-29): the picked files, walked one by one through
  // the preview dialog; null = no import running.
  const [labFiles, setLabFiles] = useState<string[] | null>(null)

  async function handleImportLabSeries(): Promise<void> {
    const paths = await window.electron.openFiles([
      { name: 'Lab exports', extensions: ['txt', 'csv', 'dat'] },
      { name: 'All Files', extensions: ['*'] },
    ])
    if (paths.length > 0) setLabFiles(paths)
  }

  async function finishLabImport(summary: LabSeriesImportSummary): Promise<void> {
    setLabFiles(null)
    const written = summary.imported + summary.replaced
    const fetched = summary.dovFetched
    const fetchedLine =
      fetched.length === 1
        ? t('labSeries.toast.dovFetchedOne', { name: fetched[0].name })
        : fetched.length > 1
          ? t('labSeries.toast.dovFetched', { names: fetched.map(b => b.name).join(', ') })
          : null
    shell.toasts.toast(
      summary.failed > 0 && written === 0 ? 'error' : 'success',
      t('labSeries.toast.summary', {
        imported: summary.imported,
        replaced: summary.replaced,
        unchanged: summary.unchanged,
        skipped: summary.skipped,
        failed: summary.failed,
      }) + (fetchedLine ? `. ${fetchedLine}` : ''),
    )
    if (fetched.length > 0) {
      // A borehole fetched from DOV was written by the preview, even when its
      // file was then skipped: it joins the list (unhidden, in the manifest,
      // marked new since the last save, the list refetched), the project is
      // dirty, and the first one is selected so the engineer sees where it
      // went (owner dogfeed 2026-10-04: "where can i see them").
      shell.coordinator?.markMutated?.()
      await shell.investigations.adoptImportedBoreholes?.(fetched.map(b => b.id))
      shell.coordinator?.setSelectedBoreholeId?.(fetched[0].id)
    } else if (written > 0) {
      // The borehole's lab-test count changed (the flask icon in the list).
      await shell.investigations.refreshBoreholeList?.()
    }
    if (written === 0) return
    // The import wrote to the database: the project is dirty until File > Save
    // puts the tests into the .strix; a new sample changes the borehole detail.
    shell.coordinator?.markMutated?.()
    for (const id of summary.touchedBoreholeIds) void shell.investigations.loadBoreholeDetail(id)
    notifyLabSeriesChanged()
  }

  const isImporting = importing || dovImporting
  const drawingBbox = bboxImportType !== null
  const drawingBed = bedOverrides?.drawing ?? false

  // The menu's rows (one per kind of investigation, routes in a submenu)
  // are built in dataImportActions.ts; this component only wires handlers.
  const items = buildImportMenuItems(
    t,
    {
      cptGef: handleImportCpt,
      cptDov: handleImportDov,
      // Optional on the bus (partial test shells omit them): no handler, no row.
      cptPdf: handleImportCptPdf ? () => void handleImportCptPdf() : undefined,
      boreholeDov: handleImportBoreholeDov,
      boreholeXml: handleImportBoreholeXml ? () => void handleImportBoreholeXml() : undefined,
      boreholePdf: handleImportBoreholePdf ? () => void handleImportBoreholePdf() : undefined,
      labTests: () => void handleImportLabSeries(),
    },
    isImporting,
  )

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu
        testid="import-menu-button"
        label={drawingBbox ? t('data.toolbar.drawingBbox') : t('data.toolbar.import')}
        icon={
          isImporting ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Upload size={13} />
          )
        }
        highlight={!isImporting && !drawingBbox}
        items={items}
        t={t}
        onOpenChange={setImportMenuOpen}
      />
      {labFiles && (
        <LabSeriesImportDialog
          projectId={shell.project.id}
          filePaths={labFiles}
          boreholes={shell.visibleBoreholes.map(b => ({ id: b.id, name: b.name }))}
          onFinished={s => void finishLabImport(s)}
        />
      )}
      {bedOverrides && (
        <button
          type="button"
          data-testid="data-toolbar-bed-level"
          onClick={() => (drawingBed ? bedOverrides.cancelDrawing() : bedOverrides.startDrawing())}
          aria-pressed={drawingBed}
          title={t('bedOverride.toolHint')}
          className={[
            'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
            drawingBed
              ? 'bg-surface-app text-accent'
              : 'text-text-secondary hover:bg-surface-app',
          ].join(' ')}
        >
          <Waves size={13} />
          {t('bedOverride.tool')}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dropdown — trigger stays local (the Data stage keeps its accent highlight
// + rotating chevron); the menu itself is the shared PortalMenu from
// ToolbarPrimitives (FE-SHELL-CLIENTS-15 dedup — this was the third copy
// of the portalled-menu pattern). Portalled + position:fixed so it escapes
// StageToolbar's `overflow-hidden` left zone (a plain absolute menu was
// clipped to the 40px-tall toolbar — the import menu was invisible).
// ---------------------------------------------------------------------------

interface DropdownMenuProps {
  label: string
  icon?: React.ReactNode
  highlight?: boolean
  /** Stable `data-testid` for the trigger button (the import "knob"). */
  testid?: string
  items: readonly ToolbarDropdownItem[]
  /** Passed down rather than re-derived: the accessible name of the menu is
   *  built from the already-translated trigger label, so both must come from
   *  the same render. */
  t: Translator
  /** Report the dropdown's open/closed state (guided tutorial — owner ruling 1,
   *  2026-09-06). Optional: absent in test fixtures with a partial coordinator. */
  onOpenChange?: (open: boolean) => void
}

function DropdownMenu({ label, icon, highlight, testid, items, t, onOpenChange }: DropdownMenuProps): JSX.Element {
  const btnRef = useRef<HTMLButtonElement>(null)
  const { open, anchorRect, toggle, close } = usePortalMenu(btnRef)

  // Mirror the dropdown's open state onto the bus so the tutorial's "Open the
  // Import menu" step advances by itself. Report on every change; reset to
  // closed when the toolbar unmounts (a stage switch) so a stale "open" never
  // lingers. onOpenChange is a stable setState from App.
  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])
  useEffect(() => () => onOpenChange?.(false), [onOpenChange])

  return (
    <div className="relative">
      <button
        ref={btnRef}
        data-testid={testid}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className={[
          'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
          open
            ? 'bg-surface-app text-text-primary'
            : highlight
            ? 'text-accent hover:bg-surface-app'
            : 'text-text-secondary hover:bg-surface-app',
        ].join(' ')}
      >
        {icon}
        {label}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && anchorRect !== null && (
        <PortalMenu
          anchorRect={anchorRect}
          ariaLabel={t('data.toolbar.menuLabel', { label })}
          items={items}
          onClose={close}
          className="w-56"
        />
      )}
    </div>
  )
}
