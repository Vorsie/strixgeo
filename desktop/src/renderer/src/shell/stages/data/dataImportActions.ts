// The Data stage's Import menu, as data. Pure: no hooks, no shell access, so the
// menu's shape is readable in one place and DataToolbar only wires handlers.
//
// Owner 2026-10-04: "the import menu now has 3 ways to import CPT's, let's
// clean that up. one button for cpt's with suboptions, same for drillings."
// So the menu holds ONE row per kind of investigation. CPT and Borehole are
// group rows whose import routes open in a submenu (PortalMenu); lab tests are
// a plain row; DMT and monitoring stay dimmed rows with the phase tag so the
// roadmap stays visible (and the tutorial's `import-verb-dmt` anchor resolves).
//
// Every `testid` is a tutorial / e2e anchor: the route testids are unchanged
// from the flat menu, the group rows add `import-group-cpt` /
// `import-group-borehole` (tutorialCatalogue.ts chains through them).

import type { ToolbarDropdownItem } from '../../ToolbarPrimitives'
import type { Translator } from '../../../i18n/translate'
import type { MessageKey } from '../../../i18n/locales/en'

/** The import handlers the menu runs. Optional ones are absent on partial
 *  test shells; a missing handler drops its row rather than showing a dead one. */
export interface ImportMenuHandlers {
  cptGef: () => void
  cptDov: () => void
  cptPdf?: () => void
  boreholeDov: () => void
  boreholeXml?: () => void
  labTests: () => void
}

/** One row before translation. The label is a message KEY, resolved when the
 *  menu is built, so a language flip re-renders every row together. */
interface ImportRowSpec {
  key: MessageKey
  testid: string
  /** No handler = a future importer: dimmed, tagged with the phase. */
  onClick?: () => void
  submenu?: readonly ImportRowSpec[]
}

/**
 * Build the Data stage's Import menu rows.
 *
 * Parameters
 * ----------
 * t : Translator
 *     The active-language translator.
 * handlers : ImportMenuHandlers
 *     The import flows each row runs.
 * busy : boolean
 *     An import is running: every row, group rows included, is disabled.
 *
 * Returns
 * -------
 * ToolbarDropdownItem[]
 *     The rows for ``PortalMenu``: two group rows (CPT, Borehole) with their
 *     routes in a submenu, then lab tests, then the two future importers.
 */
export function buildImportMenuItems(
  t: Translator,
  handlers: ImportMenuHandlers,
  busy: boolean,
): ToolbarDropdownItem[] {
  const specs: ImportRowSpec[] = [
    {
      key: 'data.toolbar.groupCpt',
      testid: 'import-group-cpt',
      submenu: [
        { key: 'data.toolbar.cptGef', testid: 'import-verb-cpt-gef', onClick: handlers.cptGef },
        { key: 'data.toolbar.fromDov', testid: 'import-verb-cpt-dov', onClick: handlers.cptDov },
        ...(handlers.cptPdf
          ? [{ key: 'data.toolbar.cptPdf' as const, testid: 'import-verb-cpt-pdf', onClick: handlers.cptPdf }]
          : []),
      ],
    },
    {
      key: 'data.toolbar.groupBorehole',
      testid: 'import-group-borehole',
      submenu: [
        { key: 'data.toolbar.fromDov', testid: 'import-verb-borehole-dov', onClick: handlers.boreholeDov },
        ...(handlers.boreholeXml
          ? [
              {
                key: 'data.toolbar.boreholeXml' as const,
                testid: 'import-verb-borehole-xml',
                onClick: handlers.boreholeXml,
              },
            ]
          : []),
      ],
    },
    { key: 'data.toolbar.labTests', testid: 'import-verb-lab', onClick: handlers.labTests },
    { key: 'data.toolbar.dmt', testid: 'import-verb-dmt' },
    { key: 'data.toolbar.monitoring', testid: 'import-verb-monitoring' },
  ]

  const toItem = (spec: ImportRowSpec): ToolbarDropdownItem => {
    const future = spec.onClick === undefined && spec.submenu === undefined
    return {
      label: t(spec.key),
      testid: spec.testid,
      // A group row opens its submenu instead of firing (see PortalMenu).
      onClick: spec.onClick ?? (() => undefined),
      disabled: future || busy,
      tag: future ? t('data.toolbar.phaseTag') : undefined,
      ...(spec.submenu ? { submenu: spec.submenu.map(toItem) } : {}),
    }
  }
  return specs.map(toItem)
}
