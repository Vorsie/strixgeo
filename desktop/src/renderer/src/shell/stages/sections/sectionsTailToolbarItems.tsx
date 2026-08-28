// Builder for the axis-independent tail verbs of the Sections toolbar.
//
// Extracted verbatim from ``SectionsToolbar`` (debt #201): New cross-section,
// Suggest tie-sections, Delete, the Export dropdown and the manual Recompute
// bodies verb — every verb that is shown regardless of which model axis is
// active. Pure builder — no hooks, bodies byte-identical to the inline
// original. The two menus (tie-sections caret, Export items) are declared as
// locals because each is consumed only by ``tailItems``.

import { Trash2, FileOutput, FileText, Cpu, Plus, Network, RefreshCw } from 'lucide-react'

import {
  ToolbarButton,
  ToolbarDropdown,
  PrimaryToolbarButton,
  SplitToolbarButton,
} from '../../ToolbarPrimitives'
import type { ToolbarDropdownItem } from '../../ToolbarPrimitives'
import type { ToolbarItemSpec } from '../../ResponsiveToolbarRow'
import type {
  GeologicalModelResponse,
  CrossSectionResponse,
  CptListItem,
  BoreholeListItem,
} from '../../../api/client'
import type { UseSectionsResult } from '../../../hooks/useSections'

