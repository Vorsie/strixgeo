/**
 * Run a PDF report's triage job and surface its progress.
 *
 * Lifecycle: ``idle`` → ``uploading`` (the report streams to the backend) →
 * ``running`` (classify every page, then digitise the offered sheets; each
 * tick carries ``phase / done / total``) → ``done`` (the digest the dialog
 * lists) or ``error``. Same job + SSE pattern as the DOV import
 * (``useDovImportStream``), through the shared ``readSseEvents`` reader.
 *
 * Spawn or attach: the backend keys a triage job on the project and the
 * report's SHA-256, so a second upload of a report whose triage still runs is
 * refused ``409`` naming the running job. That job IS this report's triage, so
 * the hook attaches to its stream instead of failing (owner's dogfeed
 * 2026-10-04: a StrictMode double effect aborted the first stream and the
 * second upload's 409 left the dialog on "already running" with no list).
 * That 409 is the safety net for a genuine repeat (the user picks a report
 * whose triage still runs). The normal path never meets it: the in-flight
 * triage lives in a module-level registry keyed on (project, report), not in
 * the component instance. A hook that starts a report already in the registry
 * subscribes to it and gets its last state replayed, with no upload. An
 * unmount only unsubscribes; the triage aborts one tick after its last
 * subscriber leaves, so a StrictMode remount (mount, cleanup, mount in one
 * commit) joins the running triage instead of uploading the report again.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { messageForApiCode, messageForDetail } from '../api/clients/apiCodeMessages'
import { cptPdfClient, runningTriageJobId, type CptPdfDigest } from '../api/clients/cptPdf'
import { log } from '../utils/log'
import { readSseEvents } from '../utils/sseEvents'

/** The triage's two phases, in order. */
export type CptPdfTriagePhase = 'classify' | 'digitise'

/** Where the triage stands. */
export type CptPdfTriageState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'running'; phase: CptPdfTriagePhase | null; done: number; total: number }
  | { status: 'done'; digest: CptPdfDigest }
  | { status: 'error'; message: string }

/** What {@link useCptPdfTriage} returns. */
export interface UseCptPdfTriageResult {
  state: CptPdfTriageState
  /** Upload ``filePath`` into ``projectId`` and triage it. */
  start: (filePath: string, projectId: string) => void
  /** Abort a running triage and go back to idle. */
  reset: () => void
}

/**
 * Read one triage job's SSE stream to its terminal event.
 *
 * @param jobId - The triage job to follow.
 * @param signal - Aborts the stream (a superseded or reset triage).
 * @param onProgress - Called with every ``running`` tick.
 * @returns The terminal state: ``done`` with the digest, or ``error``.
 * @throws AbortError when ``signal`` aborts; any network failure.
 */
async function drainTriageStream(
  jobId: string,
  signal: AbortSignal,
  onProgress: (state: CptPdfTriageState) => void,
): Promise<CptPdfTriageState> {
  onProgress({ status: 'running', phase: null, done: 0, total: 0 })
  const res = await fetch(cptPdfClient.streamUrl(jobId), { signal })
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}))
    const msg = messageForDetail((body as { detail?: unknown }).detail, `HTTP ${res.status}`)
    log.error('cpt-pdf', `triage stream for job ${jobId} failed: ${msg}`)
    return { status: 'error', message: msg }
  }
  for await (const event of readSseEvents(res.body, raw =>
    log.warn('cpt-pdf', `unparseable SSE frame: ${raw}`),
  )) {
    if (event.type === 'done') {
      const digest = event.result as CptPdfDigest
      log.success(
        'cpt-pdf',
        `triage done: ${digest.campaign.length} campaign soundings, ${digest.dropped.length} set aside`,
      )
      return { status: 'done', digest }
    }
    if (event.type === 'error') {
      const msg =
        messageForApiCode(event.code as string | undefined) ??
        (event.message as string | undefined) ??
        'Triage failed'
      log.error('cpt-pdf', `triage error: ${msg}`)
      return { status: 'error', message: msg }
    }
    if (typeof event.phase === 'string') {
      onProgress({
        status: 'running',
        phase: event.phase as CptPdfTriagePhase,
        done: (event.done as number) ?? 0,
        total: (event.total as number) ?? 0,
      })
    }
  }
  log.warn('cpt-pdf', `triage stream for job ${jobId} closed without a terminal event`)
  return { status: 'error', message: 'Triage stream closed unexpectedly' }
}

/**
 * Spawn the report's triage job, or name the one already running for it.
 *
 * @param filePath - The report on disk.
 * @param projectId - The project the triage belongs to.
 * @returns The job id to follow.
 * @throws Any upload failure other than the 409 that names a running job.
 */
async function spawnOrAttachTriage(filePath: string, projectId: string): Promise<string> {
  try {
    const { job_id } = await cptPdfClient.startTriage(filePath, projectId)
    log.info('cpt-pdf', `triage job ${job_id} spawned`)
    return job_id
  } catch (err) {
    const running = runningTriageJobId(err)
    if (running === null) throw err
    log.info('cpt-pdf', `triage already running as job ${running}, attaching`)
    return running
  }
}

/** One (project, report) triage that one or more hooks follow. */
interface TriageEntry {
  key: string
  controller: AbortController
  subscribers: Set<(state: CptPdfTriageState) => void>
  /** The newest state, replayed to a hook that joins late. */
  lastState: CptPdfTriageState
  /** The pending abort scheduled when the last subscriber left. */
  abortTimer: ReturnType<typeof setTimeout> | null
}

