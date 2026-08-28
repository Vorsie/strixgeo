// Confirmation dialog shown before re-running "Subdivide all bodies" when a
// geotechnical model already exists (connecting-geotech-units spec §7).
//
// Re-subdividing wipes and regenerates the open section's packing connections:
// the auto-derived ones are recreated, but any manual packing connections the
// user made there are lost. (Since 2026-08-15 the verb clears only the columns
// it rebuilds, so the other sections keep theirs.) That is irreversible, so per
// CLAUDE.md / docs/ux.md "Reversible vs irreversible" the gesture must confirm
// first:
//   1. Cancel (default focus — an accidental Enter must not wipe connections)
//   2. Re-subdivide — the destructive confirm
//
// It costs the engineer TWO different things, and the body names them
// separately because he weighs them differently (owner ruling B, 2026-08-01):
//   * packing CONNECTIONS — auto-derivable again via Auto-correlate;
//   * hand EDITS (bands he split or merged) — not derivable at all, since the
//     rebuild re-runs the segmenter over the CPT data and knows nothing about
//     where he put the boundary. Only mentioned when there are some: a warning
//     that fires at zero trains people to click past the one that matters.
//
// The dialog only appears when the press has something to destroy: the caller
// counts the bands on the section it is about to rebuild, and a section that
// holds none goes straight through (owner, 2026-08-15: *"We do however get an
// overwrite popup on cs2 while there is no subdivision there yet. Now it seems
// like it is warning that i'll overwrite CS 1"*). That subsumes the older gate
// — a project with no geotech model at all has no bands anywhere.
//
// Everything the body says is therefore about ONE named section. It must never
// be readable as a threat to another section's work: since 2026-08-15 the
// rebuild deletes only the columns it rebuilds, so another section's bands are
// not at risk, and saying otherwise would be a false warning.
// Thin wrapper over the generic ConfirmDialog (#165): no secondary action,
// just Cancel + the destructive confirm.

import ConfirmDialog from './ui/ConfirmDialog'
import { useT } from '../i18n/translate'

interface Props {
  /** Truthy = render the dialog. The caller owns the open lifecycle. */
  open: boolean
  /** Fired when the user clicks Cancel (or Esc). */
  onCancel: () => void
  /** Fired when the user clicks "Re-subdivide". */
  onConfirm: () => void
  /** When true, both buttons are disabled (async action in flight). */
  busy?: boolean
  /**
   * How many hand-edited packing bands the re-run will destroy — see
   * ``countGeotechHandEdits`` over ``geotechBandsInScope``. Counted on the
   * bands of *this section* only, because those are the ones the press
   * rebuilds. Zero (the default) renders no hand-edit sentence at all.
   */
  handEditCount?: number
  /**
   * The section being subdivided, by name.
   *
   * Named out loud because the count and the loss are both its own (owner,
   * 2026-08-15: *"it seems like it is warning that i'll overwrite CS 1"*). A
   * dialog that says "this section" while the engineer is looking at a fresh
   * one leaves him to guess which section it means — and he guesses the one he
   * has work on. ``null`` / omitted falls back to "this section" for a caller
   * that genuinely has no name to give.
   */
  sectionName?: string | null
  /**
   * The statistic a model-wide re-run will classify under (owner 2026-08-18:
   * *"rederiving with a new statistic should say, this clears all
   * subdivisions model wide"*). When set, the body states the model-wide
   * blast radius instead of the one-section sentence — the press really does
   * rebuild every section's bands, and a section-named dialog would promise
   * a smaller loss than the one it delivers.
   */
  statisticRebuild?: string | null
}

/**
 * Confirmation modal gating a re-run of "Subdivide all bodies".
 *
 * Renders a {@link ConfirmDialog} with a default-focused Cancel and a single
 * destructive "Re-subdivide" confirm; manual packing connections are cleared by
 * the regenerate, and any hand-edited bands are rebuilt from the CPT data —
 * both of which the body makes explicit.
 *
 * @returns The dialog element (or nothing when ``open`` is false).
 */
