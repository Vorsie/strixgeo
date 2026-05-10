// Full project-metadata editor. Reached by clicking the project name in
// the sidebar header.
//
// Form behaviour: text fields open EMPTY with the current value rendered
// as placeholder text (matching the NewProjectDialog convention).
// Submitting with a blank text field LEAVES the current value alone —
// only fields the user actually typed into are written. This eliminates
// the "open and accidentally re-save unchanged values" risk and matches
// how the user expects an additive edit form to behave.
//
// Dropdowns (CRSes / phase / status) and tags don't follow the
// placeholder model — selects need an active selection, and tags are
// chip-direct (add / remove individually). For those we track the
// current value as the form state and only PATCH if it differs from
// the row's value.
//
// Known gap: text fields can be set or changed through this editor but
// not CLEARED back to NULL. Clearing a stored value is a less common
// flow; if it becomes important we'll add a per-field clear affordance.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { X } from 'lucide-react'

import Button from './ui/Button'
import Modal from './ui/Modal'
import type {
  ProjectPhase,
  ProjectResponse,
  ProjectStatus,
  ProjectUpdatePayload,
} from '../api/client'
import {
  PICKABLE_VERTICAL_EPSGS,
  VCRS_LABEL_BY_EPSG,
} from '../utils/verticalDatum'

// Horizontal CRSes available in the default-CRS dropdown. Same two
// countries the vertical-datum picker covers; adding a third country
// is a one-line entry here + in ``utils/verticalDatum``.
const PICKABLE_HORIZONTAL_EPSGS: ReadonlyArray<{
  epsg: number
  label: string
}> = [
  { epsg: 31370, label: 'BE — Lambert 72 (EPSG:31370)' },
  { epsg: 28992, label: 'NL — Amersfoort / RD New (EPSG:28992)' },
]

const PHASES: ReadonlyArray<{ value: ProjectPhase; label: string }> = [
  { value: 'feasibility', label: 'Feasibility' },
  { value: 'design', label: 'Design' },
  { value: 'construction', label: 'Construction' },
  { value: 'monitoring', label: 'Monitoring' },
]

const STATUSES: ReadonlyArray<{ value: ProjectStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
]

// Imperative handle exposed by the dialog so the App can trigger a save
// from outside (e.g. the "Save and close" path of the unsaved-changes
// dialog). ``submit()`` resolves to ``true`` on success, ``false`` on
// validation / API failure (in which case the dialog stays open with
// the error message visible).
export interface ProjectMetadataDialogHandle {
  submit: () => Promise<boolean>
}

interface Props {
  open: boolean
  project: ProjectResponse | null
  onSubmit: (patch: ProjectUpdatePayload) => Promise<void> | void
  onCancel: () => void
  // Reports whether the form has any pending edits that would be lost on
  // close. The App uses this to decide whether to prompt-to-save when
  // the user tries to close the project. Optional — call sites that
  // don't care about dirty state (read-only renders, tests) can omit it.
  onDirtyChange?: (dirty: boolean) => void
}

// FormState only carries the user's *typed* changes. Text fields default
// to '' (placeholder shows the project's current value); dropdowns and
// tags need an active value so they're seeded from the project. The
// submit-time toPatch() compares each field to the project's current
// state and only includes fields the user actually changed.
interface FormState {
  name: string
  project_number: string
  client: string
  site_label: string
  description: string
  tags: string[]
  tagDraft: string
  default_horizontal_epsg: number | null
  default_vertical_epsg: number | null
  phase: ProjectPhase | null
  status: ProjectStatus
}

function emptyForm(project: ProjectResponse): FormState {
  return {
    name: '',
    project_number: '',
    client: '',
    site_label: '',
    description: '',
    // Copy the array so chip-removals don't mutate the source.
    tags: [...project.tags],
    tagDraft: '',
    default_horizontal_epsg: project.default_horizontal_epsg,
    default_vertical_epsg: project.default_vertical_epsg,
    phase: (project.phase as ProjectPhase | null) ?? null,
    status: project.status as ProjectStatus,
  }
}

