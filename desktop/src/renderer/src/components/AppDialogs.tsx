// App-level overlays: toast stack + the four global dialogs.
//
// Extracted verbatim from App.tsx's loaded-project render block
// (debt #12 R5). These sit OUTSIDE ShellContext.Provider so they
// overlay all shell chrome; App still owns the state (dialog
// open-flags, toasts) and the handlers — this is a pure
// presentational relocation, prop-wired, no logic moved. The
// close-confirm Modal's raw grays are token-corrected on the way
// (same no-dark-variant #51-class fix as AppBootError/AppLoading).

import { AlertTriangle, CheckCircle, X } from 'lucide-react'

import type { ProjectResponse, ProjectUpdatePayload } from '../api/client'
import type { Toast } from '../hooks/useToasts'
import type { UnsavedWorkSummary } from '../utils/unsavedWorkSummary'
import NewProjectDialog from './NewProjectDialog'
import ProjectMetadataDialog from './ProjectMetadataDialog'
import UnsavedChangesDialog from './UnsavedChangesDialog'
import ConfirmDialog from './ui/ConfirmDialog'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { useT } from '../i18n/translate'

export interface AppDialogsProps {
  toasts: Toast[]
  /**
   * Remove one toast by id.  Only sticky (error) toasts render a close
   * button — everything else still expires on its own — but an error that
   * never expires MUST have a way out or the stack grows without bound.
   */
  dismissToast: (id: number) => void
  newProjectOpen: boolean
  setNewProjectOpen: (open: boolean) => void
  newProject: (meta: { name: string }) => Promise<ProjectResponse | null>
  /** Non-null — only rendered inside App's loaded-project branch. */
  project: ProjectResponse
  savedProject: ProjectResponse | null
  metadataEditorOpen: boolean
  setMetadataEditorOpen: (open: boolean) => void
  applyMetadataDraft: (patch: ProjectUpdatePayload) => void
  /**
   * Report the draft CRS / datum picked in the metadata dialog up to App, which
   * puts them on the shell bus so the guided tutorial's CRS / datum steps
   * advance the moment a value is selected, before Save (owner ruling 1,
   * 2026-09-06). Optional so this pure presentational shell need not be handed a
   * reporter in tests that do not exercise the tutorial.
   */
  onMetadataDraftCrsDatumChange?: (draft: {
    horizontal: number | null
    vertical: number | null
  }) => void
  unsavedDialogOpen: boolean
  /** Itemised session work the discard prompt names (from useProjectLifecycle). */
  unsavedSummary: UnsavedWorkSummary
  unsavedSaving: boolean
  /**
   * Why the last Save / Discard did not close the project, or null.
   * Rendered inside the dialog — an open dialog after a failed click has to
   * say what went wrong or it reads as a broken button (audit 2026-08-02).
   */
  unsavedError: string | null
  handleUnsavedSave: () => Promise<void>
  handleUnsavedDiscard: () => void
  handleUnsavedCancel: () => void
  /**
   * Force-revert confirmation (owner ruling, installer #26 2026-09-08). Opened
   * when a Discard is refused because the .strix on disk is not this project's
   * latest save — instead of trapping the user, it names the file + the loss and
   * offers a destructive replace-restore or Save. Never a dead end.
   */
  forceRevertPromptOpen: boolean
  forceRevertMessage: string
  handleForceRevertConfirm: () => Promise<void>
  handleForceRevertSave: () => Promise<void>
  handleForceRevertCancel: () => void
  closeConfirmOpen: boolean
  setCloseConfirmOpen: (open: boolean) => void
  closeProject: () => void
}

/**
 * Toast stack + New-Project / Metadata / Unsaved-Changes / Close-Confirm
 * dialogs for the loaded-project branch.
 *
 * Pure presentational — every piece of state and every handler is
 * owned by App.tsx and passed in. Lives outside ShellContext.Provider
 * (App renders ``<AppShell/>`` then ``<AppDialogs/>``) so the overlays
 * sit above all shell chrome.
 *
 * Returns
 * -------
 * JSX.Element
 *     The overlay fragment.
 */
