/**
 * Which model refines (depends on) a given interpretation model.
 *
 * The backend refuses to delete a model that another model refines (409 in
 * ``DELETE /projects/{pid}/geology/models/{mid}``): a geological model with a
 * lithostratigraphic child, or a lithostratigraphic model with a geotechnical
 * child. The renderer already holds the full model tree (``parent_model_id``
 * on every model), so the delete affordances read this module to disable
 * themselves BEFORE the user clicks, and the 409 path stays only as the
 * backend safety net (walker finding 2026-10-12).
 */
import type { GeologicalModelResponse, ModelKind } from '../api/client'
import type { MessageKey } from '../i18n/locales/en'

/**
 * The first model whose parent is ``modelId``, or ``null`` when none.
 *
 * Parameters
 * ----------
 * models : readonly GeologicalModelResponse[]
 *     Every model of the project (all kinds).
 * modelId : string | null | undefined
 *     The model the user wants to delete.
 *
 * Returns
 * -------
 * GeologicalModelResponse | null
 *     A model that refines ``modelId``; ``null`` when nothing depends on it.
 */
export function findDependentModel(
  models: readonly GeologicalModelResponse[],
  modelId: string | null | undefined,
): GeologicalModelResponse | null {
  if (!modelId) return null
  return models.find(m => m.parent_model_id === modelId) ?? null
}

/**
 * The message key that explains why a model cannot be deleted.
 *
 * Parameters
 * ----------
 * dependentKind : ModelKind
 *     The kind of the model that refines the one to delete (the model the
 *     user must delete first).
 *
 * Returns
 * -------
 * MessageKey
 *     ``geology.deleteBlockedByLitho`` or ``geology.deleteBlockedByGeotech``.
 */
export function deleteBlockedMessageKey(dependentKind: ModelKind): MessageKey {
  return dependentKind === 'geotechnical'
    ? 'geology.deleteBlockedByGeotech'
    : 'geology.deleteBlockedByLitho'
}
