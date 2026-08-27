/**
 * The packaged app's startup state machine — what ran, how long it took, and
 * where it stopped.
 *
 * In dev, "the backend is up" means Docker is already running Postgres on
 * :5433 and a human started the app. A packaged build has neither: it must
 * pick a free port, initialise a database cluster on first launch, start
 * ``postgres.exe``, migrate an empty schema to head, start the Python backend
 * and only then show the window. That is eight ordered steps that can each
 * fail, on a machine with no terminal, in front of someone who cannot read a
 * stack trace.
 *
 * So the sequence is recorded rather than merely executed. Two things fall out
 * of that and both are the point of this module:
 *
 *  * A failure names the STAGE, not just the error. "Startup failed while
 *    preparing the database" plus the underlying message is actionable;
 *    ``ENOENT`` on its own is not.
 *  * The successful path leaves a boot log — the per-stage timings are the
 *    only way to see that, say, first-run ``initdb`` costs 4 s while later
 *    launches cost 200 ms.
 *
 * Deliberately pure: no Electron, no fs, no child processes, injected clock.
 * The caller performs the work and reports the outcome here.
 *
 * @module main/embedded/bootSequence
 */

/** One ordered step of packaged startup. */
export type BootStage =
  /** Locate the bundled Postgres tree, the Python runtime and the data dir. */
  | 'resolve-paths'
  /** Read (or generate on first launch) this install's database password. */
  | 'load-secrets'
  /** Pick a TCP port nothing else is using. */
  | 'acquire-port'
  /** ``initdb`` — first launch only. */
  | 'init-cluster'
  /** Spawn ``postgres.exe`` against the data directory. */
  | 'start-postgres'
  /** Poll until the server accepts connections. */
  | 'await-postgres-ready'
  /** Create the database + PostGIS extension, then ``alembic upgrade head``. */
  | 'run-migrations'
  /** Spawn the bundled Python FastAPI backend. */
  | 'start-backend'
  /** Poll until the backend answers HTTP. */
  | 'await-backend-ready'

/** How a stage finished. */
export type BootStepStatus = 'ok' | 'skipped' | 'failed'

/** A completed stage, as it appears in the boot log. */
export interface BootStep {
  stage: BootStage
  status: BootStepStatus
  /** Wall-clock milliseconds spent in the stage. */
  ms: number
  /** Detail worth keeping — the chosen port, why a stage was skipped, the error. */
  note?: string
}

/** Everything the failure dialog and the log need about a failed boot. */
export interface BootFailure {
  stage: BootStage
  /** Plain-language sentence for the user — see {@link describeStage}. */
  summary: string
  /** The underlying technical message, for the log and the bug report. */
  message: string
  /** The full boot log up to and including the failure. */
  log: string
}

/**
 * Plain-language sentences, keyed by stage.
 *
 * These are read by a non-technical tester in a dialog, so they say what the
 * app was doing in ordinary words and never repeat the internal stage id — a
 * property the unit test pins, because it is exactly the kind of thing a
 * later "just use the key" tidy-up would quietly break.
 */
const STAGE_SENTENCES: Record<BootStage, string> = {
  'resolve-paths': 'StrixGeo could not find its own bundled files.',
  'load-secrets': 'StrixGeo could not read its own database credentials.',
  'acquire-port': 'StrixGeo could not reserve a network port on this machine.',
  'init-cluster': 'StrixGeo could not create its database storage.',
  'start-postgres': 'StrixGeo could not start its database.',
  'await-postgres-ready': 'The database started but never became reachable.',
  'run-migrations': 'StrixGeo could not prepare the database for use.',
  'start-backend': 'StrixGeo could not start its data service.',
  'await-backend-ready': 'The data service started but never became reachable.',
}

/**
 * Return the plain-language sentence for a stage.
 *
 * @param stage - The stage that failed.
 * @returns A complete sentence naming what the app was doing.
 */
export function describeStage(stage: BootStage): string {
  return STAGE_SENTENCES[stage]
}

/**
 * Records the ordered stages of packaged startup and renders the boot log.
 *
 * One instance per launch. Every method is synchronous and side-effect free;
 * the caller does the actual work and calls {@link succeed}, {@link skip} or
 * {@link fail} with the outcome.
 */
export class BootSequence {
  private readonly completed: BootStep[] = []

  /** The stage currently running, and when it started. */
  private open: { stage: BootStage; startedAt: number } | null = null

  private failure: BootFailure | null = null

  /**
   * @param now - Monotonic millisecond clock. Injected so durations are exact
   *   in tests; production passes ``Date.now``.
   */
  constructor(private readonly now: () => number = Date.now) {}

  /** The stages that have finished, in the order they ran. */
  get steps(): readonly BootStep[] {
    return this.completed
  }

  /** True once a stage has failed. */
  get failed(): boolean {
    return this.failure !== null
  }

  /**
   * Open a stage.
   *
   * @param stage - The stage about to run.
   * @throws Error If a previous stage was never closed — that means a code
   *   path returned without recording its outcome, and the boot log would
   *   silently lose a step.
   */
  begin(stage: BootStage): void {
    if (this.open) {
      throw new Error(
        `cannot begin '${stage}' — stage '${this.open.stage}' is still open`,
      )
    }
    this.open = { stage, startedAt: this.now() }
  }

  /**
   * Close the open stage as successful.
   *
   * @param note - Detail worth keeping in the log (the chosen port, the
   *   alembic revision, ...).
   * @throws Error If no stage is open.
   */
  succeed(note?: string): void {
    this.close('ok', note)
  }

  /**
   * Close the open stage as not-needed.
   *
   * Distinct from success on purpose: "cluster already initialised" and
   * "cluster initialised in 4 s" are different facts about the machine, and
   * only one of them explains a slow first launch.
   *
   * @param note - Why the stage was unnecessary.
   * @throws Error If no stage is open.
   */
  skip(note: string): void {
    this.close('skipped', note)
  }

  /**
   * Close the open stage as failed.
   *
   * @param message - The underlying technical error.
   * @returns The failure, carrying the user-facing sentence and the boot log.
   * @throws Error If no stage is open.
   */
  fail(message: string): BootFailure {
    const stage = this.requireOpen().stage
    this.close('failed', message)
    this.failure = {
      stage,
      summary: describeStage(stage),
      message,
      log: this.format(),
    }
    return this.failure
  }

  /**
   * Render the boot log — one line per stage plus a total.
   *
   * @returns A newline-separated log, safe to write to backend.log verbatim.
   */
  format(): string {
    const lines = this.completed.map(step => {
      const head = `[boot] ${step.stage.padEnd(20)} ${step.status.padEnd(8)} ${step.ms}ms`
      return step.note ? `${head} — ${step.note}` : head
    })
    const total = this.completed.reduce((sum, step) => sum + step.ms, 0)
    lines.push(`[boot] total ${total}ms`)
    return lines.join('\n')
  }

  /** Close the open stage with the given status. */
  private close(status: BootStepStatus, note?: string): void {
    const open = this.requireOpen()
    this.open = null
    this.completed.push({
      stage: open.stage,
      status,
      ms: this.now() - open.startedAt,
      ...(note === undefined ? {} : { note }),
    })
  }

  /** Return the open stage, or throw because the caller lost track of it. */
  private requireOpen(): { stage: BootStage; startedAt: number } {
    if (!this.open) throw new Error('no stage is open')
    return this.open
  }
}
