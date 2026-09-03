// Geology inspector — formation list with drag-reorder (GeologyFormationList)
// and its per-row component (GeologyFormationRow).
//
// Extracted verbatim from the inline ``<ul>`` + the ``FormationRow`` component
// of GeologyInspector.tsx (debt #201 god-component decomposition round).
// Presentational only: the parent (useGeologyFormations) owns the formation
// mirror, the drag state, and the mutation handlers. GeologyFormationRow lives
// at module scope (NOT nested inside GeologyFormationList) so it keeps a stable
// identity across parent renders — an inner component re-identifies on every
// render and React unmount/remounts it (the LithoUnitRow precedent).
//
// Youngest-first reading order is a caller concern: the parent passes the
// already-displayed (reversed) list; this component renders it as given and the
// reorder math (in reorderFormationsCommand) inverts back to ``display_order``.

import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { GripVertical, Trash2 } from 'lucide-react'

import type { GeologicalFormationResponse } from '../../../api/client'
import DirtyAsterisk from '../../../components/ui/DirtyAsterisk'
import { useT } from '../../../i18n/translate'
import type { Translator } from '../../../i18n/translate'

// ---------------------------------------------------------------------------
// GeologyFormationRow — one formation row (module scope, NOT defined inside
// GeologyFormationList: an inner component re-identifies every parent render
// and React unmount/remounts it — the LithoUnitRow precedent).
// ---------------------------------------------------------------------------

interface FormationRowProps {
  formation: GeologicalFormationResponse
  /** True when this formation was created in the current session and has not
   *  yet been persisted to the .gmproj bundle.  Renders the amber left-stripe
   *  and asterisk matching the CPT / borehole unsaved convention. */
  unsaved: boolean
  isDragging: boolean
  isDragOver: boolean
  reorderBusy: boolean
  onEdit: () => void
  onDelete: () => void
  /** Called when the user picks a new colour in the swatch and the picker
   *  closes (input ``onBlur``). Fired only when the new colour differs from
   *  ``formation.color``; the parent owns the PATCH + undo. */
  onColorChange: (newColor: string) => void
  onDragStart: () => void
  onDragOver: () => void
  onDragLeave: () => void
  onDrop: () => void
  onDragEnd: () => void
  /** Index (0-based) within the displayed (youngest-first) list —
   *  used for ordinal-based testid targeting in e2e harnesses. */
  displayIndex: number
}

/**
 * One formation row in the list — colour swatch, name, drag handle, delete.
 *
 * Parameters
 * ----------
 * formation
 *     The formation data.
 * unsaved
 *     True when this formation was created in the current session and has not
 *     yet been committed to the .gmproj bundle. Renders an amber left-stripe
 *     and asterisk so the user can see which formations need a save.
 * isDragging
 *     True when this row is the drag source (dims it).
 * isDragOver
 *     True when the cursor hovers this row as a drop target.
 * reorderBusy
 *     When true the drag handle is disabled (a reorder is in-flight).
 * onEdit / onDelete / onDragStart / onDragOver / onDragLeave / onDrop / onDragEnd
 *     Event callbacks forwarded from the list.
 *
 * Returns
 * -------
 * JSX.Element
 *     The list-item element.
 */
