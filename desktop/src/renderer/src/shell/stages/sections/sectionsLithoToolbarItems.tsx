// Builder for the litho-axis verbs of the Sections toolbar.
//
// Extracted verbatim from ``SectionsToolbar`` (debt #201). This is a PURE
// builder — it takes the toolbar's already-derived state + handlers and returns
// the ``ToolbarItemSpec[]`` for the litho axis. It calls no hooks, so it carries
// no hook-ordering risk; every item body is byte-identical to the inline
// original. The four caret/dropdown menus live in ``sectionsLithoMenuItems``.

import { Sparkles, Eraser, GitMerge, FlaskConical, Layers } from 'lucide-react'

import { ToolbarButton, ToolbarDropdown, SplitToolbarButton } from '../../ToolbarPrimitives'
import type { ToolbarItemSpec } from '../../ResponsiveToolbarRow'
import {
  buildLithoSuggestMenuItems,
  buildLithoCorrelateMenuItems,
  buildLithoBodiesMenuItems,
  buildLithoAdmixtureMenuItems,
  type LithoToolbarItemsDeps,
} from './sectionsLithoMenuItems'

export type { LithoToolbarItemsDeps, SectionSuggestAnchor } from './sectionsLithoMenuItems'

/**
 * Build the litho-axis toolbar item specs.
 *
 * Returns an empty array on any other axis (the menus themselves already guard
 * on ``isLitho``); the caller spreads the result into the toolbar row.
 *
 * Parameters
 * ----------
 * deps : LithoToolbarItemsDeps
 *     The toolbar's derived state + handlers.
 *
 * Returns
 * -------
 * ToolbarItemSpec[]
 *     The litho-axis verb specs.
 */