/** Everything the axis-independent tail verbs read from ``SectionsToolbar``. */
export interface TailToolbarItemsDeps {
  isLitho: boolean
  isGeotech: boolean
  hasSection: boolean
  hasModel: boolean
  axisLevelLabel: string
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
  exportingDxf: boolean
  exportingPlaxis: boolean
  exportingPdf: boolean
  geoVerbDisabled: boolean
  geoVerbHint: string | null
  activeGeologicalModel: GeologicalModelResponse | null
  dseriesExportItems: ToolbarDropdownItem[]
  recomputingBodies: boolean
  recomputeModelId: string | null
  setAcceptingAllTies: (accepting: boolean) => void
  setPdfDialogOpen: (open: boolean) => void
  handleNew: () => Promise<void>
  handleDelete: () => void
  handleExportDxf: () => Promise<void>
  handleExportPlaxis: () => Promise<void>
  handleRecomputeBodies: () => Promise<void>
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
 *     The tail verb specs (New / Tie-sections / Delete / Export / Recompute).
 */
export function buildTailToolbarItems(deps: TailToolbarItemsDeps): ToolbarItemSpec[] {
  const {
    isLitho,
    isGeotech,
    hasSection,
    hasModel,
    axisLevelLabel,
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
    exportingDxf,
    exportingPlaxis,
    exportingPdf,
    geoVerbDisabled,
    geoVerbHint,
    activeGeologicalModel,
    dseriesExportItems,
    recomputingBodies,
    recomputeModelId,
    setAcceptingAllTies,
    setPdfDialogOpen,
    handleNew,
    handleDelete,
    handleExportDxf,
    handleExportPlaxis,
    handleRecomputeBodies,
    handleAcceptAllTies,
    handleSuggestTies,
    handleClearTieSuggestions,
  } = deps

  const tieSectionsLabel =
    suggestedTies.length > 0 ? 'Clear tie suggestions' : 'Suggest tie-sections'

  const tieSectionsMenuItems: ToolbarDropdownItem[] = [
          {
            icon: <Network size={13} />,
            label: acceptingAllTies ? 'Accepting…' : 'Accept all ties',
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
                ? 'Run "Suggest tie-sections" first'
                : acceptingAllTies
                  ? 'Creating cross-sections for all proposed ties…'
                  : 'Create a cross-section for every proposed tie',
            testid: 'tie-accept-all',
          },
        ]

  const exportMenuItems: ToolbarDropdownItem[] = [
          {
            label: exportingDxf ? 'Exporting DXF…' : 'Section DXF',
            icon: <FileOutput size={12} />,
            onClick: () => void handleExportDxf(),
            disabled: !hasSection || !hasModel || exportingDxf,
            title:
              !hasSection
                ? 'Select a section to export'
                : !hasModel
                  ? `No active ${axisLevelLabel} model — contacts must exist first`
                  : exportingDxf
                    ? 'Exporting…'
                    : `Export this section's ${axisLevelLabel} model as DXF`,
            testid: 'export-section-dxf',
          },
          {
            label: exportingPlaxis ? 'Exporting Plaxis…' : 'Plaxis 3D script',
            icon: <Cpu size={12} />,
            onClick: () => void handleExportPlaxis(),
            disabled: geoVerbDisabled || exportingPlaxis,
            title:
              geoVerbHint ??
              (activeGeologicalModel === null
                ? 'No active geological model'
                : exportingPlaxis
                  ? 'Exporting…'
                  : 'Export the geological model as a Plaxis 3D plxscripting Python script'),
            testid: 'export-plaxis-3d',
          },
          {
            // Debt #52 slice 1: section PDF report.
            label: exportingPdf ? 'Generating PDF…' : 'Section PDF report',
            icon: <FileText size={12} />,
            onClick: () => setPdfDialogOpen(true),
            disabled: !hasSection || !hasModel || exportingPdf,
            title:
              !hasSection
                ? 'Select a section to export'
                : !hasModel
                  ? `No active ${axisLevelLabel} model — define one first`
                  : exportingPdf
                    ? 'Generating PDF…'
                    : `Generate a PDF report of this section's ${axisLevelLabel} model`,
            testid: 'export-section-pdf',
          },
          ...dseriesExportItems,
        ]

  const recomputeTitle =
    recomputeModelId === null
      ? `No active ${isGeotech ? 'geotech' : 'lithostratigraphic'} model to recompute`
      : recomputingBodies
        ? 'Recomputing…'
        : 'Re-derive the persisted geometric body identity from the current sections now'

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
      label: creating ? 'Creating…' : 'New cross-section',
      separatorBefore: true,
      overflowItems: [
        {
          label: 'New cross-section',
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
          label={creating ? 'Creating…' : 'New cross-section'}
          onClick={handleNew}
          disabled={!canCreate || creating}
          busy={creating}
          title={
            crsBlockReason !== null
              ? crsBlockReason
              : creating
                ? 'Creating…'
                : 'Create a new cross-section (placeholder endpoints)'
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
              ? 'Need at least 2 sections to tie together'
              : suggestedTies.length > 0
                ? 'Clear the current tie-section suggestions'
                : 'Suggest perpendicular connector sections between existing sections (no crossings, no shared tests)'
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
      label: deleting ? 'Deleting…' : 'Delete',
      iconOnly: false,
      separatorBefore: true,
      overflowItems: [
        {
          label: 'Delete cross-section…',
          icon: <Trash2 size={12} />,
          onClick: handleDelete,
          disabled: !hasSection || deleting,
          title: hasSection
            ? `Delete "${selectedSection?.name}" — asks for confirmation first`
            : 'Select a cross-section to delete it',
        },
      ],
      render: () => (
        <ToolbarButton
          icon={<Trash2 size={13} />}
          label={deleting ? 'Deleting…' : 'Delete'}
          onClick={handleDelete}
          disabled={!hasSection || deleting}
          busy={deleting}
          danger
          title={
            !hasSection
              ? 'Select a cross-section to delete it'
              : deleting
                ? 'Deleting…'
                : `Delete "${selectedSection?.name}"`
          }
        />
      ),
    },

    /* Debt #93: Export DXF + Plaxis 3D collapsed under one "Export ▾"
        dropdown to declutter the main toolbar.  Both verbs are still
        one click away (trigger + item) but the toolbar no longer
        dedicates two slots to them.  The trigger disables when
        neither item would be reachable.

        'medium' — the deliverable step, run at the end of a session. */
    {
      id: 'sections-toolbar-export-dropdown',
      priority: 'medium',
      kind: 'dropdown',
      label: 'Export',
      separatorBefore: true,
      overflowItems: exportMenuItems,
      render: p => (
        <ToolbarDropdown
          iconOnly={p === 'icon'}
          icon={<FileOutput size={13} />}
          label="Export"
          disabled={
            (!hasSection || !hasModel || exportingDxf) && (geoVerbDisabled || exportingPlaxis)
          }
          title={
            exportingDxf || exportingPlaxis ? 'Exporting…' : 'Export the model or this section'
          }
          testid="sections-toolbar-export-dropdown"
          items={exportMenuItems}
        />
      ),
    },

    /* Manual body-identity recompute (slice 5) — acts on the ACTIVE axis's
        model (litho / geotech). The debounced background recompute usually
        keeps identity current; this is the explicit "do it now" escape hatch
        (and the one path that toasts recompute errors).

        'low' — an escape hatch for a job that normally runs itself. It is the
        first control on the whole bar to give up its label, and the first to
        fold into ⋯ More. */
    ...(isLitho || isGeotech
      ? [
          {
            id: 'sections-recompute-bodies',
            priority: 'low' as const,
            kind: 'button' as const,
            label: recomputingBodies ? 'Recomputing…' : 'Recompute bodies',
            overflowItems: [
              {
                label: 'Recompute bodies',
                icon: <RefreshCw size={12} />,
                onClick: () => void handleRecomputeBodies(),
                disabled: recomputeModelId === null || recomputingBodies,
                title: recomputeTitle,
              },
            ],
            render: (p: 'full' | 'compact' | 'icon') => (
              <ToolbarButton
                iconOnly={p === 'icon'}
                icon={<RefreshCw size={13} />}
                label={recomputingBodies ? 'Recomputing…' : 'Recompute bodies'}
                onClick={() => void handleRecomputeBodies()}
                disabled={recomputeModelId === null || recomputingBodies}
                busy={recomputingBodies}
                title={recomputeTitle}
                testid="sections-recompute-bodies"
              />
            ),
          },
        ]
      : []),
  ]

  return tailItems
}
