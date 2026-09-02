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

import { useRef } from 'react'
import { ChevronDown, Upload, Loader2 } from 'lucide-react'

import { useShell } from '../../ShellContext'
import { PortalMenu, usePortalMenu } from '../../ToolbarPrimitives'
import type { ToolbarDropdownItem } from '../../ToolbarPrimitives'
import { useT, type Translator } from '../../../i18n/translate'
import type { MessageKey } from '../../../i18n/locales/en'

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
  const {
    investigations: {
      importing,
      dovImporting,
      bboxImportType,
      handleImportCpt,
      handleImportDov,
      handleImportBoreholeDov,
    },
  } = useShell()
  const t = useT()

  const isImporting = importing || dovImporting
  const drawingBbox = bboxImportType !== null

  // The verbs carry a message KEY, not a rendered string: the labels are read
  // in one place below so a language flip re-renders every row together.
  // `testid` anchors each verb for the guided tutorial (Chapter 2 spotlights the
  // verbs one at a time) and for e2e; PortalMenu renders it as a data-testid.
  const importActions: ImportAction[] = [
    { key: 'data.toolbar.importCptGef', testid: 'import-verb-cpt-gef', available: true, onClick: handleImportCpt },
    { key: 'data.toolbar.importCptDov', testid: 'import-verb-cpt-dov', available: true, onClick: handleImportDov },
    {
      key: 'data.toolbar.importBoreholeDov',
      testid: 'import-verb-borehole-dov',
      available: true,
      onClick: handleImportBoreholeDov,
    },
    { key: 'data.toolbar.importDmt', testid: 'import-verb-dmt', available: false },
    { key: 'data.toolbar.importLabTest', testid: 'import-verb-lab', available: false },
    { key: 'data.toolbar.importMonitoring', testid: 'import-verb-monitoring', available: false },
  ]

  const items: ToolbarDropdownItem[] = importActions.map(action => ({
    label: t(action.key),
    testid: action.testid,
    onClick: action.onClick ?? (() => undefined),
    disabled: !action.available || isImporting,
    tag: !action.available ? t('data.toolbar.phaseTag') : undefined,
  }))

  return (
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
    />
  )
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ImportAction {
  /** Message key for the row label — resolved at render, not at declaration,
   *  so the whole menu follows a language flip in one re-render. */
  key: MessageKey
  /** Stable `data-testid` for the menu row (tutorial + e2e anchor). */
  testid: string
  available: boolean
  onClick?: () => void
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
}

function DropdownMenu({ label, icon, highlight, testid, items, t }: DropdownMenuProps): JSX.Element {
  const btnRef = useRef<HTMLButtonElement>(null)
  const { open, anchorRect, toggle, close } = usePortalMenu(btnRef)

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