// Build a PATCH payload that includes only the fields the user actually
// changed from the project's current state. An untouched form sends
// nothing (caller can short-circuit). Tags / dropdowns are diffed
// against the source row; text fields are picked when non-blank.
function toPatch(state: FormState, project: ProjectResponse): ProjectUpdatePayload {
  const patch: ProjectUpdatePayload = {}

  // Text fields: only included when the user typed something. Blank
  // submits leave the existing value alone (the placeholder showed it
  // as a guide; it was never meant to be a default to re-save).
  if (state.name.trim() !== '') patch.name = state.name.trim()
  if (state.project_number.trim() !== '') patch.project_number = state.project_number.trim()
  if (state.client.trim() !== '') patch.client = state.client.trim()
  if (state.site_label.trim() !== '') patch.site_label = state.site_label.trim()
  if (state.description.trim() !== '') patch.description = state.description.trim()

  // Tags: full replacement. Diff against project.tags; only included
  // when the chip list actually changed.
  const tagsChanged =
    state.tags.length !== project.tags.length ||
    state.tags.some((t, i) => t !== project.tags[i])
  if (tagsChanged) patch.tags = state.tags

  // Dropdowns: include only when changed. ``phase`` is the only one
  // that's nullable from the form; the others always have a value.
  if (state.default_horizontal_epsg !== project.default_horizontal_epsg) {
    patch.default_horizontal_epsg = state.default_horizontal_epsg
  }
  if (state.default_vertical_epsg !== project.default_vertical_epsg) {
    patch.default_vertical_epsg = state.default_vertical_epsg
  }
  if ((state.phase ?? null) !== (project.phase ?? null)) patch.phase = state.phase
  if (state.status !== project.status) patch.status = state.status

  return patch
}

// Has the form deviated from its initial state? Used to gate the save-
// before-close prompt and the Save button's enabled state.
function isDirty(state: FormState, project: ProjectResponse): boolean {
  if (state.name.trim() !== '') return true
  if (state.project_number.trim() !== '') return true
  if (state.client.trim() !== '') return true
  if (state.site_label.trim() !== '') return true
  if (state.description.trim() !== '') return true
  if (state.tagDraft.trim() !== '') return true
  if (state.tags.length !== project.tags.length) return true
  if (state.tags.some((t, i) => t !== project.tags[i])) return true
  if (state.default_horizontal_epsg !== project.default_horizontal_epsg) return true
  if (state.default_vertical_epsg !== project.default_vertical_epsg) return true
  if ((state.phase ?? null) !== (project.phase ?? null)) return true
  if (state.status !== project.status) return true
  return false
}

