// Builder for the geotech-axis verbs of the Sections toolbar.
//
// Extracted verbatim from ``SectionsToolbar`` (debt #201). Pure builder — no
// hooks, bodies byte-identical to the inline original. The three menus live in
// ``sectionsGeotechMenuItems``; this module folds them into the statistic +
// pipeline dropdowns, the two live chips (pending tie / stale litho) and the
// Correlate-packing + Display verbs.

import { GitMerge, Network, Eye, SplitSquareVertical, FlaskConical } from 'lucide-react'

import { ToolbarButton, ToolbarDropdown } from '../../ToolbarPrimitives'
import type { ToolbarItemSpec } from '../../ResponsiveToolbarRow'
import { DEFAULT_TOOLBAR_METRICS } from '../../toolbarOverflow_constants'
import { PENDING_CHIP_BASE_PX } from './sectionsToolbar_constants'
import AttentionChip from '../../../components/sections/AttentionChip'
import { pendingChipLabel, pendingChipTitle } from '../../../utils/geotechPendingScope'
import {
  staleGeotechChipLabel,
  staleGeotechChipTitle,
} from '../../../utils/staleGeotechColumns'
import {
  buildGeotechStatisticMenuItems,
  buildGeotechPipelineMenuItems,
  buildGeotechDisplayMenuItems,
  type GeotechToolbarItemsDeps,
} from './sectionsGeotechMenuItems'

export type { GeotechToolbarItemsDeps } from './sectionsGeotechMenuItems'

/**
 * Build the geotech-axis toolbar item specs.
 *
 * Returns an empty array on any other axis (the pipeline dropdowns already
 * guard on ``isGeotech``, and the two chips gate on their own render
 * conditions); the caller spreads the result into the toolbar row.
 *
 * Parameters
 * ----------
 * deps : GeotechToolbarItemsDeps
 *     The toolbar's derived state + handlers.
 *
 * Returns
 * -------
 * ToolbarItemSpec[]
 *     The geotech-axis verb specs.
 */