export default function AppDialogs({
  toasts,
  dismissToast,
  newProjectOpen,
  setNewProjectOpen,
  newProject,
  project,
  savedProject,
  metadataEditorOpen,
  setMetadataEditorOpen,
  applyMetadataDraft,
  onMetadataDraftCrsDatumChange,
  unsavedDialogOpen,
  unsavedSummary,
  unsavedError,
  unsavedSaving,
  handleUnsavedSave,
  handleUnsavedDiscard,
  handleUnsavedCancel,
  forceRevertPromptOpen,
  forceRevertMessage,
  handleForceRevertConfirm,
  handleForceRevertSave,
  handleForceRevertCancel,
  closeConfirmOpen,
  setCloseConfirmOpen,
  closeProject,
}: AppDialogsProps): JSX.Element {
  // Named ``tr`` to avoid shadowing the ``t`` toast used in the map below.
  const tr = useT()
  return (
    <>
      {/* Toast stack — z-[1100] keeps it above Leaflet's stacked
          controls (z-1000). */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-[1100]">
        {toasts.map(t => (
          <div
            key={t.id}
            // An error waits to be read (useToasts: sticky), so it also has to
            // be readable — the max-width keeps a long action-required message
            // wrapping inside the card instead of running off-screen.
            className={[
              'flex items-start gap-2 px-3 py-2 rounded shadow-lg text-sm text-white max-w-md',
              t.type === 'success'
                ? 'bg-green-600'
                : t.type === 'warning'
                  ? 'bg-amber-600'
                  : 'bg-red-600',
            ].join(' ')}
            role={t.sticky ? 'alert' : undefined}
          >
            <span className="mt-0.5 shrink-0">
              {t.type === 'success' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
            </span>
            <span className="min-w-0 flex-1">{t.message}</span>
            {t.sticky && (
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                aria-label={tr('app.dismissNotification')}
                data-testid="toast-dismiss"
                className="shrink-0 rounded p-0.5 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/60"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* New-project dialog. Sits at the App level so the File-menu
          signal can open it whether a project is loaded or not. */}
      <NewProjectDialog
        open={newProjectOpen}
        onCancel={() => setNewProjectOpen(false)}
        onSubmit={async name => {
          const created = await newProject({ name })
          if (created !== null) setNewProjectOpen(false)
        }}
      />

      {/* Project metadata editor. Save commits to live state; the DB +
          file write happens on File → Save / Ctrl+S. */}
      <ProjectMetadataDialog
        open={metadataEditorOpen}
        project={project}
        saved={savedProject}
        onDraftCrsDatumChange={onMetadataDraftCrsDatumChange}
        onCancel={() => setMetadataEditorOpen(false)}
        onSubmit={patch => {
          applyMetadataDraft(patch)
          setMetadataEditorOpen(false)
        }}
      />

      {/* Close-flow dialogs. Only one is visible at a time;
          ``attemptClose`` decides which based on dirty state + source. */}
      <UnsavedChangesDialog
        open={unsavedDialogOpen}
        projectName={project.name}
        summary={unsavedSummary}
        error={unsavedError}
        busy={unsavedSaving}
        onSave={() => void handleUnsavedSave()}
        onDiscard={handleUnsavedDiscard}
        onCancel={handleUnsavedCancel}
      />
      {/* Force-revert confirmation — the way OUT of a refused Discard (owner
          ruling, installer #26). Cancel is default-focused (docs/ux.md); the
          destructive "Revert to file and close" is the named danger button;
          Save is the non-destructive alternative. Replaces the old dead-end
          that forced a Task-Manager kill. */}
      <ConfirmDialog
        open={forceRevertPromptOpen}
        labelledBy="force-revert-title"
        title={tr('project.closeForceRevertTitle')}
        titleTestid="force-revert-title"
        body={forceRevertMessage}
        busy={unsavedSaving}
        onCancel={handleForceRevertCancel}
        cancelTestid="force-revert-cancel"
        secondary={{
          label: tr('common.save'),
          onClick: () => void handleForceRevertSave(),
          variant: 'primary',
          testid: 'force-revert-save',
        }}
        confirm={{
          label: tr('project.closeForceRevertConfirm'),
          onClick: () => void handleForceRevertConfirm(),
          variant: 'danger',
          testid: 'force-revert-confirm',
        }}
        testid="force-revert-dialog"
      />
      <Modal
        open={closeConfirmOpen}
        onCancel={() => setCloseConfirmOpen(false)}
        labelledBy="close-project-title"
        cardClassName="w-80"
      >
        <div className="p-5">
          <h2
            id="close-project-title"
            className="text-sm font-semibold text-text-primary mb-1"
          >
            {tr('project.closeConfirmTitle')}
          </h2>
          <p className="text-xs text-text-muted mb-4">
            <span className="font-medium text-text-secondary">
              {project.name}
            </span>{' '}
            {tr('project.closeConfirmBodyDetailed')}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setCloseConfirmOpen(false)}
            >
              {tr('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setCloseConfirmOpen(false)
                closeProject()
              }}
            >
              {tr('project.close')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
