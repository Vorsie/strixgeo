// The modal / confirmation dialogs the Sections toolbar owns.
//
// Extracted verbatim from ``SectionsToolbar``'s render tail (debt #201). Every
// dialog here is presentational: its open/busy state and its confirm handlers
// are passed in, so this file holds no hooks and changes no behaviour — it is
// the same JSX, one call boundary away.

import ReportMetadataDialog from '../../../components/sections/ReportMetadataDialog'
import ReCorrelateConfirmDialog from '../../../components/ReCorrelateConfirmDialog'
import ReSubdivideConfirmDialog from '../../../components/ReSubdivideConfirmDialog'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import type { CrossSectionResponse } from '../../../api/client'

/** What the toolbar's dialog stack needs to render + resolve each modal. */
export interface SectionsToolbarDialogsProps {
  // -- Section PDF report metadata dialog (debt #52) --
  pdfDialogOpen: boolean
  pdfDefaultTitle: string
  exportingPdf: boolean
  onExportPdf: (metadata: { title: string; author: string; notes: string }) => Promise<void>
  onPdfCancel: () => void

  // -- Delete-section confirm modal --
  deleteConfirmOpen: boolean
  deleting: boolean
  selectedSection: CrossSectionResponse | null
  onDeleteCancel: () => void
  onDeleteConfirm: () => void

  // -- Bulk-suggest confirm modal (debt #73 / Phase 3) --
  bulkConfirmOpen: boolean
  bulkAnchors: { kind: 'cpt' | 'borehole'; id: string; surfaceElevationM: number | null }[]
  onBulkCancel: () => void
  onBulkConfirm: () => void

  // -- Re-correlate confirm dialog (Slice 4 Half-A) --
  reCorrelateConfirmOpen: boolean
  reCorrelateAutoEdgeCount: number
  autoCorrelating: boolean
  onReCorrelateCancel: () => void
  onReCorrelateSkip: () => void
  onReCorrelateConfirm: () => void

  // -- Re-subdivide confirm dialog (C1, connecting-geotech-units §7) --
  reSubdivideConfirmOpen: boolean
  subdividingBodies: boolean
  geotechBandsStale: boolean
  subdivideScope: {
    bandCount: number
    handEditCount: number
    modelBandCount: number
    modelHandEditCount: number
  }
  geotechStatistic: string
  onReSubdivideCancel: () => void
  onReSubdivideConfirm: () => void

  // -- Reset manual points confirm dialog --
  resetBoundariesConfirmOpen: boolean
  resettingBoundaries: boolean
  onResetBoundariesCancel: () => void
  onResetBoundariesConfirm: () => void
}

/**
 * The toolbar's modal + confirmation dialogs.
 *
 * Rendered after ``ResponsiveToolbarRow`` in ``SectionsToolbar``. Split out of
 * the component body purely for file size (debt #201); the JSX is unchanged.
 *
 * Returns
 * -------
 * JSX.Element
 *     The fragment of dialogs (mostly closed at any given moment).
 */