function GeologyFormationRow({
  formation,
  displayIndex,
  unsaved,
  isDragging,
  isDragOver,
  reorderBusy,
  onEdit,
  onDelete,
  onColorChange,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: FormationRowProps): JSX.Element {
  const t = useT()
  // Pending colour while the native picker is open. ``null`` means
  // "no pick in progress — render formation.color". Committed on blur
  // via onColorChange (which equality-checks against formation.color
  // and no-ops if unchanged, so an Esc-cancel that never fires onChange
  // is naturally a no-op too).
  const [pendingColor, setPendingColor] = useState<string | null>(null)
  const displayedColor = pendingColor ?? formation.color
  return (
    <li
      data-testid={`geology-formation-list-item-${formation.id}`}
      data-formation-id={formation.id}
      data-display-index={displayIndex}
      onDragOver={e => {
        // ``preventDefault`` is required to mark the row as a drop target;
        // without it the browser fires no drop event.
        e.preventDefault()
        onDragOver()
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={[
        // Unsaved rows get a 4 px amber left-stripe + tinted background,
        // matching the CPT / borehole unsaved convention in Sidebar.tsx.
        // A 2 px transparent border keeps layout stable in the saved state.
        'group flex items-center gap-2 px-2 py-1.5 rounded transition-colors',
        isDragOver
          ? 'border-t-2 border-t-accent border-l-2 border-l-transparent'
          : unsaved
            ? 'border-l-4 border-l-status-amber bg-amber-50/60 dark:bg-amber-950/30 hover:bg-amber-50/90 dark:hover:bg-amber-950/40'
            : 'border-l-2 border-l-transparent hover:bg-surface-card',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      <button
        type="button"
        draggable={!reorderBusy}
        onDragStart={e => {
          // Without text/plain payload Firefox refuses to start the drag.
          e.dataTransfer.setData('text/plain', formation.id)
          e.dataTransfer.effectAllowed = 'move'
          onDragStart()
        }}
        onDragEnd={onDragEnd}
        title={t('geology.reorderHint')}
        data-testid={`geology-formation-drag-handle-${formation.id}`}
        className="cursor-grab active:cursor-grabbing text-text-muted hover:text-text-secondary shrink-0 -ml-1 px-0.5"
        aria-label={t('geology.dragToReorderNamed', { name: formation.name })}
      >
        <GripVertical size={12} />
      </button>
      {/*
        Swatch doubles as a colour-picker trigger. Native ``<input type="color">``
        opens on label click; ``pendingColor`` mirrors the chosen value while
        the picker is open so the swatch updates in lock-step. ``onBlur`` is
        the commit point — the parent equality-checks against
        ``formation.color`` and PATCHes only on a real change. Esc/cancel
        never fires ``onChange``, so pendingColor stays null and the blur is
        a no-op. ``sr-only`` keeps the input visually hidden but reachable.
      */}
      <label
        title={t('geology.colorClickToChange', { color: displayedColor })}
        aria-label={t('geology.changeColorOf', { name: formation.name })}
        data-testid={`geology-formation-color-swatch-${formation.id}`}
        className="inline-block w-3.5 h-3.5 rounded border border-border-default shrink-0 cursor-pointer focus-within:ring-2 focus-within:ring-accent"
        style={{ backgroundColor: displayedColor }}
      >
        <input
          type="color"
          value={displayedColor}
          onChange={e => setPendingColor(e.currentTarget.value)}
          onBlur={() => {
            const picked = pendingColor
            setPendingColor(null)
            if (picked !== null) onColorChange(picked)
          }}
          className="sr-only"
          data-testid={`geology-formation-color-input-${formation.id}`}
        />
      </label>
      <button
        onClick={onEdit}
        className="flex-1 text-left min-w-0"
        title={t('geology.editFormation')}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-text-primary truncate">
            {formation.name}
          </span>
          {unsaved && <DirtyAsterisk title={t('project.createdSinceSave')} />}
        </div>
        {formation.regional_ref && (
          <div className="text-[10px] text-text-muted truncate">
            {formation.regional_ref}
          </div>
        )}
      </button>
      <button
        onClick={onDelete}
        title={t('geology.deleteFormation')}
        className="p-1 rounded text-text-muted hover:text-status-danger hover:bg-surface-app opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
      >
        <Trash2 size={11} />
      </button>
    </li>
  )
}

// ---------------------------------------------------------------------------
// GeologyFormationList — the drag-reorderable formation list
// ---------------------------------------------------------------------------

interface GeologyFormationListProps {
  /** The formations to list, already in displayed (youngest-first) order. */
  formations: readonly GeologicalFormationResponse[]
  /** Ids of formations created this session and not yet saved (amber marker). */
  sessionImportFormationIds: ReadonlySet<string> | undefined
  /** Id of the formation currently being dragged, or ``null``. */
  draggedId: string | null
  /** Id (or ``'end'``) currently hovered as a drop target, or ``null``. */
  dragOverId: string | 'end' | null
  /** True while a reorder PATCH is in flight (disables the drag handles). */
  reorderBusy: boolean
  /** Open the edit dialog for a formation. */
  onEditFormation: (formation: GeologicalFormationResponse) => void
  /** Request delete-confirmation for a formation. */
  onDeleteFormation: (formation: GeologicalFormationResponse) => void
  /** Commit a colour override for a formation. */
  onColorChange: (formation: GeologicalFormationResponse, newColor: string) => void
  /** Persist a drag-reorder (source id, target id or ``'end'``). */
  onReorder: (sourceId: string, targetId: string | 'end') => Promise<void>
  setDraggedId: Dispatch<SetStateAction<string | null>>
  setDragOverId: Dispatch<SetStateAction<string | 'end' | null>>
  t: Translator
}

/**
 * Renders the geology inspector's formation list with drag-to-reorder.
 *
 * Each row is a {@link GeologyFormationRow}; a bottom drop-zone appears only
 * while a drag is active. All state is owned by the parent hook — this
 * component wires the rows' event callbacks to the parent's setters + handlers.
 *
 * Parameters
 * ----------
 * formations
 *     The displayed (youngest-first) formation list.
 * sessionImportFormationIds
 *     Unsaved-formation ids for the amber row marker.
 * draggedId / dragOverId / reorderBusy
 *     Drag-reorder state driving row visuals + the bottom drop-zone.
 * onEditFormation / onDeleteFormation / onColorChange / onReorder
 *     Mutation callbacks forwarded to each row + the drop-zone.
 * setDraggedId / setDragOverId
 *     Drag-state setters the row callbacks drive.
 * t
 *     The active-language translator.
 *
 * Returns
 * -------
 * JSX.Element
 *     The formation list element.
 */
export default function GeologyFormationList({
  formations,
  sessionImportFormationIds,
  draggedId,
  dragOverId,
  reorderBusy,
  onEditFormation,
  onDeleteFormation,
  onColorChange,
  onReorder,
  setDraggedId,
  setDragOverId,
  t,
}: GeologyFormationListProps): JSX.Element {
  return (
    <ul className="flex flex-col gap-1">
      {formations.map((f, idx) => (
        <GeologyFormationRow
          key={f.id}
          formation={f}
          displayIndex={idx}
          unsaved={sessionImportFormationIds?.has(f.id) ?? false}
          isDragging={draggedId === f.id}
          isDragOver={dragOverId === f.id && draggedId !== null && draggedId !== f.id}
          reorderBusy={reorderBusy}
          onEdit={() => onEditFormation(f)}
          onDelete={() => onDeleteFormation(f)}
          onColorChange={newColor => onColorChange(f, newColor)}
          onDragStart={() => setDraggedId(f.id)}
          onDragOver={() => setDragOverId(f.id)}
          onDragLeave={() => {
            setDragOverId(prev => (prev === f.id ? null : prev))
          }}
          onDrop={() => {
            if (draggedId && draggedId !== f.id) {
              void onReorder(draggedId, f.id)
            }
            setDraggedId(null)
            setDragOverId(null)
          }}
          onDragEnd={() => {
            setDraggedId(null)
            setDragOverId(null)
          }}
        />
      ))}
      {draggedId !== null && (
        // End-of-list drop zone — visible only during a drag.
        <li
          onDragOver={e => {
            e.preventDefault()
            setDragOverId('end')
          }}
          onDrop={() => {
            if (draggedId) void onReorder(draggedId, 'end')
            setDraggedId(null)
            setDragOverId(null)
          }}
          className={[
            'h-3 mx-2 rounded-sm border-t-2 border-dashed transition-colors',
            dragOverId === 'end' ? 'border-accent' : 'border-border-default',
          ].join(' ')}
          aria-label={t('geology.dropAtBottom')}
        />
      )}
    </ul>
  )
}
