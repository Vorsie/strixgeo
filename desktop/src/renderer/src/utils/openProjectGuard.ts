// Once a project is closed, nothing of it runs any more (owner direction, PR #90
// and the deep walker run of 2026-10-16, seed 631210857).
//
// A user ACTION (File > Save, a section export, a 3-D build) captures the project
// id it was requested for and then awaits: a bundle fetch, a native save dialog,
// a correlation fetch, a payload computation. Closing the project and opening the
// next one does not stop those continuations, so they went on to POST, GET and
// write files for the closed project while the next one was open. React state
// cannot answer "is my project still open?" from inside such a continuation (the
// closure holds the render it started in), so the answer lives here: one
// module-level record of the open project, written by the project lifecycle
// owner (``useProject``) and read by every action at each checkpoint.
//
// WHY "untracked" counts as open: the record only means something once the
// lifecycle owner has reported. Code that runs without it (a unit test of an
// exporter, a stage rendered in isolation) must keep working exactly as before,
// so nothing is ever "closed" until ``reportOpenProject`` has been called.

import { log } from './log'

/** The open project's id; ``null`` = none open; ``undefined`` = not tracked. */
let openProjectId: string | null | undefined

/**
 * Record which project is open. Called by the project lifecycle owner on every
 * open, close, archive and Save-As switch, synchronously, so an action's next
 * checkpoint already sees the change.
 *
 * Parameters
 * ----------
 * projectId : string | null
 *     The project now open, or ``null`` when none is.
 */
export function reportOpenProject(projectId: string | null): void {
  openProjectId = projectId
}

/**
 * Forget the record (the lifecycle owner unmounted, or a test is resetting).
 * Afterwards nothing counts as closed until the next ``reportOpenProject``.
 */
export function resetOpenProjectGuard(): void {
  openProjectId = undefined
}

/**
 * Whether ``projectId`` is no longer the open project.
 *
 * Parameters
 * ----------
 * projectId : string
 *     The project an action was requested for.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the lifecycle owner reports a different project (or none)
 *     as open; ``false`` while it is open, or while nothing is tracked.
 */
export function isProjectClosed(projectId: string): boolean {
  return openProjectId !== undefined && openProjectId !== projectId
}

/**
 * The checkpoint every action runs after an await: stop when its project closed.
 *
 * Logs one INFO line ``<what> abandoned: project closed`` when it stops, so the
 * console says why an action the user started never finished.
 *
 * Parameters
 * ----------
 * projectId : string
 *     The project the action was requested for.
 * channel : string
 *     The log channel (``'project'``, ``'section'``, ...).
 * what : string
 *     The action, as the log line names it (``'save of Site A'``).
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the action must stop (and the line was logged).
 */
export function abandonIfProjectClosed(projectId: string, channel: string, what: string): boolean {
  if (!isProjectClosed(projectId)) return false
  log.info(channel, `${what} abandoned: project closed`)
  return true
}

/**
 * Raised by a multi-request assembly (the voxel / export partition builder) when
 * its project closed between two requests. Callers treat it as a silent stop,
 * never as a failure to show: the engineer closed the project on purpose.
 */
export class ProjectClosedError extends Error {
  /** The project the abandoned work belonged to. */
  readonly projectId: string

  /**
   * Parameters
   * ----------
   * projectId : string
   *     The closed project's id.
   * what : string
   *     The abandoned work, for the message.
   */
  constructor(projectId: string, what: string) {
    super(`${what} abandoned: project ${projectId} closed`)
    this.name = 'ProjectClosedError'
    this.projectId = projectId
  }
}

/**
 * Throw :class:`ProjectClosedError` when ``projectId`` is no longer open.
 *
 * Parameters
 * ----------
 * projectId : string
 *     The project the work was requested for.
 * what : string
 *     The work, for the message.
 *
 * Raises
 * ------
 * ProjectClosedError
 *     When the project closed.
 */
export function throwIfProjectClosed(projectId: string, what: string): void {
  if (isProjectClosed(projectId)) throw new ProjectClosedError(projectId, what)
}