export default function SectionsToolbarDialogs({
  pdfDialogOpen,
  pdfDefaultTitle,
  exportingPdf,
  onExportPdf,
  onPdfCancel,
  deleteConfirmOpen,
  deleting,
  selectedSection,
  onDeleteCancel,
  onDeleteConfirm,
  bulkConfirmOpen,
  bulkAnchors,
  onBulkCancel,
  onBulkConfirm,
  reCorrelateConfirmOpen,
  reCorrelateAutoEdgeCount,
  autoCorrelating,
  onReCorrelateCancel,
  onReCorrelateSkip,
  onReCorrelateConfirm,
  reSubdivideConfirmOpen,
  subdividingBodies,
  geotechBandsStale,
  subdivideScope,
  geotechStatistic,
  onReSubdivideCancel,
  onReSubdivideConfirm,
  resetBoundariesConfirmOpen,
  resettingBoundaries,
  onResetBoundariesCancel,
  onResetBoundariesConfirm,
}: SectionsToolbarDialogsProps): JSX.Element {
  return (
    <>
      <ReportMetadataDialog
        open={pdfDialogOpen}
        defaultTitle={pdfDefaultTitle}
        defaultAuthor=""
        onSubmit={onExportPdf}
        onCancel={onPdfCancel}
        busy={exportingPdf}
      />

      {/* Model-management verbs (Build / Sync geology / Seed / Dedupe)
          moved to ``SectionsInspector`` (debt #97) — they act on the
          model, not on a section, and now live next to the model rows
          in the right-hand inspector. The toolbar stops being the
          dumping ground; the Geotech-stage verbs that will land next
          have an obvious home from the start. */}

      {/* Delete-confirm modal — replaces window.confirm(). Per docs/ux.md
          irreversible-vs-reversible rule: destructive actions need a Modal
          with default focus on Cancel and a button that names the action.
          ``busy`` is set while the delete request is in-flight so Esc /
          backdrop-click don't dismiss mid-request. */}
      <Modal
        open={deleteConfirmOpen}
        onCancel={onDeleteCancel}
        labelledBy="delete-section-title"
        busy={deleting}
        cardClassName="w-80"
      >
        <div className="p-5">
          <h2
            id="delete-section-title"
            className="text-sm font-semibold text-text-primary mb-1"
          >
            Delete cross-section?
          </h2>
          <p className="text-xs text-text-muted mb-4">
            <span className="font-medium text-text-secondary">
              {selectedSection?.name ?? 'This section'}
            </span>{' '}
            will be permanently deleted. Formation contacts placed on it are also removed.
            This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            {/* Cancel has default focus (autoFocus) — the safe default
                for an irreversible confirm dialog per docs/ux.md. */}
            <Button
              variant="secondary"
              size="md"
              // reason: autoFocus on the Cancel button is the safe default
              // for a destructive-confirm modal — the user should actively
              // choose the destructive action, not accidentally confirm it.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onClick={onDeleteCancel}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={onDeleteConfirm}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete cross-section'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Bulk-suggest confirmation (debt #73 / Phase 3). Replaces
          existing bulk ghosts wholesale, so the dialog warns + names
          the count. Cancel has default focus per the dialog rules
          (not destructive in the DB sense, but does wipe pending
          bulk preview state — worth confirming). */}
      <Modal
        open={bulkConfirmOpen}
        onCancel={onBulkCancel}
        labelledBy="bulk-suggest-title"
        cardClassName="w-96"
      >
        <div className="p-5">
          <h2
            id="bulk-suggest-title"
            className="text-sm font-semibold text-text-primary mb-1"
          >
            Suggest lithos for all tests?
          </h2>
          <p className="text-xs text-text-muted mb-4">
            The lithology segmenter will run for{' '}
            <span className="font-medium text-text-secondary">
              {bulkAnchors.length} investigation{bulkAnchors.length === 1 ? '' : 's'}
            </span>{' '}
            in this section. Any existing bulk-suggest ghosts will be replaced.
            Already-committed contacts on the section stay untouched.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="md"
              // reason: Cancel has default focus on a state-wiping
              // confirmation modal — user must actively pick the action.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onClick={onBulkCancel}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={onBulkConfirm}
              disabled={bulkAnchors.length === 0}
            >
              {bulkAnchors.length === 0
                ? 'No investigations'
                : `Suggest all (${bulkAnchors.length})`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Re-correlate confirmation (Slice 4 Half-A) — shown when the user
          clicks Auto-correlate and source='auto' edges already exist.
          Three choices: Cancel (default focus), Skip, Re-correlate.
          Manual edges are never deleted. */}
      <ReCorrelateConfirmDialog
        open={reCorrelateConfirmOpen}
        existingAutoEdgeCount={reCorrelateAutoEdgeCount}
        onCancel={onReCorrelateCancel}
        onSkip={onReCorrelateSkip}
        onReCorrelate={onReCorrelateConfirm}
        busy={autoCorrelating && !reCorrelateConfirmOpen}
      />

      {/* Re-subdivide confirmation (C1, connecting-geotech-units §7) — shown
          before a press that would rebuild packing bands THIS section already
          has, because the rebuild clears its manual packing connections and
          re-derives its hand splits/merges from the CPT data (owner ruling B).
          Both numbers and the name are the open section's (owner 2026-08-15):
          a warning phrased over the model fires where nothing is at risk. */}
      <ReSubdivideConfirmDialog
        open={reSubdivideConfirmOpen}
        onCancel={onReSubdivideCancel}
        onConfirm={onReSubdivideConfirm}
        busy={subdividingBodies}
        handEditCount={
          geotechBandsStale ? subdivideScope.modelHandEditCount : subdivideScope.handEditCount
        }
        sectionName={selectedSection?.name ?? null}
        // The statistic re-run is MODEL-WIDE (owner 2026-08-18: "rederiving
        // with a new statistic should say, this clears all subdivisions model
        // wide") — the dialog states that blast radius in his words.
        statisticRebuild={geotechBandsStale ? geotechStatistic : null}
      />

      {/* Reset manual points confirmation — clearing every hand-drawn body
          boundary is an irreversible DB delete, so per docs/ux.md the gesture
          confirms first: Cancel (default focus) + an action-named danger
          button ("Reset points", never "OK"). */}
      <ConfirmDialog
        open={resetBoundariesConfirmOpen}
        labelledBy="reset-manual-points-title"
        testid="reset-manual-points-dialog"
        cardClassName="w-[28rem]"
        cancelTestid="reset-manual-points-cancel"
        onCancel={onResetBoundariesCancel}
        busy={resettingBoundaries}
        title="Reset all manual points?"
        body={
          <p>
            Every hand-drawn boundary point on this model will be cleared and the bodies will
            return to their computed shape. This cannot be undone.
          </p>
        }
        confirm={{
          label: 'Reset points',
          onClick: onResetBoundariesConfirm,
          variant: 'danger',
          testid: 'reset-manual-points-confirm',
        }}
      />
    </>
  )
}