export default function ReSubdivideConfirmDialog({
  open,
  onCancel,
  onConfirm,
  busy = false,
  handEditCount = 0,
  sectionName = null,
  statisticRebuild = null,
}: Props): JSX.Element {
  const t = useT()
  const oneHandEdit = handEditCount === 1
  // "Cross-section 2" where there is a name; the generic phrase only where a
  // caller has none. Both read as one section — never as the model. ('the
  // model' branch is never rendered — the model-wide paragraph does not use
  // scope — so it stays a literal.)
  const scope =
    statisticRebuild !== null ? 'the model' : (sectionName ?? t('geotech.thisSectionFallback'))
  return (
    <ConfirmDialog
      open={open}
      labelledBy="re-subdivide-confirm-title"
      testid="re-subdivide-confirm-dialog"
      cardClassName="w-[28rem]"
      cancelTestid="re-subdivide-cancel"
      onCancel={onCancel}
      busy={busy}
      title={t('geotech.reSubdivideConfirm')}
      body={
        <>
          {statisticRebuild !== null ? (
            <p data-testid="re-subdivide-model-wide">
              {t('geotech.reSubdivideModelPre')}{' '}
              <span className="font-semibold">{statisticRebuild}</span>{' '}
              {t('geotech.reSubdivideModelMid')}{' '}
              <span className="font-bold">{t('geotech.reSubdivideModelWide')}</span>{' '}
              {t('geotech.reSubdivideModelPost')}
            </p>
          ) : (
            <p>
              {t('geotech.reSubdivideRegenPre')}{' '}
              <span className="font-semibold">{scope}</span>{' '}
              {t('geotech.reSubdivideRegenPost')}
            </p>
          )}
          {/* The second loss, and the heavier one — a connection can be re-derived by
              Auto-correlate, a hand-placed boundary cannot be re-derived at all. Rendered
              only when there is something to lose (owner ruling B).

              The count is THIS SECTION's (owner 2026-08-15), so the sentence states it
              flatly. It used to hedge — "any of them that sit on it" — because the number
              was the model's while the press was the section's; with the two aligned, the
              hedge would be the inaccuracy. */}
          {handEditCount > 0 && (
            <p className="mt-2" data-testid="re-subdivide-hand-edits">
              {t('geotech.reSubdivideHandPre')}{' '}
              <span className="font-semibold">{scope}</span>{' '}
              {t('geotech.reSubdivideHandMid')}{' '}
              <span className="font-semibold">
                {t(
                  oneHandEdit
                    ? 'geotech.reSubdivideHandBandOne'
                    : 'geotech.reSubdivideHandBandMany',
                  { n: handEditCount },
                )}
              </span>{' '}
              {t('geotech.reSubdivideHandPost')}
            </p>
          )}
          {/* There was a third paragraph here, warning that the other sections lost
              their packing bands until the engineer re-ran "on all sections". Both
              halves of that stopped being true on 2026-08-15: the rebuild now deletes
              only the columns it rebuilds, and the all-sections item is gone. */}
          {/* The dialog used to be a dead end: wiping the model was the only way to get
              the automatic ties back. "Correlate packing → Auto-correlate" now proposes
              them without touching anything, so the alternative belongs at the exact
              moment the engineer is deciding whether to accept the loss. */}
          <p className="mt-2 text-text-secondary">
            {t('geotech.reSubdivideAltPre')} <em>{t('geotech.reSubdivideAltEm')}</em>{' '}
            {t('geotech.reSubdivideAltPost')}
          </p>
        </>
      }
      confirm={{
        label: t('geotech.reSubdivide'),
        onClick: onConfirm,
        variant: 'danger',
        testid: 're-subdivide-confirm',
      }}
    />
  )
}
