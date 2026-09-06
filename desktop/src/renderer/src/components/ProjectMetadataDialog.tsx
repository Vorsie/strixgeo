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
  PICKABLE_HORIZONTAL_EPSGS,
  PICKABLE_VERTICAL_EPSGS,
  VCRS_LABEL_BY_EPSG,
} from '../utils/verticalDatum'
import { arraysEqual } from '../utils/arrays'
import { useT } from '../i18n/translate'

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

// Catalogue keys for the dropdown labels. ``as const`` keeps each value a
// literal member of MessageKey so t() accepts it without a type import; the
// English text still lives in the catalogue (project.phase* / project.status*).
const PHASE_LABEL_KEYS = {
  feasibility: 'project.phaseFeasibility',
  design: 'project.phaseDesign',
  construction: 'project.phaseConstruction',
  monitoring: 'project.phaseMonitoring',
} as const

const STATUS_LABEL_KEYS = {
  active: 'project.statusActive',
  on_hold: 'project.statusOnHold',
  completed: 'project.statusCompleted',
} as const

interface Props {
  open: boolean
  // Live project state — what the form pre-fills from. Updated by the
  // editor's Save (which applies the diff via the App's
  // applyMetadataDraft). May already differ from ``saved`` when the
  // editor opens (user has unsaved live edits from a previous session
  // of the dialog).
  project: ProjectResponse | null
  // Last-saved snapshot. Per-field dirty highlighting compares the
  // form to THIS, not to ``project``, so a field shows amber when it
  // differs from what's persisted to disk + DB — not just from what
  // the user typed in this dialog session. Drives the at-a-glance
  // "what's not yet saved to file" view.
  saved: ProjectResponse | null
  // Called with the diff patch when the user clicks Save in the editor.
  // The caller (App's ``applyMetadataDraft``) merges the patch into the
  // live project state — no API call happens here. The actual commit
  // to DB + .gmproj happens later via File → Save / Ctrl+S, or as part
  // of the "Save and close" path on the unsaved-changes prompt.
  onSubmit: (patch: ProjectUpdatePayload) => void
  onCancel: () => void
  // Report the draft horizontal CRS / vertical datum up to App as the user
  // picks them, so the guided tutorial's CRS / datum steps advance the moment a
  // value is selected here, before Save (owner ruling 1, 2026-09-06). Called
  // with null/null when the dialog is closed so a closed dialog holds no draft.
  // Optional: nothing else depends on it.
  onDraftCrsDatumChange?: (draft: {
    horizontal: number | null
    vertical: number | null
  }) => void
}

// Per-field dirty flags driven by the form-vs-saved comparison. Used
// to paint amber borders on unsaved fields. Mirrors the same field
// list and equality rules as ``toPatch`` / ``isDirty``, just exposed
// per-field for the renderer.
interface FieldDirty {
  name: boolean
  project_number: boolean
  client: boolean
  site_label: boolean
  description: boolean
  tags: boolean
  default_horizontal_epsg: boolean
  default_vertical_epsg: boolean
  phase: boolean
  status: boolean
}

function computeFieldDirty(
  state: FormState,
  saved: ProjectResponse | null,
): FieldDirty {
  if (saved === null) {
    return {
      name: false,
      project_number: false,
      client: false,
      site_label: false,
      description: false,
      tags: false,
      default_horizontal_epsg: false,
      default_vertical_epsg: false,
      phase: false,
      status: false,
    }
  }
  const newName = state.name.trim()
  return {
    // Name: blank is treated as "no change" (it would preserve the
    // saved value), so don't flag it as dirty even though state.name
    // empty technically differs from saved.name.
    name: newName !== '' && newName !== saved.name,
    project_number: normaliseText(state.project_number) !== saved.project_number,
    client: normaliseText(state.client) !== saved.client,
    site_label: normaliseText(state.site_label) !== saved.site_label,
    description: normaliseText(state.description) !== saved.description,
    tags: !arraysEqual(state.tags, saved.tags),
    default_horizontal_epsg:
      state.default_horizontal_epsg !== saved.default_horizontal_epsg,
    default_vertical_epsg:
      state.default_vertical_epsg !== saved.default_vertical_epsg,
    phase: (state.phase ?? null) !== (saved.phase ?? null),
    status: state.status !== saved.status,
  }
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
  if (!arraysEqual(state.tags, project.tags)) patch.tags = state.tags

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
  if (!arraysEqual(state.tags, project.tags)) return true
  if (state.default_horizontal_epsg !== project.default_horizontal_epsg) return true
  if (state.default_vertical_epsg !== project.default_vertical_epsg) return true
  if ((state.phase ?? null) !== (project.phase ?? null)) return true
  if (state.status !== project.status) return true
  return false
}

