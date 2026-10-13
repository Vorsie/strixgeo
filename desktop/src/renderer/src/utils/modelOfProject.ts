// A model is only ever "active" for the project it belongs to (owner dogfeed
// 2026-10-13). On a project switch the stored model pointers survive until the
// new project's model list arrives; read raw, every model-scoped effect saw the
// NEW project id paired with the OLD project's model id and sent requests that
// 404'd ("Model not found"). Reading the pointers through these guards makes a
// switch yield no active model until the new list is in.

import type { GeologicalModelResponse } from '../api/clients/geology.types'

/**
 * The model when it belongs to ``projectId``, otherwise ``null``.
 *
 * Parameters
 * ----------
 * model : GeologicalModelResponse | null
 *     The stored model pointer (may still belong to the previous project).
 * projectId : string | null
 *     The open project's id, or ``null`` when no project is open.
 *
 * Returns
 * -------
 * GeologicalModelResponse | null
 *     The SAME object when it belongs to the open project (identity kept, so
 *     effects keyed on it do not re-run), else ``null``.
 */
export function modelOfProject(
  model: GeologicalModelResponse | null,
  projectId: string | null,
): GeologicalModelResponse | null {
  if (model === null || projectId === null) return null
  return model.app_project_id === projectId ? model : null
}

/**
 * The models of a list that belong to ``projectId``.
 *
 * Parameters
 * ----------
 * models : readonly GeologicalModelResponse[]
 *     The stored model list (may still be the previous project's).
 * projectId : string | null
 *     The open project's id, or ``null`` when no project is open.
 *
 * Returns
 * -------
 * GeologicalModelResponse[]
 *     The models of the open project, in list order; empty when none.
 */
export function modelsOfProject(
  models: readonly GeologicalModelResponse[],
  projectId: string | null,
): GeologicalModelResponse[] {
  if (projectId === null) return []
  return models.filter(m => m.app_project_id === projectId)
}
