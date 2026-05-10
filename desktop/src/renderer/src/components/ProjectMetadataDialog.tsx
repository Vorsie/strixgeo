// Full project-metadata editor. Reached by clicking the project name in
// the sidebar header.
//
// Standard pre-fill: every field opens with the project's current value
// (or empty for never-set optionals). Hint placeholders show only on
// the truly empty fields, so the user can tell at a glance "this field
// is unset" vs "this field has a value". Clearing a text field maps to
// NULL on save (the diff-on-submit logic catches the change).
//
// Submit-time diff: ``toPatch`` compares the form to the project and
// only includes fields the user actually changed. An untouched form
// produces an empty patch — the caller (App-level applyMetadataDraft
// or saveProject) can short-circuit when there's nothing to apply.

import { useEffect, useRef, useState } from 'react'
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

interface Props {
  open: boolean
  project: ProjectResponse | null
  // Called with the diff patch when the user clicks Save in the editor.
  // The caller (App's ``applyMetadataDraft``) merges the patch into the
  // live project state — no API call happens here. The actual commit
  // to DB + .gmproj happens later via File → Save / Ctrl+S, or as part
  // of the "Save and close" path on the unsaved-changes prompt.
  onSubmit: (patch: ProjectUpdatePayload) => void
  onCancel: () => void
}

// FormState mirrors the project's current values on open; the user's
// edits diverge it. Text fields seed from project.* (NULL → '');
// dropdowns / tags / status seed directly. The submit-time toPatch()
// compares each field to the project's current state and only includes
// fields the user actually changed.
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

function fromProject(project: ProjectResponse): FormState {
  return {
    name: project.name,
    project_number: project.project_number ?? '',
    client: project.client ?? '',
    site_label: project.site_label ?? '',
    description: project.description ?? '',
    // Copy the array so chip-removals don't mutate the source.
    tags: [...project.tags],
    tagDraft: '',
    default_horizontal_epsg: project.default_horizontal_epsg,
    default_vertical_epsg: project.default_vertical_epsg,
    phase: (project.phase as ProjectPhase | null) ?? null,
    status: project.status as ProjectStatus,
  }
}

// Normalise a text-field draft value to its DB form: trimmed string,
// or NULL when the user cleared the field. Used both at diff-time and
// in the dirty check so the two stay in lock-step.
function normaliseText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// Build a PATCH payload that includes only the fields the user actually
// changed from the project's current state. An untouched form produces
// an empty patch — the caller can short-circuit. ``name`` is special-
// cased: empty trimmed string is rejected (NOT NULL in the DB).
function toPatch(state: FormState, project: ProjectResponse): ProjectUpdatePayload {
  const patch: ProjectUpdatePayload = {}

  // Required: name. Trimmed empty is invalid; preserve the existing
  // value in that case (safer than emitting an obvious server error).
  const newName = state.name.trim()
  if (newName !== '' && newName !== project.name) patch.name = newName

  // Optional text fields: '' → NULL semantics, only included when changed.
  const fields: ReadonlyArray<{
    key: 'project_number' | 'client' | 'site_label' | 'description'
    draft: string
  }> = [
    { key: 'project_number', draft: state.project_number },
    { key: 'client', draft: state.client },
    { key: 'site_label', draft: state.site_label },
    { key: 'description', draft: state.description },
  ]
  for (const { key, draft } of fields) {
    const next = normaliseText(draft)
    if (next !== project[key]) patch[key] = next
  }

  // Tags: full replacement. Diff against project.tags; only included
  // when the chip list actually changed.
  const tagsChanged =
    state.tags.length !== project.tags.length ||
    state.tags.some((t, i) => t !== project.tags[i])
  if (tagsChanged) patch.tags = state.tags

  // Dropdowns: include only when changed.
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

// Has the form deviated from its initial state? Used to gate the
// dirty-prompt-on-close and the Save button's enabled state. Mirrors
// the toPatch comparisons exactly so a non-empty patch ⟺ dirty.
function isDirty(state: FormState, project: ProjectResponse): boolean {
  const newName = state.name.trim()
  if (newName !== '' && newName !== project.name) return true
  if (normaliseText(state.project_number) !== project.project_number) return true
  if (normaliseText(state.client) !== project.client) return true
  if (normaliseText(state.site_label) !== project.site_label) return true
  if (normaliseText(state.description) !== project.description) return true
  if (state.tagDraft.trim() !== '') return true
  if (state.tags.length !== project.tags.length) return true
  if (state.tags.some((t, i) => t !== project.tags[i])) return true
  if (state.default_horizontal_epsg !== project.default_horizontal_epsg) return true
  if (state.default_vertical_epsg !== project.default_vertical_epsg) return true
  if ((state.phase ?? null) !== (project.phase ?? null)) return true
  if (state.status !== project.status) return true
  return false
}

export default function ProjectMetadataDialog({
  open,
  project,
  onSubmit,
  onCancel,
}: Props) {
  const [state, setState] = useState<FormState | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // Re-seed form state every time we open. Without this, opening the
  // dialog after editing once would show stale draft values from the
  // previous session.
  useEffect(() => {
    if (!open || project === null) {
      setState(null)
      return
    }
    setState(fromProject(project))
    const timer = setTimeout(() => nameRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open, project])

  // Save commits the form's diff to the live project state via the
  // caller's onSubmit (App-level applyMetadataDraft). No API call here
  // — that happens later via File → Save. The dirty / Save-button-
  // enabled signal comes from comparing the form to the project.
  function handleSubmit(): void {
    if (state === null || project === null) return
    // Auto-commit any pending tag draft so a user typing "foo" and
    // clicking Save without pressing Enter still gets foo as a tag.
    const trimmedDraft = state.tagDraft.trim()
    const tags =
      trimmedDraft !== '' &&
      !state.tags.some(t => t.toLowerCase() === trimmedDraft.toLowerCase())
        ? [...state.tags, trimmedDraft]
        : state.tags
    const finalState = { ...state, tags, tagDraft: '' }
    const patch = toPatch(finalState, project)
    // Empty patch means nothing changed — don't bother the App with a
    // no-op apply. Just close the dialog.
    if (Object.keys(patch).length > 0) {
      onSubmit(patch)
    } else {
      onCancel()
    }
  }

  const dirty = state !== null && project !== null ? isDirty(state, project) : false

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

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="project-metadata-title"
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
          {/* Name — full width. Required (NOT NULL in the DB); a blank
              submit preserves the existing value rather than erroring. */}
          <div className="col-span-2">
            <Label htmlFor="pm-name">Name</Label>
            <input
              ref={nameRef}
              id="pm-name"
              type="text"
              value={state.name}
              onChange={e => update('name', e.target.value)}
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
              placeholder="e.g. GEO-2026-042"
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
              placeholder="e.g. Port of Antwerp"
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
              placeholder="e.g. Antwerp port — quay 7"
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
              placeholder="Free-text scope notes"
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
          <Button variant="secondary" size="md" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleSubmit}
            // Disabled when the form is unchanged — clicking Save with
            // nothing to apply is just a Cancel in disguise.
            disabled={!dirty}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}

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
