/**
 * The cross-project invariant (owner 2026-10-13).
 *
 * The owner found by hand, in one session, what the walker could not: opening
 * a SECOND project left the first project's models active (a 404 burst and
 * console errors). The walker now switches projects (``switchProject``), and
 * this ledger judges every request the renderer sends:
 *
 * (a) a request under project P's path that names a model id first seen under
 *     another project Q -> ``cross-project-request``;
 * (b) a request under a project the walk has opened, while a DIFFERENT
 *     project is the open one -> ``cross-project-request``.
 *
 * Requests are judged against the project that was open when the request was
 * SENT (the orchestrator stamps it at the ``request`` event), not when its
 * answer came back, so a slow answer to a request sent before the close is not
 * blamed on the next project. While no project is known to be open (mid-switch,
 * the welcome screen) nothing is judged. Status does not matter: the backend
 * answering 404 is the visible symptom, but a stale request that happened to
 * succeed is the same bug.
 *
 * Pure: no Playwright, no app. The orchestrator feeds it the model ids it reads
 * from ``GET /projects/{id}/geology/models`` after each open, plus every
 * request url it sees.
 */

import type { Finding } from './walkerInvariants'

/** One request as the orchestrator saw it at send time. */
export interface ObservedRequest {
  readonly method: string
  readonly url: string
  /** The project open when the request was sent; null mid-switch / on welcome. */
  readonly currentProjectId: string | null
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const PROJECT_RE = new RegExp(`/projects/(${UUID})(?:[/?#]|$)`)
// ``/geology/models/<id>`` (every model route) and ``model_id=<id>`` (query).
const MODEL_RE = new RegExp(`(?:/models/|[?&]model_id=)(${UUID})`, 'g')

/**
 * The project id and model ids a url names.
 *
 * @param url - A request url.
 * @returns The first ``/projects/<uuid>`` id (or null) and every model id, lowercased.
 */
export function idsInUrl(url: string): { projectId: string | null; modelIds: string[] } {
  const p = url.match(PROJECT_RE)
  const modelIds: string[] = []
  for (const m of url.matchAll(MODEL_RE)) modelIds.push(m[1].toLowerCase())
  return { projectId: p ? p[1].toLowerCase() : null, modelIds }
}

/** The url without its query string, for de-duplicating a polled request. */
function pathOf(url: string): string {
  const q = url.indexOf('?')
  return q < 0 ? url : url.slice(0, q)
}

/**
 * Which project owns which model, and which projects the walk has opened.
 *
 * Ownership comes from the model list read after each open
 * (:meth:`registerModels`) and, as a backstop, from consistent traffic: a model
 * requested under the path of the project that IS open is that project's.
 */
export class CrossProjectLedger {
  private readonly modelOwner = new Map<string, string>()
  private readonly knownProjects = new Set<string>()
  private readonly reported = new Set<string>()

  /**
   * Record a project the walk opened and the model ids it holds.
   *
   * @param projectId - The project.
   * @param modelIds - Its model ids (first registration wins on a clash).
   */
  registerModels(projectId: string, modelIds: readonly string[]): void {
    const pid = projectId.toLowerCase()
    this.knownProjects.add(pid)
    for (const m of modelIds) {
      const mid = m.toLowerCase()
      if (!this.modelOwner.has(mid)) this.modelOwner.set(mid, pid)
    }
  }

  /**
   * Judge the requests sent since the last step.
   *
   * @param requests - Requests in send order, each stamped with the open project.
   * @param step - The step index stamped on each finding.
   * @returns One ``cross-project-request`` finding per offending request; the
   *   same method + path is reported once per walk (a polled stale url would
   *   otherwise bury the report).
   */
  check(requests: readonly ObservedRequest[], step: number): Finding[] {
    const out: Finding[] = []
    for (const r of requests) {
      const { projectId, modelIds } = idsInUrl(r.url)
      if (projectId === null) continue
      const current = r.currentProjectId?.toLowerCase() ?? null
      const detail = current === null ? null : this.violation(projectId, modelIds, current)
      if (detail !== null) {
        const key = `${r.method} ${pathOf(r.url)}`
        if (!this.reported.has(key)) {
          this.reported.add(key)
          out.push({ step, invariant: 'cross-project-request', detail: `${detail}: ${r.method} ${r.url}` })
        }
        continue
      }
      // Consistent traffic teaches ownership (only a request under the open
      // project's own path, so a stale request never teaches a wrong owner).
      if (current !== null && projectId === current) this.registerModels(projectId, modelIds)
    }
    return out
  }

  /** The violation text for one request, or null when it is consistent. */
  private violation(projectId: string, modelIds: readonly string[], current: string): string | null {
    for (const m of modelIds) {
      const owner = this.modelOwner.get(m)
      if (owner !== undefined && owner !== projectId) {
        return `model ${m} (first seen under project ${owner}) requested under project ${projectId}`
      }
    }
    if (projectId !== current && this.knownProjects.has(projectId)) {
      return `request for project ${projectId} while project ${current} is open`
    }
    return null
  }
}
