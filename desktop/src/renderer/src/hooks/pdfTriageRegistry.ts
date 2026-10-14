/**
 * One PDF report triage job + its SSE stream, shared by the PDF import dialogs.
 *
 * The CPT digitiser (``useCptPdfTriage``) and the borehole-log digitiser
 * (``useBoreholePdfTriage``) run the same user path (owner 2026-10-10: "the
 * same user path as the CPT one"): upload the report, follow its triage job,
 * show the digest. This module is that path once; each kind calls
 * {@link createPdfTriage} with its own client calls and gets its own registry.
 *
 * Lifecycle: ``idle`` → ``uploading`` (the report streams to the backend) →
 * ``running`` (each tick carries ``phase / done / total`` and may say ``ocr:
 * true``: OCR is the slow part, the dialog names it) → ``done`` (the digest)
 * or ``error``. A ``cancelled`` terminal event ends quietly in ``idle``.
 *
 * Spawn or attach: the backend keys a triage job on the project and the
 * report's SHA-256, so a second upload of a report whose triage still runs is
 * refused ``409`` naming the running job; that job IS this report's triage,
 * so the hook attaches to its stream instead of failing (owner's dogfeed
 * 2026-10-04). The normal path never meets it: the in-flight triage lives in
 * a module-level registry keyed on (project, report), not in the component
 * instance. A hook that starts a report already in the registry subscribes to
 * it and gets its last state replayed, with no upload. An unmount only
 * unsubscribes; the triage aborts one tick after its last subscriber leaves,
 * so a StrictMode remount joins the running triage instead of uploading the
 * report again.
 *
 * Follow-up job (owner 2026-10-14, "sondering wordt gelezen is traag"): a
 * digest may name a background job that goes on after the triage (the CPT
 * digitiser reads the graph sheets of its printed-table soundings). The
 * entry then follows that job's stream too, under the same abort controller,
 * and republishes the ``done`` state with the SAME digest object plus
 * ``followUp`` (how far it is, which keys are ready). Closing the dialog
 * aborts it like the triage, which stops the job on the backend.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { messageForApiCode, messageForDetail } from '../api/clients/apiCodeMessages'
import { runningTriageJobId } from '../api/clients/cptPdf'
import { log } from '../utils/log'
import { readSseEvents } from '../utils/sseEvents'

/** The triage's two phases, in order. */
export type PdfTriagePhase = 'classify' | 'digitise'

/** Where the background job that follows a triage stands. */
export interface PdfFollowUpState {
  status: 'running' | 'done' | 'cancelled' | 'error'
  done: number
  total: number
  /** The keys the job finished (a tick's ``key``), in order. */
  ready: string[]
}

/** Where a triage stands; ``D`` is the digest the dialog lists. */
export type PdfTriageState<D> =
  | { status: 'idle' }
  | { status: 'uploading' }
  | {
      status: 'running'
      phase: PdfTriagePhase | null
      done: number
      total: number
      /** True while OCR is what the triage is doing (absent on older backends). */
      ocr?: boolean
    }
  | {
      status: 'done'
      digest: D
      /** The background job the digest named, while and after it runs. */
      followUp?: PdfFollowUpState
    }
  | { status: 'error'; message: string }

/** What a triage hook returns. */
export interface UsePdfTriageResult<D> {
  state: PdfTriageState<D>
  /** Upload ``filePath`` into ``projectId`` and triage it. */
  start: (filePath: string, projectId: string) => void
  /** Abort a running triage and go back to idle. */
  reset: () => void
}

/** The calls and words one kind of PDF import brings. */
export interface PdfTriageConfig<D> {
  /** The ``log`` module tag (``cpt-pdf``, ``borehole-pdf``). */
  tag: string
  /** Upload the report and spawn its triage job. Called lazily (tests spy). */
  startTriage: (filePath: string, projectId: string) => Promise<{ job_id: string }>
  /** URL of a job's SSE progress stream. */
  streamUrl: (jobId: string) => string
  /** One log line for a finished digest. */
  describe: (digest: D) => string
  /** The background job a digest names to follow after the triage, if any. */
  followUpJobId?: (digest: D) => string | null | undefined
}

/** One (project, report) triage that one or more hooks follow. */
interface TriageEntry<D> {
  key: string
  controller: AbortController
  subscribers: Set<(state: PdfTriageState<D>) => void>
  /** The newest state, replayed to a hook that joins late. */
  lastState: PdfTriageState<D>
  /** The pending abort scheduled when the last subscriber left. */
  abortTimer: ReturnType<typeof setTimeout> | null
}

