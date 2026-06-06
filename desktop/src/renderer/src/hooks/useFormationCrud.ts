/**
 * Formation-CRUD handler cluster for {@link useGeologicalModel} (debt #201
 * Move 5). Extracted as a focused sub-hook so the composer stays a thin owner
 * of shared state. This cluster is a LEAF in the hook's call graph — no other
 * handler calls these — so it lifts out cleanly.
 *
 * The shared state (the formations list, the bundle manifest, the
 * session-import set) lives in the composer and is passed in; this hook owns
 * only the four create/update/delete callbacks.
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react'

import { api } from '../api/client'
import type {
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
  ProjectResponse,
} from '../api/client'
import { log } from '../utils/log'

/** Inputs for {@link useFormationCrud}. */
export interface UseFormationCrudParams {
  /** The open project, or null when none is loaded. */
  project: ProjectResponse | null
  /** Add formation ids to the bundle manifest. */
  addToManifest: (kind: 'formation', ids: string[]) => void
  /** Remove formation ids from the bundle manifest. */
  removeFromManifest: (kind: 'formation', ids: Iterable<string>) => void
  /** Add formation ids to the session-import (dirty) set. */
  addToSessionImports: (kind: 'formation' | 'contact', ids: string[]) => void
  /** Remove formation ids from the session-import (dirty) set. */
  removeFromSessionImports: (kind: 'formation' | 'contact', ids: string[]) => void
  /** Resync the cached formation list from the server. */
  refetchFormations: () => void
  /** Setter for the composer-owned formation list (optimistic insert). */
  setFormations: Dispatch<SetStateAction<GeologicalFormationResponse[]>>
}

/** Handlers returned by {@link useFormationCrud}. */
export interface UseFormationCrudResult {
  handleFormationCreated: (id: string) => void
  handleFormationUpdated: () => void
  handleFormationDeleted: (id: string) => void
  handleInlineCreateFormation: (
    payload: GeologicalFormationCreatePayload,
  ) => Promise<{ id: string } | null>
}

/**
 * Formation create / update / delete callbacks.
 *
 * Parameters
 * ----------
 * params
 *     See {@link UseFormationCrudParams}.
 *
 * Returns
 * -------
 * UseFormationCrudResult
 *     The four formation-CRUD handlers.
 */
export function useFormationCrud({
  project,
  addToManifest,
  removeFromManifest,
  addToSessionImports,
  removeFromSessionImports,
  refetchFormations,
  setFormations,
}: UseFormationCrudParams): UseFormationCrudResult {
  const handleFormationCreated = useCallback(
    (id: string) => {
      addToManifest('formation', [id])
      addToSessionImports('formation', [id])
      refetchFormations()
    },
    [addToManifest, addToSessionImports, refetchFormations],
  )
  const handleFormationUpdated = useCallback(() => {
    // No manifest / dirty change on update (the formation is already
    // in the manifest); just resync the cached list so renames and
    // recolour land in the picker + section overlay.
    refetchFormations()
  }, [refetchFormations])
  const handleFormationDeleted = useCallback(
    (id: string) => {
      removeFromManifest('formation', new Set([id]))
      // Drop it from the session-import set too. Deleting a formation
      // that was created-but-not-yet-saved must clear its dirty
      // contribution — otherwise ``projectDirty`` stays true forever
      // over a row that no longer exists (the normal delete-then-save
      // path never reaches discardSessionImports).
      removeFromSessionImports('formation', [id])
      refetchFormations()
    },
    [removeFromManifest, removeFromSessionImports, refetchFormations],
  )

  const handleInlineCreateFormation = useCallback(
    async (
      payload: GeologicalFormationCreatePayload,
    ): Promise<{ id: string } | null> => {
      if (!project) return null
      try {
        const created = await api.geology.createFormation(project.id, payload)
        setFormations(prev => [...prev, created])
        handleFormationCreated(created.id)
        return { id: created.id }
      } catch (err) {
        log.error('geology', 'inline createFormation failed', err)
        return null
      }
    },
    [project, handleFormationCreated, setFormations],
  )

  return {
    handleFormationCreated,
    handleFormationUpdated,
    handleFormationDeleted,
    handleInlineCreateFormation,
  }
}