// The in-flight triages, keyed ``${projectId}|${filePath}``. Module-level on
// purpose: a component instance's refs die with an unmount, and a StrictMode
// remount must find the triage the first mount started.
const triageRegistry = new Map<string, TriageEntry>()

/** Abort ``entry`` and drop it from the registry. */
function abortEntry(entry: TriageEntry): void {
  if (entry.abortTimer !== null) clearTimeout(entry.abortTimer)
  entry.abortTimer = null
  entry.controller.abort()
  if (triageRegistry.get(entry.key) === entry) triageRegistry.delete(entry.key)
}

/**
 * Remove one subscriber; with none left, abort the entry after the tick.
 *
 * The delay lets a same-tick remount (StrictMode) take over the triage: a
 * subscriber that arrives first cancels the pending abort.
 */
function unsubscribe(entry: TriageEntry, listener: (state: CptPdfTriageState) => void): void {
  entry.subscribers.delete(listener)
  if (entry.subscribers.size > 0 || entry.abortTimer !== null) return
  entry.abortTimer = setTimeout(() => {
    entry.abortTimer = null
    if (entry.subscribers.size > 0) return
    if (!entry.controller.signal.aborted) log.info('cpt-pdf', 'triage left by every view; aborting')
    abortEntry(entry)
  }, 0)
}

/** Add one subscriber, cancel a pending abort, replay the last state. */
function subscribe(entry: TriageEntry, listener: (state: CptPdfTriageState) => void): void {
  if (entry.abortTimer !== null) {
    clearTimeout(entry.abortTimer)
    entry.abortTimer = null
  }
  entry.subscribers.add(listener)
  listener(entry.lastState)
}

/** Create the entry for ``key`` and run its upload + stream drain. */
function launchTriage(key: string, filePath: string, projectId: string): TriageEntry {
  const controller = new AbortController()
  const entry: TriageEntry = {
    key,
    controller,
    subscribers: new Set(),
    lastState: { status: 'uploading' },
    abortTimer: null,
  }
  triageRegistry.set(key, entry)
  // Only a live triage may publish: an aborted one stays silent.
  const publish = (next: CptPdfTriageState): void => {
    if (controller.signal.aborted) return
    entry.lastState = next
    for (const listener of entry.subscribers) listener(next)
  }
  void (async () => {
    try {
      const jobId = await spawnOrAttachTriage(filePath, projectId)
      if (controller.signal.aborted) {
        log.debug('cpt-pdf', `triage job ${jobId} superseded before its stream opened`)
        return
      }
      publish(await drainTriageStream(jobId, controller.signal, publish))
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        log.info('cpt-pdf', 'triage stream aborted by client')
        return
      }
      const msg = err instanceof Error ? err.message : 'Unknown triage error'
      log.error('cpt-pdf', `triage failed: ${msg}`, err)
      publish({ status: 'error', message: msg })
    }
  })()
  return entry
}

/**
 * Abort every registered triage and empty the registry. Test-only.
 */
export function _clearCptPdfTriageRegistry(): void {
  for (const entry of [...triageRegistry.values()]) abortEntry(entry)
  triageRegistry.clear()
}

/**
 * Manage one report triage.
 *
 * @returns ``{ state, start, reset }``.
 */
export function useCptPdfTriage(): UseCptPdfTriageResult {
  const [state, setState] = useState<CptPdfTriageState>({ status: 'idle' })
  // The triage this hook follows, and the listener it subscribed with.
  const followRef = useRef<{ entry: TriageEntry; listener: (s: CptPdfTriageState) => void } | null>(
    null,
  )

  const leave = useCallback((): void => {
    const follow = followRef.current
    followRef.current = null
    if (follow) unsubscribe(follow.entry, follow.listener)
  }, [])

  const reset = useCallback(() => {
    const follow = followRef.current
    followRef.current = null
    if (follow) {
      follow.entry.subscribers.delete(follow.listener)
      // An explicit user action: abort now, do not wait for the tick.
      abortEntry(follow.entry)
    }
    setState({ status: 'idle' })
  }, [])

  // An unmount only unsubscribes; the registry aborts the triage one tick
  // later unless a remount (StrictMode) has joined it by then.
  useEffect(() => leave, [leave])

  const start = useCallback(
    (filePath: string, projectId: string) => {
      const key = `${projectId}|${filePath}`
      const current = followRef.current
      if (current && current.entry.key === key && triageRegistry.get(key) === current.entry) {
        log.debug('cpt-pdf', `triage of ${filePath} already followed; start ignored`)
        return
      }
      if (current) {
        // A different report supersedes the old one; with no other view on it,
        // the old stream aborts at once.
        followRef.current = null
        current.entry.subscribers.delete(current.listener)
        if (current.entry.subscribers.size === 0) abortEntry(current.entry)
      }
      const listener = (next: CptPdfTriageState): void => setState(next)
      const existing = triageRegistry.get(key)
      if (existing) {
        log.info('cpt-pdf', `triage of ${filePath} already in flight; joining it`)
        followRef.current = { entry: existing, listener }
        subscribe(existing, listener)
        return
      }
      const entry = launchTriage(key, filePath, projectId)
      followRef.current = { entry, listener }
      subscribe(entry, listener)
    },
    [],
  )

  return { state, start, reset }
}