export default function ProjectMetadataDialog({
  open,
  project,
  saved,
  onSubmit,
  onCancel,
  onDraftCrsDatumChange,
}: Props) {
  const t = useT()
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

  // Report the draft CRS / datum up to App so the guided tutorial's CRS and
  // datum steps advance the moment a value is selected here, before Save (owner
  // ruling 1, 2026-09-06). Fires on every draft change; reports null/null when
  // the dialog is closed (``state`` is null once the re-seed effect above runs),
  // so a closed dialog holds no draft and the steps fall back to the SAVED
  // project's CRS / datum. ``onDraftCrsDatumChange`` is a stable App setter, so
  // it never re-fires this on its own identity.
  useEffect(() => {
    onDraftCrsDatumChange?.({
      horizontal: state?.default_horizontal_epsg ?? null,
      vertical: state?.default_vertical_epsg ?? null,
    })
  }, [onDraftCrsDatumChange, state?.default_horizontal_epsg, state?.default_vertical_epsg])

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

  if (!open || state === null || project === null) return null

  // Per-field dirty highlights: amber border on any input whose value
  // differs from the LAST-SAVED snapshot (not the live project). When
  // the editor opens with an already-dirty project, fields that the
  // user changed in a previous editor session immediately show amber.
  // Computed after the early return so the unreachable ``state === null``
  // branch doesn't need a placeholder fallback.
  const dirty = isDirty(state, project)
  const fieldDirty: FieldDirty = computeFieldDirty(state, saved)

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
    // ``state`` is non-null here — the component returns null above
    // when state is null — but TS doesn't carry the narrowing into a
    // nested function scope. Use the setState-updater form to read
    // the latest value without re-deriving the guard.
    setState(prev => (prev === null ? prev : { ...prev, tags: prev.tags.filter(t => t !== tag) }))
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
            {t('project.metadata')}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {t('project.metadataBlurbFull')}
          </p>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 grid grid-cols-2 gap-x-4 gap-y-3">
          {/* Name — full width. Required (NOT NULL in the DB); a blank
              submit preserves the existing value rather than erroring. */}
          <div className="col-span-2">
            <Label htmlFor="pm-name">{t('common.name')}</Label>
            <input
              ref={nameRef}
              id="pm-name"
              type="text"
              value={state.name}
              onChange={e => update('name', e.target.value)}
              className={fieldClassFor(fieldDirty.name)}
            />
          </div>

          <div>
            <Label htmlFor="pm-project-number">{t('project.number')}</Label>
            <input
              id="pm-project-number"
              type="text"
              value={state.project_number}
              onChange={e => update('project_number', e.target.value)}
              placeholder={t('project.numberPlaceholder')}
              className={fieldClassFor(fieldDirty.project_number)}
            />
          </div>

          <div>
            <Label htmlFor="pm-client">{t('project.client')}</Label>
            <input
              id="pm-client"
              type="text"
              value={state.client}
              onChange={e => update('client', e.target.value)}
              placeholder={t('project.clientPlaceholder')}
              className={fieldClassFor(fieldDirty.client)}
            />
          </div>

          <div className="col-span-2">
            <Label htmlFor="pm-site">{t('project.site')}</Label>
            <input
              id="pm-site"
              type="text"
              value={state.site_label}
              onChange={e => update('site_label', e.target.value)}
              placeholder={t('project.sitePlaceholder')}
              className={fieldClassFor(fieldDirty.site_label)}
            />
          </div>

          <div className="col-span-2">
            <Label htmlFor="pm-description">{t('project.description')}</Label>
            <textarea
              id="pm-description"
              rows={3}
              value={state.description}
              onChange={e => update('description', e.target.value)}
              placeholder={t('project.descriptionHint')}
              className={`${fieldClassFor(fieldDirty.description)} resize-y`}
            />
          </div>

          {/* Tags — full width with chip rendering above the input. */}
          <div className="col-span-2">
            <Label htmlFor="pm-tags">{t('project.tags')}</Label>
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
                      title={t('project.removeTag', { tag })}
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
              placeholder={t('project.tagsPlaceholder')}
              className={fieldClassFor(fieldDirty.tags)}
            />
          </div>

          <div>
            <Label htmlFor="pm-h-epsg">{t('project.defaultHorizontalCrs')}</Label>
            <select
              id="pm-h-epsg"
              data-testid="project-crs-horizontal"
              value={state.default_horizontal_epsg ?? ''}
              onChange={e =>
                update(
                  'default_horizontal_epsg',
                  e.target.value === '' ? null : Number(e.target.value),
                )
              }
              className={fieldClassFor(fieldDirty.default_horizontal_epsg)}
            >
              <option value="">{t('common.none')}</option>
              {PICKABLE_HORIZONTAL_EPSGS.map(c => (
                <option key={c.epsg} value={c.epsg}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="pm-v-epsg">{t('project.defaultVerticalCrs')}</Label>
            <select
              id="pm-v-epsg"
              data-testid="project-crs-vertical"
              value={state.default_vertical_epsg ?? ''}
              onChange={e =>
                update(
                  'default_vertical_epsg',
                  e.target.value === '' ? null : Number(e.target.value),
                )
              }
              className={fieldClassFor(fieldDirty.default_vertical_epsg)}
            >
              <option value="">{t('common.none')}</option>
              {PICKABLE_VERTICAL_EPSGS.map(epsg => (
                <option key={epsg} value={epsg}>
                  {/* i18n-exempt: EPSG registry code — a technical CRS identifier, identical in every locale. */}
                  {VCRS_LABEL_BY_EPSG[epsg] ?? `EPSG:${epsg}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="pm-phase">{t('project.phase')}</Label>
            <select
              id="pm-phase"
              value={state.phase ?? ''}
              onChange={e =>
                update('phase', (e.target.value || null) as ProjectPhase | null)
              }
              className={fieldClassFor(fieldDirty.phase)}
            >
              <option value="">{t('common.none')}</option>
              {PHASES.map(p => (
                <option key={p.value} value={p.value}>
                  {t(PHASE_LABEL_KEYS[p.value])}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="pm-status">{t('project.status')}</Label>
            <select
              id="pm-status"
              value={state.status}
              onChange={e => update('status', e.target.value as ProjectStatus)}
              className={fieldClassFor(fieldDirty.status)}
            >
              {STATUSES.map(s => (
                <option key={s.value} value={s.value}>
                  {t(STATUS_LABEL_KEYS[s.value])}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleSubmit}
            // Disabled when the form is unchanged — clicking Save with
            // nothing to apply is just a Cancel in disguise.
            disabled={!dirty}
          >
            {t('common.save')}
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

// Amber border + subtle background tint on fields whose value differs
// from the last-saved snapshot. Overrides ``border-gray-300`` from
// ``fieldClass`` (Tailwind takes the later class). Amber over red on
// purpose — red signals validation errors in form contexts; amber
// signals "unsaved" without overloading semantics.
const dirtyFieldClass = 'border-amber-400 bg-amber-50/60'

function fieldClassFor(isDirty: boolean): string {
  return isDirty ? `${fieldClass} ${dirtyFieldClass}` : fieldClass
}

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