/**
 * Build the triage hook of one kind of PDF import, with its own registry.
 *
 * @param config - The kind's client calls, log tag and digest summary.
 * @returns ``useTriage`` (the hook) and ``clearRegistry`` (test-only: abort
 *   every registered triage and empty the registry).
 */
export function createPdfTriage<D>(config: PdfTriageConfig<D>): {
  useTriage: () => UsePdfTriageResult<D>
  clearRegistry: () => void
} {
  const { tag } = config
  // The in-flight triages, keyed ``${projectId}|${filePath}``. Module-level on
  // purpose (one per kind): a component instance's refs die with an unmount,
  // and a StrictMode remount must find the triage the first mount started.
  const registry = new Map<string, TriageEntry<D>>()

  async function drainStream(
    jobId: string,
    signal: AbortSignal,
    onProgress: (state: PdfTriageState<D>) => void,
  ): Promise<PdfTriageState<D>> {
    onProgress({ status: 'running', phase: null, done: 0, total: 0 })
    const res = await fetch(config.streamUrl(jobId), { signal })
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}))
      const msg = messageForDetail((body as { detail?: unknown }).detail, `HTTP ${res.status}`)
      log.error(tag, `triage stream for job ${jobId} failed: ${msg}`)
      return { status: 'error', message: msg }
    }
    for await (const event of readSseEvents(res.body, raw => log.warn(tag, `unparseable SSE frame: ${raw}`))) {
      if (event.type === 'done') {
        const digest = event.result as D
        log.success(tag, `triage done: ${config.describe(digest)}`)
        return { status: 'done', digest }
      }
      if (event.type === 'cancelled') {
        log.info(tag, `triage job ${jobId} cancelled`)
        return { status: 'idle' }
      }
      if (event.type === 'error') {
        const msg =
          messageForApiCode(event.code as string | undefined) ??
          (event.message as string | undefined) ??
          'Triage failed'
        log.error(tag, `triage error: ${msg}`)
        return { status: 'error', message: msg }
      }
      if (typeof event.phase === 'string') {
        onProgress({
          status: 'running',
          phase: event.phase as PdfTriagePhase,
          done: (event.done as number) ?? 0,
          total: (event.total as number) ?? 0,
          ocr: event.ocr === true,
        })
      }
    }
    log.warn(tag, `triage stream for job ${jobId} closed without a terminal event`)
    return { status: 'error', message: 'Triage stream closed unexpectedly' }
  }

  async function spawnOrAttach(filePath: string, projectId: string): Promise<string> {
    try {
      const { job_id } = await config.startTriage(filePath, projectId)
      log.info(tag, `triage job ${job_id} spawned`)
      return job_id
    } catch (err) {
      const running = runningTriageJobId(err)
      if (running === null) throw err
      log.info(tag, `triage already running as job ${running}, attaching`)
      return running
    }
  }

  // Follow the background job a digest named: republish ``done`` with the
  // same digest and the job's progress. Never turns the triage into an error.
  async function drainFollowUp(
    jobId: string,
    digest: D,
    signal: AbortSignal,
    publish: (state: PdfTriageState<D>) => void,
  ): Promise<void> {
    let followUp: PdfFollowUpState = { status: 'running', done: 0, total: 0, ready: [] }
    const emit = (next: PdfFollowUpState): void => {
      followUp = next
      publish({ status: 'done', digest, followUp })
    }
    emit(followUp)
    try {
      const res = await fetch(config.streamUrl(jobId), { signal })
      if (!res.ok || !res.body) {
        log.warn(tag, `follow-up job ${jobId} stream failed: HTTP ${res.status}`)
        emit({ ...followUp, status: 'error' })
        return
      }
      for await (const event of readSseEvents(res.body, raw => log.warn(tag, `unparseable SSE frame: ${raw}`))) {
        if (event.type === 'done') {
          log.success(tag, `follow-up job ${jobId} done: ${followUp.ready.length} ready`)
          emit({ ...followUp, status: 'done' })
          return
        }
        if (event.type === 'cancelled' || event.type === 'error') {
          log.info(tag, `follow-up job ${jobId} ended ${event.type}: ${String(event.message ?? '')}`)
          emit({ ...followUp, status: event.type === 'cancelled' ? 'cancelled' : 'error' })
          return
        }
        if (typeof event.phase === 'string') {
          const key = typeof event.key === 'string' ? event.key : null
          emit({
            status: 'running',
            done: (event.done as number) ?? 0,
            total: (event.total as number) ?? 0,
            ready: key !== null && !followUp.ready.includes(key) ? [...followUp.ready, key] : followUp.ready,
          })
        }
      }
      log.warn(tag, `follow-up job ${jobId} stream closed without a terminal event`)
      emit({ ...followUp, status: 'error' })
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        log.info(tag, `follow-up job ${jobId} stream aborted by client`)
        return
      }
      log.warn(tag, `follow-up job ${jobId} failed: ${err instanceof Error ? err.message : String(err)}`)
      emit({ ...followUp, status: 'error' })
    }
  }

  function abortEntry(entry: TriageEntry<D>): void {
    if (entry.abortTimer !== null) clearTimeout(entry.abortTimer)
    entry.abortTimer = null
    entry.controller.abort()
    if (registry.get(entry.key) === entry) registry.delete(entry.key)
  }

  // Remove one subscriber; with none left, abort after the tick. The delay
  // lets a same-tick remount (StrictMode) take the triage over.
  function unsubscribe(entry: TriageEntry<D>, listener: (state: PdfTriageState<D>) => void): void {
    entry.subscribers.delete(listener)
    if (entry.subscribers.size > 0 || entry.abortTimer !== null) return
    entry.abortTimer = setTimeout(() => {
      entry.abortTimer = null
      if (entry.subscribers.size > 0) return
      if (!entry.controller.signal.aborted) log.info(tag, 'triage left by every view; aborting')
      abortEntry(entry)
    }, 0)
  }

  function subscribe(entry: TriageEntry<D>, listener: (state: PdfTriageState<D>) => void): void {
    if (entry.abortTimer !== null) {
      clearTimeout(entry.abortTimer)
      entry.abortTimer = null
    }
    entry.subscribers.add(listener)
    listener(entry.lastState)
  }

  function launch(key: string, filePath: string, projectId: string): TriageEntry<D> {
    const controller = new AbortController()
    const entry: TriageEntry<D> = {
      key,
      controller,
      subscribers: new Set(),
      lastState: { status: 'uploading' },
      abortTimer: null,
    }
    registry.set(key, entry)
    // Only a live triage may publish: an aborted one stays silent.
    const publish = (next: PdfTriageState<D>): void => {
      if (controller.signal.aborted) return
      entry.lastState = next
      for (const listener of entry.subscribers) listener(next)
    }
    void (async () => {
      try {
        const jobId = await spawnOrAttach(filePath, projectId)
        if (controller.signal.aborted) {
          log.debug(tag, `triage job ${jobId} superseded before its stream opened`)
          return
        }
        const final = await drainStream(jobId, controller.signal, publish)
        publish(final)
        const followUpId = final.status === 'done' ? config.followUpJobId?.(final.digest) : null
        if (final.status === 'done' && followUpId && !controller.signal.aborted) {
          log.info(tag, `following job ${followUpId} after the triage`)
          await drainFollowUp(followUpId, final.digest, controller.signal, publish)
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          log.info(tag, 'triage stream aborted by client')
          return
        }
        const msg = err instanceof Error ? err.message : 'Unknown triage error'
        log.error(tag, `triage failed: ${msg}`, err)
        publish({ status: 'error', message: msg })
      }
    })()
    return entry
  }

  function clearRegistry(): void {
    for (const entry of [...registry.values()]) abortEntry(entry)
    registry.clear()
  }

  function useTriage(): UsePdfTriageResult<D> {
    const [state, setState] = useState<PdfTriageState<D>>({ status: 'idle' })
    // The triage this hook follows, and the listener it subscribed with.
    const followRef = useRef<{
      entry: TriageEntry<D>
      listener: (s: PdfTriageState<D>) => void
    } | null>(null)

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

    const start = useCallback((filePath: string, projectId: string) => {
      const key = `${projectId}|${filePath}`
      const current = followRef.current
      if (current && current.entry.key === key && registry.get(key) === current.entry) {
        log.debug(tag, `triage of ${filePath} already followed; start ignored`)
        return
      }
      if (current) {
        // A different report supersedes the old one; with no other view on
        // it, the old stream aborts at once.
        followRef.current = null
        current.entry.subscribers.delete(current.listener)
        if (current.entry.subscribers.size === 0) abortEntry(current.entry)
      }
      const listener = (next: PdfTriageState<D>): void => setState(next)
      const existing = registry.get(key)
      if (existing) {
        log.info(tag, `triage of ${filePath} already in flight; joining it`)
        followRef.current = { entry: existing, listener }
        subscribe(existing, listener)
        return
      }
      const entry = launch(key, filePath, projectId)
      followRef.current = { entry, listener }
      subscribe(entry, listener)
    }, [])

    return { state, start, reset }
  }

  return { useTriage, clearRegistry }
}
