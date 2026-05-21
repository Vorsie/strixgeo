// App-level overlays: toast stack + the four global dialogs.
//
// Extracted verbatim from App.tsx's loaded-project render block
// (debt #12 R5). These sit OUTSIDE ShellContext.Provider so they
// overlay all shell chrome; App still owns the state (dialog
// open-flags, toasts) and the handlers — this is a pure
// presentational relocation, prop-wired, no logic moved. The
// close-confirm Modal's raw grays are token-corrected on the way
// (same no-dark-variant #51-class fix as AppBootError/AppLoading).

import { AlertTriangle, CheckCircle } from 'lucide-react'

import type { ProjectResponse, ProjectUpdatePayload } from '../api/client'
import type { Toast } from '../hooks/useToasts'
import NewProjectDialog from './NewProjectDialog'
import ProjectMetadataDialog from './ProjectMetadataDialog'
import UnsavedChangesDialog from './UnsavedChangesDialog'
import Modal from './ui/Modal'
import Button from './ui/Button'

export interface AppDialogsProps {
  toasts: Toast[]
  newProjectOpen: boolean
  setNewProjectOpen: (open: boolean) => void
  newProject: (meta: { name: string }) => Promise<ProjectResponse | null>
  /** Non-null — only rendered inside App's loaded-project branch. */
  project: ProjectResponse
  savedProject: ProjectResponse | null
  metadataEditorOpen: boolean
  setMetadataEditorOpen: (open: boolean) => void
  applyMetadataDraft: (patch: ProjectUpdatePayload) => void
  unsavedDialogOpen: boolean
  unsavedSaving: boolean
  handleUnsavedSave: () => Promise<void>
  handleUnsavedDiscard: () => void
  handleUnsavedCancel: () => void
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
  newProjectOpen,
  setNewProjectOpen,
  newProject,
  project,
  savedProject,
  metadataEditorOpen,
  setMetadataEditorOpen,
  applyMetadataDraft,
  unsavedDialogOpen,
  unsavedSaving,
  handleUnsavedSave,
  handleUnsavedDiscard,
  handleUnsavedCancel,
  closeConfirmOpen,
  setCloseConfirmOpen,
  closeProject,
}: AppDialogsProps): JSX.Element {
  return (
    <>
      {/* Toast stack — z-[1100] keeps it above Leaflet's stacked
          controls (z-1000). */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-[1100]">
        {toasts.map(t => (
          <div
            key={t.id}
            className={[
              'flex items-center gap-2 px-3 py-2 rounded shadow-lg text-sm text-white',
              t.type === 'success'
                ? 'bg-green-600'
                : t.type === 'warning'
                  ? 'bg-amber-600'
                  : 'bg-red-600',
            ].join(' ')}
          >
            {t.type === 'success' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
            {t.message}
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
        busy={unsavedSaving}
        onSave={() => void handleUnsavedSave()}
        onDiscard={handleUnsavedDiscard}
        onCancel={handleUnsavedCancel}
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
            Close this project?
          </h2>
          <p className="text-xs text-text-muted mb-4">
            <span className="font-medium text-text-secondary">
              {project.name}
            </span>{' '}
            will close and you&apos;ll be returned to the welcome screen.
            The .gmproj file and your saved data are kept — you can reopen
            from the Recent list.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setCloseConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setCloseConfirmOpen(false)
                closeProject()
              }}
            >
              Close project
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
