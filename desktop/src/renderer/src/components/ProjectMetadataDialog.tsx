// Full project-metadata editor. Replaces the name-only New Project flow
// for editing existing projects — clicking the project name in the
// sidebar header opens this dialog with the row pre-populated.
//
// Shape of the form is the union of the backend's ``ProjectCreatePayload``
// and ``ProjectUpdatePayload`` schemas:
//
//   * name (required)
//   * project_number / client / site_label / description (free text)
//   * tags (string[] — comma-or-Enter to append, click X on a chip to drop)
//   * default_horizontal_epsg / default_vertical_epsg
//     (dropdowns with the same pickable EPSGs the elevation editor uses)
//   * phase (feasibility / design / construction / monitoring)
//   * status (active / on_hold / completed)
//
// PATCH semantics: we always send every field, including nulls for cleared
// optionals. The backend's ``model_dump(exclude_unset=True)`` path is for
// tooling that can't track which fields are "intentionally null" vs
// "missing"; we just track every field deliberately and send the lot.

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
  onSubmit: (patch: ProjectUpdatePayload) => Promise<void> | void
  onCancel: () => void
}

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
    tags: project.tags,
    tagDraft: '',
    default_horizontal_epsg: project.default_horizontal_epsg,
    default_vertical_epsg: project.default_vertical_epsg,
    phase: (project.phase as ProjectPhase | null) ?? null,
    status: project.status as ProjectStatus,
  }
}

// Convert the form state back to the PATCH payload. Empty strings become
// null so the DB column ends up NULL instead of '' — matches the backend
// convention (Pydantic Optional[str]).
function toPatch(state: FormState): ProjectUpdatePayload {
  const trim = (s: string) => (s.trim() === '' ? null : s.trim())
  return {
    name: state.name.trim(),
    project_number: trim(state.project_number),
    client: trim(state.client),
    site_label: trim(state.site_label),
    description: trim(state.description),
    tags: state.tags,
    default_horizontal_epsg: state.default_horizontal_epsg,
    default_vertical_epsg: state.default_vertical_epsg,
    phase: state.phase,
    status: state.status,
  }
}

export default function ProjectMetadataDialog({
  open,
  project,
  onSubmit,
  onCancel,
}: Props) {
  const [state, setState] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // Re-seed form state every time we open. Without this, opening the
  // dialog after editing once would show stale draft values. The shared
  // Modal handles Esc + backdrop close; we just own the form state +
  // the focus call.
  useEffect(() => {
    if (!open || project === null) {
      setState(null)
      return
    }
    setState(fromProject(project))
    setError(null)
    setBusy(false)
    const timer = setTimeout(() => nameRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open, project])

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
    if (busy) return
    if (state.name.trim() === '') {
      setError('Name is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Commit any pending tag draft so a user typing "foo" and clicking
      // Save without pressing Enter still gets foo as a tag.
      const patchState =
        state.tagDraft.trim() !== ''
          ? {
              ...state,
              tags: state.tags.some(
                t => t.toLowerCase() === state.tagDraft.trim().toLowerCase(),
              )
                ? state.tags
                : [...state.tags, state.tagDraft.trim()],
              tagDraft: '',
            }
          : state
      await onSubmit(toPatch(patchState))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
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
          {/* Name — full width since it's the most-edited field. */}
          <div className="col-span-2">
            <Label htmlFor="pm-name" required>Name</Label>
            <input
              ref={nameRef}
              id="pm-name"
              type="text"
              value={state.name}
              onChange={e => update('name', e.target.value)}
              disabled={busy}
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
              disabled={busy}
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
              disabled={busy}
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
            disabled={busy || state.name.trim() === ''}
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