export function buildGeotechToolbarItems(deps: GeotechToolbarItemsDeps): ToolbarItemSpec[] {
  const {
    t,
    isGeotech,
    geotechStatistic,
    subdividingBodies,
    autoCorrelatingGeotech,
    acceptingGeotechCorrelations,
    dividingBoreholes,
    tieStatus,
    pendingScope,
    handleRevealPendingTie,
    staleGeotechColumns,
    correlateMode,
    activeGeotechModel,
    enterCorrelateMode,
    exitCorrelateMode,
  } = deps

  const geotechStatisticMenuItems = buildGeotechStatisticMenuItems(deps)
  const geotechPipelineMenuItems = buildGeotechPipelineMenuItems(deps)
  const geotechDisplayMenuItems = buildGeotechDisplayMenuItems(deps)

  const geotechPipelineLabel = subdividingBodies
    ? t('sections.busy.subdividing')
    : autoCorrelatingGeotech
      ? t('sections.busy.correlating')
      : acceptingGeotechCorrelations
        ? t('sections.busy.accepting')
        : dividingBoreholes
          ? t('sections.busy.dividing')
          : t('sections.geotech.pipeline')

  const geotechItems: ToolbarItemSpec[] = !isGeotech
    ? []
    : [
        /* FIRST in the geotech bar, ahead of the pipeline, because it is a
            choice made BEFORE subdividing rather than a view option after it
            (owner, 2026-08-09: "add it before subdivide cpt's ... the user
            chooses before subdividing"). It is a per-model choice and part of
            that model's provenance.

            The current token is in the LABEL, not only inside the menu: the
            whole point of putting it first is that the engineer can see what
            the next subdivide will classify with, without opening anything.

            That ruling is exactly why ``iconOnly: false`` — an icon-only form
            would hide the token and defeat the reason the control sits here.
            'high' because it gates every subsequent press; when the bar does
            run out of room it folds to a labelled menu row, token intact. */
        {
          id: 'geotech-statistic-menu',
          priority: 'high',
          kind: 'dropdown',
          label: t('sections.geotech.qcLabel', { statistic: geotechStatistic }),
          iconOnly: false,
          separatorBefore: true,
          overflowItems: geotechStatisticMenuItems,
          render: () => (
            <ToolbarDropdown
              icon={<FlaskConical size={13} />}
              label={t('sections.geotech.qcLabel', { statistic: geotechStatistic })}
              title={t('sections.geotech.statisticMenuTitle')}
              testid="geotech-statistic-menu"
              items={geotechStatisticMenuItems}
            />
          ),
        },

        /* THE FOUR-STEP PIPELINE, folded into one dropdown (owner dogfeed
            2026-08-05 — the four inline buttons crowded the bar, debt #23).
            The pending chip stays OUTSIDE the menu: it is the number step 4
            is gated on and must be visible without opening anything. Gate
            info that used to live in hover tooltips moves onto visible tag
            pills — a disabled menu item cannot show a title in Chromium.

            'high' — this IS the geotech stage's work. It is the last control
            on this bar to give up its label. */
        {
          id: 'geotech-pipeline',
          priority: 'high',
          kind: 'dropdown',
          label: geotechPipelineLabel,
          overflowItems: geotechPipelineMenuItems,
          render: p => (
            <ToolbarDropdown
              iconOnly={p === 'icon'}
              icon={<SplitSquareVertical size={13} />}
              label={geotechPipelineLabel}
              title={t('sections.toolbar.packingFlowHint')}
              testid="geotech-pipeline"
              items={geotechPipelineMenuItems}
            />
          ),
        },

        /* The pending chip — OUTSIDE the pipeline menu on purpose: it is the
            number step 4 is gated on and must be visible without opening
            anything. 'high' + never an icon and never folded (empty
            overflowItems): a count that is only visible after two clicks is
            not a gate read-out any more. It renders only while a tie is
            actually pending, so it is never standing weight. */
        ...(tieStatus.loaded && tieStatus.pending > 0
          ? [
              {
                id: 'geotech-pending-tie-chip',
                priority: 'high' as const,
                kind: 'custom' as const,
                label: pendingChipLabel(t, pendingScope),
                iconOnly: false,
                widthPx: {
                  full:
                    PENDING_CHIP_BASE_PX +
                    pendingChipLabel(t, pendingScope).length *
                      DEFAULT_TOOLBAR_METRICS.charAdvancePx,
                },
                overflowItems: [],
                render: () => (
                  <AttentionChip
                    label={pendingChipLabel(t, pendingScope)}
                    title={pendingChipTitle(t, pendingScope, tieStatus.accepted)}
                    // Interactive only where this section HAS a pending tie to
                    // find. With the count scoped elsewhere in the model (the
                    // "0 pending here" case) there is nothing on this canvas to
                    // centre, so the chip stays the plain label it has always been.
                    onReveal={
                      pendingScope.sectionPending === null || pendingScope.sectionPending > 0
                        ? handleRevealPendingTie
                        : undefined
                    }
                  />
                ),
              },
            ]
          : []),

        /* Debt #266 — the columns standing on litho that has since been
            edited. Outside the pipeline menu for the same reason as the
            pending chip: it says a client-facing export would ship stale
            packing, and a warning only visible after two clicks is not a
            warning. Amber, never red — the project's dirty/stale colour; the
            bands are out of date, not wrong. Passive: unlike the pending-tie
            chip there is no single "next" thing to centre (the columns can sit
            on any section), so it names them in the tooltip instead of
            offering a jump it cannot honour. Renders only while something is
            stale, so it is never standing weight. */
        ...(isGeotech && staleGeotechColumns.length > 0
          ? [
              {
                id: 'geotech-stale-litho-chip',
                priority: 'high' as const,
                kind: 'custom' as const,
                label: staleGeotechChipLabel(t, staleGeotechColumns.length),
                iconOnly: false,
                widthPx: {
                  full:
                    PENDING_CHIP_BASE_PX +
                    staleGeotechChipLabel(t, staleGeotechColumns.length).length *
                      DEFAULT_TOOLBAR_METRICS.charAdvancePx,
                },
                overflowItems: [],
                render: () => (
                  <AttentionChip
                    testid="geotech-stale-litho-chip"
                    label={staleGeotechChipLabel(t, staleGeotechColumns.length)}
                    title={staleGeotechChipTitle(t, staleGeotechColumns)}
                  />
                ),
              },
            ]
          : []),

        /* The hatched-ghost legend + clamped-band notice moved to the
            right-hand inspector (owner dogfeed 2026-08-05) — prose was
            overflowing the toolbar. See SectionsInspector's Borehole
            preview section. */
        /* "Correlate packing" — manual same-class/same-body packing connection.
            Reuses the litho correlate state machine (correlateMode) on the geotech
            axis so clicking a packing band arms a source; clicking a neighbour's
            same-class-same-body band connects them. Right-click a connection to
            disconnect (Disconnect verb in the correlation-edge context menu).
            Gated on activeGeotechModel: the geotech model must exist (i.e. the
            user has run "Subdivide all bodies" at least once) for there to be
            packing bands to correlate.

            'high', never icon-only: like the litho Correlate, the label is the
            mode read-out ("Correlate · click 2 bands"). */
        {
          id: 'geotech-correlate-packing',
          priority: 'high',
          kind: 'button',
          label: correlateMode ? t('sections.litho.correlateActive') : t('sections.geotech.correlatePacking'),
          iconOnly: false,
          overflowItems: [
            {
              icon: <GitMerge size={12} />,
              label: correlateMode
                ? t('sections.geotech.exitPackingCorrelate')
                : t('sections.geotech.correlatePackingByHand'),
              // Same letter as the litho axis's correlate — one key, one verb,
              // whichever axis is under the cursor (owner 2026-08-31).
              shortcut: 'c',
              onClick: () => (correlateMode ? exitCorrelateMode() : enterCorrelateMode()),
              disabled: activeGeotechModel === null && !correlateMode,
            },
          ],
          render: () => (
            <ToolbarButton
              icon={<GitMerge size={13} />}
              label={correlateMode ? t('sections.litho.correlateActive') : t('sections.geotech.correlatePacking')}
              onClick={() => (correlateMode ? exitCorrelateMode() : enterCorrelateMode())}
              // Keep clickable while correlateMode is on so the user can exit even
              // when no packing contacts exist on the section (mirrors litho CT8).
              disabled={activeGeotechModel === null && !correlateMode}
              title={
                activeGeotechModel === null
                  ? t('sections.geotech.correlatePackingNoModel')
                  : correlateMode
                    ? t('sections.geotech.exitPackingCorrelateEsc')
                    : t('sections.geotech.correlatePackingTitle')
              }
              amber={correlateMode}
              testid="geotech-correlate-packing"
            />
          ),
        },

        /* View toggles folded into one Display dropdown (owner dogfeed
            2026-08-05 — two standing toggle buttons were toolbar weight for
            verbs used occasionally). Same testids, same behaviour.

            'medium' — pure view state; hiding it costs the engineer a click,
            never a step of the pipeline. */
        {
          id: 'geotech-display-menu',
          priority: 'medium',
          kind: 'dropdown',
          label: t('sections.toolbar.display'),
          overflowItems: geotechDisplayMenuItems,
          render: p => (
            <ToolbarDropdown
              iconOnly={p === 'icon'}
              icon={<Eye size={13} />}
              label={t('sections.toolbar.display')}
              title={t('sections.toolbar.showLayers')}
              testid="geotech-display-menu"
              items={geotechDisplayMenuItems}
            />
          ),
        },
      ]

  return geotechItems
}
