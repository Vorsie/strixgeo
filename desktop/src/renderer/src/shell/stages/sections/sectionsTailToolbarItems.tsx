// Builder for the axis-independent tail verbs of the Sections toolbar.
//
// Extracted verbatim from ``SectionsToolbar`` (debt #201): New cross-section,
// Suggest tie-sections, Delete, the Export dropdown — every verb that is
// shown regardless of which model axis is
// active. Pure builder — no hooks, bodies byte-identical to the inline
// original. The two menus (tie-sections caret, Export items) are declared as
// locals because each is consumed only by ``tailItems``.

import { Trash2, FileOutput, Plus, Network } from 'lucide-react'

import {
  ToolbarButton,
  PrimaryToolbarButton,
  SplitToolbarButton,
} from '../../ToolbarPrimitives'
import type { ToolbarDropdownItem } from '../../ToolbarPrimitives'
import type { ToolbarItemSpec } from '../../ResponsiveToolbarRow'
import { SECTIONS_OVERFLOW_GROUP } from './sectionsToolbar_constants'
import type {
  CrossSectionResponse,
  CptListItem,
  BoreholeListItem,
} from '../../../api/client'
import type { UseSectionsResult } from '../../../hooks/useSections'
import type { Translator } from '../../../i18n/translate'

/** Everything the axis-independent tail verbs read from ``SectionsToolbar``. */
export interface TailToolbarItemsDeps {
  /** Active-language translator, threaded from the toolbar so a language flip
   *  re-renders every verb in one pass. */
  t: Translator
  hasSection: boolean
  creating: boolean
  deleting: boolean
  canCreate: boolean
  crsBlockReason: string | null
  selectedSection: CrossSectionResponse | null
  sections: CrossSectionResponse[]
  visibleCpts: CptListItem[]
  visibleBoreholes: BoreholeListItem[]
  suggestedTies: UseSectionsResult['suggestedTies']
  acceptingAllTies: boolean
  setAcceptingAllTies: (accepting: boolean) => void
  handleNew: () => Promise<void>
  handleDelete: () => void
  /** Open the Export hub scoped to the current section + axis (installer #35 —
   *  the Export stage is the only export surface). */
  onOpenExportHub: () => void
  handleAcceptAllTies: UseSectionsResult['handleAcceptAllTies']
  handleSuggestTies: UseSectionsResult['handleSuggestTies']
  handleClearTieSuggestions: UseSectionsResult['handleClearTieSuggestions']
}

/**
 * Build the axis-independent tail toolbar item specs.
 *
 * Parameters
 * ----------
 * deps : TailToolbarItemsDeps
 *     The toolbar's derived state + handlers.
 *
 * Returns
 * -------
 * ToolbarItemSpec[]
 *     The tail verb specs (New / Tie-sections / Delete / Export).
 */