const ProjectMetadataDialog = forwardRef<ProjectMetadataDialogHandle, Props>(
  function ProjectMetadataDialog(
    { open, project, onSubmit, onCancel, onDirtyChange },
    ref,
  ) {
  const [state, setState] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // Re-seed form state every time we open with empty drafts. The shared
  // Modal handles Esc + backdrop close; we just own the form state +
  // the focus call.
  useEffect(() => {
    if (!open || project === null) {
      setState(null)
      return
    }
    setState(emptyForm(project))
    setError(null)
    setBusy(false)
    const timer = setTimeout(() => nameRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open, project])

  // Recompute + report dirty state whenever the form changes. Memoised
  // so the equality check doesn't re-fire onDirtyChange on unrelated
  // re-renders.
  const dirty = useMemo(
    () => (state !== null && project !== null ? isDirty(state, project) : false),
    [state, project],
  )
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // Imperative submit() exposed via ref so the App's "Save and close"
  // path can trigger a save without the user clicking the inline
  // Save button. Resolves true on success, false on failure.
  useImperativeHandle(
    ref,
    () => ({
      submit: async () => {
        if (state === null || project === null) return false
        return doSubmit(state, project)
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, project],
  )

  // Centralised submit body — used by both the inline Save click and
  // the imperative ``submit()`` handle. Returns true on success.
  async function doSubmit(s: FormState, p: ProjectResponse): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    setError(null)
    try {
      // Auto-commit any pending tag draft so a user typing "foo" and
      // clicking Save without pressing Enter still gets foo as a tag.
      const trimmedDraft = s.tagDraft.trim()
      const tags =
        trimmedDraft !== '' &&
        !s.tags.some(t => t.toLowerCase() === trimmedDraft.toLowerCase())
          ? [...s.tags, trimmedDraft]
          : s.tags
      const patch = toPatch({ ...s, tags, tagDraft: '' }, p)
      // Empty patch means the user opened the editor and clicked Save
      // without changing anything. Skip the API call (nothing to PATCH)
      // and treat as success so the close-on-success caller proceeds.
      if (Object.keys(patch).length === 0) {
        return true
      }
      await onSubmit(patch)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      return false
    } finally {
      setBusy(false)
    }
  }

  if (!open || state === null) return null

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setState(prev => (prev === null ? prev : { ...prev, [key]: value }))
  }

  // Tag input: commit-on-comma so users can type "foundation, marine"
  // and get two chips. Empty drafts are no-ops; whitespace is trimmed;
  // duplicates are dropped (case-insensitive comparison).
  function commitTagDraft(): void {
    setState(prev => {
      if (prev === null) return prev
      const trimmed = prev.tagDraft.trim()
      if (trimmed === '') return { ...prev, tagDraft: '' }
      const lower = trimmed.toLowerCase()
      if (prev.tags.some(t => t.toLowerCase() === lower)) {
        return { ...prev, tagDraft: '' }
      }
      return { ...prev, tags: [...prev.tags, trimmed], tagDraft: '' }
    })
  }

  function onTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commitTagDraft()
    } else if (e.key === 'Backspace' && state?.tagDraft === '' && state.tags.length > 0) {
      // Backspace on empty input drops the last chip — Spreadsheet /
      // GitHub-issues style.
      e.preventDefault()
      update(
        'tags',
        state.tags.slice(0, -1),
      )
    }
  }

  function removeTag(tag: string): void {
    update(
      'tags',
      state.tags.filter(t => t !== tag),
    )
  }

  async function handleSubmit(): Promise<void> {
    if (project === null) return
    await doSubmit(state, project)
  }

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="project-metadata-title"
      busy={busy}
      cardClassName="w-[640px] max-h-[85vh] flex flex-col"
    >
      <div className="flex flex-col flex-1 min-h-0">
        <div className="px-6 pt-5 pb-3 border-b border-gray-100">
          <h2
            id="project-metadata-title"
            className="text-base font-semibold text-gray-800"
          >
            Project metadata
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Edit the project's header info. Changes save to the database
            and the .gmproj file in one go.
          </p>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 grid grid-cols-2 gap-x-4 gap-y-3">
          {/* Name — full width. Placeholder shows the current name; an
              empty submit leaves the existing name intact. */}
          <div className="col-span-2">
            <Label htmlFor="pm-name">Name</Label>
            <input
              ref={nameRef}
              id="pm-name"
              type="text"
              value={state.name}
              onChange={e => update('name', e.target.value)}
              disabled={busy}
              placeholder={project?.name}
              className={fieldClass}
            />
          </div>

          <div>
            <Label htmlFor="pm-project-number">Project number</Label>
            <input
              id="pm-project-number"
              type="text"
              value={state.project_number}
              onChange={e => update('project_number', e.target.value)}
              disabled={busy}
              placeholder={project?.project_number ?? 'e.g. GEO-2026-042'}
              className={fieldClass}
            />
          </div>

          <div>
            <Label htmlFor="pm-client">Client</Label>
            <input
              id="pm-client"
              type="text"
              value={state.client}
              onChange={e => update('client', e.target.value)}
              disabled={busy}
              placeholder={project?.client ?? '— not set —'}
              className={fieldClass}
            />
          </div>

          <div className="col-span-2">
            <Label htmlFor="pm-site">Site / location label</Label>
            <input
              id="pm-site"
              type="text"
              value={state.site_label}
              onChange={e => update('site_label', e.target.value)}
              disabled={busy}
              placeholder={project?.site_label ?? 'e.g. Antwerp port — quay 7'}
              className={fieldClass}
            />
          </div>

          <div className="col-span-2">
            <Label htmlFor="pm-description">Description</Label>
            <textarea
              id="pm-description"
              rows={3}
              value={state.description}
              onChange={e => update('description', e.target.value)}
              disabled={busy}
              placeholder={project?.description ?? '— not set —'}
              className={`${fieldClass} resize-y`}
            />
          </div>

          {/* Tags — full width with chip rendering above the input. */}
          <div className="col-span-2">
            <Label htmlFor="pm-tags">Tags</Label>
            {state.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {state.tags.map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      disabled={busy}
                      title={`Remove ${tag}`}
                      className="text-blue-400 hover:text-blue-700 disabled:opacity-50"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              id="pm-tags"
              type="text"
              value={state.tagDraft}
              onChange={e => update('tagDraft', e.target.value)}
              onKeyDown={onTagKeyDown}
              onBlur={commitTagDraft}
              disabled={busy}
              placeholder="Type a tag and press Enter or comma"
              className={fieldClass}
            />
          </div>

          <div>
            <Label htmlFor="pm-h-epsg">Default horizontal CRS</Label>
            <select
              id="pm-h-epsg"
              value={state.default_horizontal_epsg ?? ''}
              onChange={e =>
                update(
                  'default_horizontal_epsg',
                  e.target.value === '' ? null : Number(e.target.value),
                )
              }
              disabled={busy}
              className={fieldClass}
            >
              <option value="">— none —</option>
              {PICKABLE_HORIZONTAL_EPSGS.map(c => (
                <option key={c.epsg} value={c.epsg}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="pm-v-epsg">Default vertical CRS</Label>
            <select
              id="pm-v-epsg"
              value={state.default_vertical_epsg ?? ''}
              onChange={e =>
                update(
                  'default_vertical_epsg',
                  e.target.value === '' ? null : Number(e.target.value),
                )
              }
              disabled={busy}
              className={fieldClass}
            >
              <option value="">— none —</option>
              {PICKABLE_VERTICAL_EPSGS.map(epsg => (
                <option key={epsg} value={epsg}>
                  {VCRS_LABEL_BY_EPSG[epsg] ?? `EPSG:${epsg}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="pm-phase">Phase</Label>
            <select
              id="pm-phase"
              value={state.phase ?? ''}
              onChange={e =>
                update('phase', (e.target.value || null) as ProjectPhase | null)
              }
              disabled={busy}
              className={fieldClass}
            >
              <option value="">— none —</option>
              {PHASES.map(p => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="pm-status">Status</Label>
            <select
              id="pm-status"
              value={state.status}
              onChange={e => update('status', e.target.value as ProjectStatus)}
              disabled={busy}
              className={fieldClass}
            >
              {STATUSES.map(s => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          {error && <span className="mr-auto text-xs text-red-600">{error}</span>}
          <Button
            variant="secondary"
            size="md"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void handleSubmit()}
            // Disabled when the form is unchanged — the placeholder
            // model means an unmodified Save would just close, which
            // is fine but uninteresting. Disable to nudge users
            // toward Cancel when they have nothing to save.
            disabled={busy || !dirty}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
  },
)

export default ProjectMetadataDialog

// Shared field classes so we don't repeat the input styling on every
// element. Single source of truth makes a future re-skin one edit.
const fieldClass =
  'w-full border border-gray-300 rounded px-2 py-1 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50'

function Label({
  htmlFor,
  required,
  children,
}: {
  htmlFor: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-[11px] font-medium text-gray-600 mb-0.5"
    >
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  )
}