export function buildLithoToolbarItems(deps: LithoToolbarItemsDeps): ToolbarItemSpec[] {
  const {
    t,
    isLitho,
    hasSection,
    activeLithoModel,
    lithoSuggesting,
    bulkLithoSuggesting,
    suggestPrimaryMode,
    bulkAnchors,
    bulkAnchorCount,
    hasSuggestions,
    acceptingAll,
    acceptingAllBulk,
    correlateMode,
    sectionHasLithoContacts,
    sectionFocusedColumn,
    cptGhostCount,
    boreholeGhostCount,
    setBulkConfirmOpen,
    handleSuggest,
    handleAcceptAll,
    handleAcceptAllBulk,
    clearLithoSuggestions,
    clearBulkLithoGhosts,
    enterCorrelateMode,
    exitCorrelateMode,
  } = deps

  const suggestLabel =
    lithoSuggesting || bulkLithoSuggesting
      ? t('sections.busy.suggesting')
      : suggestPrimaryMode === 'all'
        ? `${t('sections.litho.suggestAll')}${bulkAnchors.length > 0 ? ` (${bulkAnchors.length})` : ''}`
        : t('sections.litho.suggest')

  const lithoSuggestMenuItems = buildLithoSuggestMenuItems(deps)
  const lithoCorrelateMenuItems = buildLithoCorrelateMenuItems(deps)
  const lithoBodiesMenuItems = buildLithoBodiesMenuItems(deps)
  const lithoAdmixtureMenuItems = buildLithoAdmixtureMenuItems(deps)

  const lithoItems: ToolbarItemSpec[] = !isLitho
    ? []
    : [
      /* Suggest split-button (debt #97). Primary action = single-anchor
          Suggest litho on the focused column; caret menu items = the
          bulk variants (all in section / for new tests). Collapses the
          previous Suggest×3 widgets into one toolbar slot — the most
          common verb stays one click away, the variants are one
          additional click. Pending-state pills (Accept all / Clear)
          stay as transient widgets that only render while ghosts
          exist.

          'high' — the litho stage's entry verb. It is pressed on every
          column of every section, so it holds its label longest. */
      {
        id: 'litho-suggest',
        priority: 'high',
        kind: 'split',
        label: suggestLabel,
        separatorBefore: true,
        overflowItems: [
          {
            label: suggestLabel,
            icon: <Sparkles size={12} />,
            // Letter keys on the litho verbs (owner 2026-08-31: "make an
            // analogy with the geotech stage ... like (f), (l) those
            // shortcuts") — the litho flow is not numbered, so mnemonics.
            shortcut: 's',
            onClick:
              suggestPrimaryMode === 'all'
                ? () => setBulkConfirmOpen(true)
                : () => void handleSuggest(),
            disabled:
              suggestPrimaryMode === 'disabled' || lithoSuggesting || bulkLithoSuggesting,
          },
          ...lithoSuggestMenuItems,
        ],
        render: p => (
          <SplitToolbarButton
            iconOnly={p === 'icon'}
            icon={<Sparkles size={13} />}
            label={suggestLabel}
            onClick={
              suggestPrimaryMode === 'all'
                ? () => setBulkConfirmOpen(true)
                : () => void handleSuggest()
            }
            disabled={
              suggestPrimaryMode === 'disabled' ||
              lithoSuggesting ||
              bulkLithoSuggesting
            }
            busy={lithoSuggesting || bulkLithoSuggesting}
            title={
              !activeLithoModel
                ? t('sections.litho.createModelFirst')
                : !hasSection
                  ? t('sections.litho.openSectionSuggest')
                  : lithoSuggesting
                    ? t('sections.litho.fetchingSuggestions')
                    : suggestPrimaryMode === 'all'
                      ? t('sections.litho.suggestAllTitle', { n: bulkAnchors.length })
                      : suggestPrimaryMode === 'disabled'
                        ? t('sections.litho.suggestFocusHint')
                        : t('sections.litho.suggestForColumn', {
                            column:
                              sectionFocusedColumn?.name ??
                              t('sections.litho.theFocusedInvestigation'),
                          })
            }
            testid="litho-suggest"
            items={lithoSuggestMenuItems}
          />
        ),
      },

      // The transient accept / clear pills. They render ONLY while ghosts are
      // pending, and they are the resolution of that pending state, so they
      // are 'high': hiding the way to commit or dismiss work-in-progress is
      // worse than hiding a standing verb.
      ...(hasSuggestions
        ? [
            {
              id: 'litho-accept-all',
              priority: 'high' as const,
              kind: 'button' as const,
              label: acceptingAll ? t('sections.busy.accepting') : t('sections.litho.acceptAll'),
              overflowItems: [
                {
                  label: t('sections.toolbar.acceptAllSuggestions'),
                  icon: <Sparkles size={12} />,
                  shortcut: 'a',
                  onClick: () => void handleAcceptAll(),
                  disabled: acceptingAll,
                },
              ],
              render: (p: 'full' | 'compact' | 'icon') => (
                /* Accept all pending (non-rejected) layers in one bulk call. */
                <ToolbarButton
                  icon={<Sparkles size={13} />}
                  label={acceptingAll ? t('sections.busy.accepting') : t('sections.litho.acceptAll')}
                  iconOnly={p === 'icon'}
                  onClick={() => void handleAcceptAll()}
                  disabled={acceptingAll}
                  busy={acceptingAll}
                  testid="litho-accept-all"
                  title={
                    acceptingAll
                      ? t('sections.litho.committingSuggestions')
                      : t('sections.litho.acceptAllTitle')
                  }
                />
              ),
            },
            {
              id: 'litho-clear',
              priority: 'high' as const,
              kind: 'button' as const,
              label: t('sections.litho.clear'),
              overflowItems: [
                {
                  label: t('sections.toolbar.clearLithoSuggestions'),
                  icon: <Eraser size={12} />,
                  onClick: clearLithoSuggestions,
                },
              ],
              render: (p: 'full' | 'compact' | 'icon') => (
                <ToolbarButton
                  icon={<Eraser size={13} />}
                  label={t('sections.litho.clear')}
                  iconOnly={p === 'icon'}
                  onClick={clearLithoSuggestions}
                  title={t('sections.toolbar.dismissLithoGhost')}
                />
              ),
            },
          ]
        : []),
      ...(bulkAnchorCount > 0
        ? [
            {
              id: 'litho-accept-all-bulk',
              priority: 'high' as const,
              kind: 'button' as const,
              label: acceptingAllBulk ? t('sections.busy.accepting') : t('sections.litho.acceptAllBulk'),
              overflowItems: [
                {
                  label: t('sections.toolbar.acceptAllBulkSuggestions'),
                  icon: <Sparkles size={12} />,
                  onClick: () => void handleAcceptAllBulk(),
                  disabled: acceptingAllBulk,
                },
              ],
              render: (p: 'full' | 'compact' | 'icon') => (
                <ToolbarButton
                  icon={<Sparkles size={13} />}
                  label={acceptingAllBulk ? t('sections.busy.accepting') : t('sections.litho.acceptAllBulk')}
                  iconOnly={p === 'icon'}
                  onClick={() => void handleAcceptAllBulk()}
                  disabled={acceptingAllBulk}
                  busy={acceptingAllBulk}
                  testid="litho-accept-all-bulk"
                  title={
                    acceptingAllBulk
                      ? t('sections.litho.committingBulk')
                      : t('sections.litho.acceptAllBulkTitle', {
                          n: bulkAnchorCount,
                          investigation: t(
                            bulkAnchorCount === 1
                              ? 'sections.litho.investigationOne'
                              : 'sections.litho.investigationMany',
                          ),
                        })
                  }
                />
              ),
            },
            {
              id: 'litho-clear-bulk',
              priority: 'high' as const,
              kind: 'button' as const,
              label: t('sections.litho.clearBulk'),
              overflowItems: [
                {
                  label: t('sections.toolbar.clearBulkGhosts'),
                  icon: <Eraser size={12} />,
                  onClick: clearBulkLithoGhosts,
                },
              ],
              render: (p: 'full' | 'compact' | 'icon') => (
                <ToolbarButton
                  icon={<Eraser size={13} />}
                  label={t('sections.litho.clearBulk')}
                  iconOnly={p === 'icon'}
                  onClick={clearBulkLithoGhosts}
                  title={t('sections.toolbar.dismissBulkGhosts')}
                />
              ),
            },
          ]
        : []),

      /* Correlation triad collapsed into a SplitToolbarButton
          (#141 dogfeed 2026-05-27).  Primary verb = Correlate mode
          toggle (single click to enter/exit — preserves the existing
          ergonomics CT4/CT5 pin).  Caret items = Auto-correlate +
          Accept correlations.  Three buttons → one toolbar slot.
          The mode-active affordance (amber tint when correlateMode
          is on) stays on the primary half so the user always sees
          "you're in correlate mode" without opening the menu.

          'high', and NEVER icon-only: the label doubles as the mode
          read-out ("Correlate · click 2 bands"), so an icon would hide
          the one thing that tells the user why their next click behaves
          differently. It folds to a labelled menu row instead. */
      {
        id: 'correlate-mode',
        priority: 'high',
        kind: 'split',
        label: correlateMode ? t('sections.litho.correlateActive') : t('sections.litho.correlate'),
        iconOnly: false,
        overflowItems: [
          {
            icon: <GitMerge size={12} />,
            label: correlateMode ? t('sections.litho.exitCorrelate') : t('sections.litho.enterCorrelate'),
            shortcut: 'c',
            onClick: () => (correlateMode ? exitCorrelateMode() : enterCorrelateMode()),
            disabled:
              !activeLithoModel || !hasSection || (!correlateMode && !sectionHasLithoContacts),
          },
          ...lithoCorrelateMenuItems,
        ],
        render: p => (
          <SplitToolbarButton
            iconOnly={p === 'icon'}
            icon={<GitMerge size={13} />}
            label={correlateMode ? t('sections.litho.correlateActive') : t('sections.litho.correlate')}
            onClick={() => (correlateMode ? exitCorrelateMode() : enterCorrelateMode())}
            // While correlate mode is on, keep the primary clickable so
            // the user can exit even with 0 contacts on the section
            // (debt #139 CT8); otherwise the only escape is Esc, which
            // isn't discoverable.
            disabled={
              !activeLithoModel
              || !hasSection
              || (!correlateMode && !sectionHasLithoContacts)
            }
            title={
              !activeLithoModel
                ? t('sections.litho.createModelFirst')
                : !hasSection
                  ? t('sections.litho.openSectionCorrelate')
                  : !correlateMode && !sectionHasLithoContacts
                    ? t('sections.litho.acceptFirstToCorrelate')
                    : correlateMode
                      ? t('sections.litho.exitCorrelateEsc')
                      : t('sections.litho.enterCorrelateTitle')
            }
            amber={correlateMode}
            testid="correlate-mode"
            items={lithoCorrelateMenuItems}
          />
        ),
      },

      /* Bodies dropdown (dogfeed 2026-06-01) — congregates every body /
          lens action under one trigger to keep the toolbar uncluttered:
          Detect lenses, Suggest pinch-outs, and the bulk "Delete all
          detected lenses". Each item keeps its
          original testid + busy-aware label; the destructive delete opens
          a confirmation modal (irreversible).

          'medium' — view switches and one-off body maintenance, reached a
          few times per section rather than per column. */
      {
        id: 'litho-bodies-dropdown',
        priority: 'medium',
        kind: 'dropdown',
        label: t('sections.toolbar.bodies'),
        overflowItems: lithoBodiesMenuItems,
        render: p => (
          <ToolbarDropdown
            iconOnly={p === 'icon'}
            icon={<Layers size={13} />}
            label={t('sections.toolbar.bodies')}
            disabled={!activeLithoModel}
            title={
              !activeLithoModel
                ? t('sections.litho.createModelFirst')
                : t('sections.litho.bodiesTitle')
            }
            testid="litho-bodies-dropdown"
            items={lithoBodiesMenuItems}
          />
        ),
      },

      /* Admixtures dropdown (dogfeed 2026-05-22) — strip / reseed
          admixtures on the ghost suggestions before accepting. The
          CPT segmenter's admixtures are noisier than the borehole
          observation-log ones, so "strip all → reseed boreholes" is
          a common cleanup. Operates on ghost state only.

          'low' — a cleanup pass run occasionally, and the first litho verb
          to give ground. */
      {
        id: 'litho-admixtures-dropdown',
        priority: 'low',
        kind: 'dropdown',
        label: t('sections.toolbar.admixtures'),
        overflowItems: lithoAdmixtureMenuItems,
        render: p => (
          <ToolbarDropdown
            iconOnly={p === 'icon'}
            icon={<FlaskConical size={13} />}
            label={t('sections.toolbar.admixtures')}
            disabled={cptGhostCount === 0 && boreholeGhostCount === 0}
            title={
              cptGhostCount === 0 && boreholeGhostCount === 0
                ? t('sections.litho.admixturesDisabled')
                : t('sections.litho.admixturesTitle')
            }
            testid="litho-admixtures-dropdown"
            items={lithoAdmixtureMenuItems}
          />
        ),
      },
    ]

  return lithoItems
}