export function buildTailToolbarItems(deps: TailToolbarItemsDeps): ToolbarItemSpec[] {
  const {
    t,
    hasSection,
    creating,
    deleting,
    canCreate,
    crsBlockReason,
    selectedSection,
    sections,
    visibleCpts,
    visibleBoreholes,
    suggestedTies,
    acceptingAllTies,
    setAcceptingAllTies,
    handleNew,
    handleDelete,
    onOpenExportHub,
    handleAcceptAllTies,
    handleSuggestTies,
    handleClearTieSuggestions,
  } = deps

  const tieSectionsLabel =
    suggestedTies.length > 0 ? t('sections.tie.clearSuggestions') : t('sections.tie.suggestSections')

  const tieSectionsMenuItems: ToolbarDropdownItem[] = [
          {
            icon: <Network size={13} />,
            label: acceptingAllTies ? t('sections.busy.accepting') : t('sections.tie.acceptAll'),
            onClick: () =>
              void (async () => {
                setAcceptingAllTies(true)
                try {
                  await handleAcceptAllTies()
                } finally {
                  setAcceptingAllTies(false)
                }
              })(),
            disabled: suggestedTies.length === 0 || acceptingAllTies,
            title:
              suggestedTies.length === 0
                ? t('sections.tie.acceptAllRunFirst')
                : acceptingAllTies
                  ? t('sections.tie.acceptAllBusy')
                  : t('sections.tie.acceptAllTitle'),
            testid: 'tie-accept-all',
          },
        ]

  const tailItems: ToolbarItemSpec[] = [
    /* New cross-section — primary entry action, visually distinct from
        the secondary verbs so first-time users can find it immediately.
        Accent-filled button separates it from the grey text-only verbs
        that follow.

        'high' — the one verb a user with an empty project needs to find,
        and the accent fill is the toolbar's single strongest signal. */
    {
      id: 'sections-new',
      priority: 'high',
      kind: 'button',
      label: creating ? t('sections.busy.creating') : t('sections.tail.newSection'),
      separatorBefore: true,
      overflowGroup: SECTIONS_OVERFLOW_GROUP.section,
      overflowItems: [
        {
          label: t('sections.tail.newSection'),
          icon: <Plus size={12} />,
          onClick: handleNew,
          disabled: !canCreate || creating,
          title: crsBlockReason ?? undefined,
        },
      ],
      render: p => (
        <PrimaryToolbarButton
          iconOnly={p === 'icon'}
          icon={<Plus size={13} />}
          label={creating ? t('sections.busy.creating') : t('sections.tail.newSection')}
          onClick={handleNew}
          testid="section-create"
          disabled={!canCreate || creating}
          busy={creating}
          title={
            crsBlockReason !== null
              ? crsBlockReason
              : creating
                ? t('sections.busy.creating')
                : t('sections.tail.newSectionTitle')
          }
        />
      ),
    },

    /* Tie-sections collapsed into one SplitToolbarButton (dogfeed
        2026-06-10). Primary = Suggest ↔ Clear toggle (amber while ghosts
        are pending so the user always sees there are suggestions to act
        on, and always has a visible way to dismiss them). Caret =
        Accept all ties. Three verbs → one toolbar slot, mirroring the
        correlation triad.

        'medium' — run once per project layout, not per section. */
    {
      id: 'suggest-tie-sections',
      priority: 'medium',
      kind: 'split',
      label: tieSectionsLabel,
      overflowGroup: SECTIONS_OVERFLOW_GROUP.section,
      overflowItems: [
        {
          icon: <Network size={12} />,
          label: tieSectionsLabel,
          onClick: () =>
            suggestedTies.length > 0
              ? handleClearTieSuggestions()
              : handleSuggestTies(visibleCpts, visibleBoreholes),
          disabled: sections.length < 2,
        },
        ...tieSectionsMenuItems,
      ],
      render: p => (
        <SplitToolbarButton
          iconOnly={p === 'icon'}
          icon={<Network size={13} />}
          label={tieSectionsLabel}
          onClick={() =>
            suggestedTies.length > 0
              ? handleClearTieSuggestions()
              : handleSuggestTies(visibleCpts, visibleBoreholes)
          }
          disabled={sections.length < 2}
          title={
            sections.length < 2
              ? t('sections.tie.needTwo')
              : suggestedTies.length > 0
                ? t('sections.tie.clearTitle')
                : t('sections.tie.suggestTitle')
          }
          amber={suggestedTies.length > 0}
          testid="suggest-tie-sections"
          items={tieSectionsMenuItems}
        />
      ),
    },

    /* Delete section — only active when one is selected.
        ``iconOnly: false`` per docs/ux.md: a bare trash icon is not an
        acceptable presentation for an irreversible verb — a mis-click costs
        the user a cross-section and every contact placed on it. It keeps its
        label, or becomes the fully-spelled "Delete cross-section" menu row. */
    {
      id: 'sections-delete',
      priority: 'medium',
      kind: 'button',
      label: deleting ? t('sections.busy.deleting') : t('sections.tail.delete'),
      iconOnly: false,
      separatorBefore: true,
      overflowGroup: SECTIONS_OVERFLOW_GROUP.section,
      overflowItems: [
        {
          label: t('sections.tail.deleteSectionMenu'),
          icon: <Trash2 size={12} />,
          onClick: handleDelete,
          disabled: !hasSection || deleting,
          title: hasSection
            ? t('sections.tail.deleteConfirmMenuTitle', { name: selectedSection?.name ?? '' })
            : t('sections.tail.deleteSelectFirst'),
        },
      ],
      render: () => (
        <ToolbarButton
          icon={<Trash2 size={13} />}
          label={deleting ? t('sections.busy.deleting') : t('sections.tail.delete')}
          onClick={handleDelete}
          disabled={!hasSection || deleting}
          busy={deleting}
          danger
          testid="sections-delete"
          title={
            !hasSection
              ? t('sections.tail.deleteSelectFirst')
              : deleting
                ? t('sections.busy.deleting')
                : t('sections.tail.deleteTitle', { name: selectedSection?.name ?? '' })
          }
        />
      ),
    },

    /* Export… — ONE verb that opens the Export hub scoped to the open
        section + axis (installer #35, owner ruling: "remove all exports in
        other places ... move it all to the export pane"). Every export (DXF,
        Plaxis 2D/3D, D-Stability, D-Sheet, PDF, fence) now lives on the Export
        stage; the toolbar just jumps there with the section preselected.

        'medium' — the deliverable step, run at the end of a session. */
    {
      id: 'sections-toolbar-export',
      priority: 'medium',
      kind: 'button',
      label: t('sections.toolbar.export'),
      separatorBefore: true,
      overflowGroup: SECTIONS_OVERFLOW_GROUP.export,
      overflowItems: [
        {
          label: t('sections.toolbar.export'),
          icon: <FileOutput size={12} />,
          onClick: onOpenExportHub,
          disabled: !hasSection,
          title: hasSection
            ? t('sections.export.hubJumpTitle')
            : t('sections.export.selectSection'),
          testid: 'sections-toolbar-export',
        },
      ],
      render: p => (
        <ToolbarButton
          iconOnly={p === 'icon'}
          icon={<FileOutput size={13} />}
          label={t('sections.toolbar.export')}
          onClick={onOpenExportHub}
          disabled={!hasSection}
          testid="sections-toolbar-export"
          title={
            hasSection
              ? t('sections.export.hubJumpTitle')
              : t('sections.export.selectSection')
          }
        />
      ),
    },
    // The manual "Recompute bodies" verb was removed (owner ruling 6,
    // 2026-09-12: "Seems like a useless button to me"). Body identity is kept
    // current by the automatic recompute (debounced after every mutation + once
    // on project open, in ``useProjectBodyRecompute``); a background failure now
    // surfaces as a warning toast, so the user still learns when it did not
    // persist without a button to press.
  ]

  return tailItems
}
