/**
 * The main log: ``backend.log`` under the app's logs directory.
 *
 * One code path for both build kinds. Every ``[boot]`` / ``[main]`` / ``[api]``
 * / ``[api:err]`` line, and in dev the forwarded renderer ``[ui ...]`` lines,
 * go through {@link MainLog.write}:
 *
 * * **Packaged** - the file only. Backend stdout carries the DSN with this
 *   install's generated password, so it is never echoed anywhere a user can
 *   read it casually (debt #200 F5). The crash bundle redacts the tail when it
 *   copies it (``crashBundle.readRedactedLogTail``).
 * * **Dev** - the file AND the terminal. The owner reads the terminal while he
 *   works and opens the file when he reports a bug (owner 2026-10-05: "isn't it
 *   easier to log the backend to file man, i'm sick of copy pasting").
 *
 * Writes are synchronous on purpose: a buffered stream lost every line of the
 * first packaged boot failure, because the process died with the buffer full.
 *
 * @module main/mainLog
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { BACKEND_LOG_FILENAME } from './crashBundle'
import { createRotatingAppender, realFsOps, rotateIfNeeded, type FsOps } from './logRotation'

/** File name of the main log, shared with the crash bundle that reads it. */
export const MAIN_LOG_FILENAME = BACKEND_LOG_FILENAME

/** #214c - rotate past 5 MB, keep 3 backup generations. */
export const MAIN_LOG_MAX_BYTES = 5 * 1024 * 1024
/** #214c - number of rotated generations kept next to the active file. */
export const MAIN_LOG_MAX_FILES = 3

/** The console severities a main-log line can be echoed with. */
export type ConsoleMethod = 'log' | 'warn' | 'error'

/** The console surface the main log echoes to (injectable for tests). */
export type ConsoleLike = Pick<Console, ConsoleMethod>

/** Options for {@link createMainLog}. */
export interface MainLogOptions {
  /** Echo every line to the console too. True in dev, false in packaged. */
  echoToConsole: boolean
  /** Console to echo to; defaults to the global ``console``. */
  console?: ConsoleLike
  /** Rotation threshold in bytes; defaults to {@link MAIN_LOG_MAX_BYTES}. */
  maxBytes?: number
  /** Backup generations; defaults to {@link MAIN_LOG_MAX_FILES}. */
  maxFiles?: number
  /** Filesystem read-ops for rotation; defaults to the real fs. */
  fs?: FsOps
}

/** The main log handle. */
export interface MainLog {
  /** Absolute path of the open file, or null before {@link MainLog.open}. */
  readonly path: string | null
  /**
   * Open (or re-use) ``backend.log`` in ``logsDir``, rotating it first when the
   * last launch left it over the cap. Idempotent: a second call keeps the file
   * already open.
   *
   * @param logsDir - The app's logs directory (``app.getPath('logs')``).
   * @returns The absolute path of the log file.
   */
  open(logsDir: string): string
  /**
   * Write one line. Bound, so it can be handed around as a plain function.
   *
   * Before {@link MainLog.open} the line goes to the console only, so nothing
   * written early is lost. A failing file write or a dead terminal is swallowed:
   * a log line must never be the thing that takes the app down.
   *
   * @param line - The line for the file, without a trailing newline.
   * @param method - Console severity for the echo. Defaults to ``'log'``.
   * @param consoleLine - Text for the echo when it differs from the file line.
   */
  write(line: string, method?: ConsoleMethod, consoleLine?: string): void
}

/**
 * Build the main log. Nothing touches the disk until {@link MainLog.open}.
 *
 * @param options - Echo switch plus injectable console / rotation settings.
 * @returns The main log handle.
 */
export function createMainLog(options: MainLogOptions): MainLog {
  const out = options.console ?? console
  const maxBytes = options.maxBytes ?? MAIN_LOG_MAX_BYTES
  const maxFiles = options.maxFiles ?? MAIN_LOG_MAX_FILES
  let path: string | null = null
  let append: ((line: string) => void) | null = null

  function echo(method: ConsoleMethod, text: string): void {
    try {
      // eslint-disable-next-line no-console
      out[method](text)
    } catch {
      // A closed terminal (EPIPE) must not lose the line or crash the caller;
      // the uncaught-exception policy owns the broken-pipe latch.
    }
  }

  const log: MainLog = {
    get path(): string | null {
      return path
    },
    open(logsDir: string): string {
      if (path !== null) return path
      mkdirSync(logsDir, { recursive: true })
      const logPath = join(logsDir, MAIN_LOG_FILENAME)
      const fs = options.fs ?? realFsOps()
      // Launch-time rotation: a stale over-cap file from the previous run rolls
      // to .1 before the first line lands.
      rotateIfNeeded(logPath, maxBytes, maxFiles, fs)
      // Mid-session rotation (M8/L1): the appender re-checks the size every N
      // bytes, so a long verbose session cannot grow the file without bound.
      append = createRotatingAppender(logPath, maxBytes, maxFiles, {
        fs,
        append: (p, text) => appendFileSync(p, text),
      })
      path = logPath
      return logPath
    },
    write(line: string, method: ConsoleMethod = 'log', consoleLine: string = line): void {
      if (append === null) {
        echo(method, consoleLine)
        return
      }
      try {
        append(line)
      } catch {
        // A log write must never be the thing that takes the app down.
      }
      if (options.echoToConsole) echo(method, consoleLine)
    },
  }
  return log
}

/** Options for {@link bootMainLog}. */
export interface BootMainLogOptions {
  /** ``app.isPackaged``. */
  packaged: boolean
  /** ``app.getPath('logs')``. */
  logsDir: string
  /** The main log to open. */
  log: MainLog
}

/**
 * Open the main log at boot in dev and say where it is.
 *
 * Packaged builds keep their own opening points (the profile relocation and the
 * embedded-database boot open it, so their stage lines land in order); this is
 * a no-op there. A dev launch has none of those stages, so the log opens here,
 * before the first ``[boot]`` line, and the path is printed once as
 * ``[boot] main log: <path>``.
 *
 * @param options - Packaging flag, logs directory and the log to open.
 */
export function bootMainLog(options: BootMainLogOptions): void {
  if (options.packaged) return
  try {
    const path = options.log.open(options.logsDir)
    options.log.write(`[boot] main log: ${path}`)
  } catch (err) {
    // An unwritable logs dir must not stop a dev launch; the console still works.
    options.log.write(
      `[boot] main log could not be opened in ${options.logsDir}: ${err instanceof Error ? err.message : String(err)}`,
      'warn',
    )
  }
}

/** The part of a ChildProcess {@link pipeBackendOutput} reads. */
export interface BackendOutputSource {
  stdout?: NodeJS.ReadableStream | null
  stderr?: NodeJS.ReadableStream | null
}

/**
 * Route the backend's stdout / stderr into the main log.
 *
 * The file tags stderr ``[api:err]`` so a support reader can tell the streams
 * apart; the terminal echo keeps the plain ``[api]`` tag it always had (uvicorn
 * logs to stderr, so ``[api:err]`` on every INFO line would only be noise
 * there). One chunk is one line entry, as before: a multi-line traceback stays
 * together under one tag.
 *
 * @param child - The spawned backend process.
 * @param log - The main log.
 */
export function pipeBackendOutput(child: BackendOutputSource, log: MainLog): void {
  child.stdout?.on('data', (d: Buffer | string) => {
    const text = d.toString().trimEnd()
    log.write(`[api] ${text}`, 'log')
  })
  child.stderr?.on('data', (d: Buffer | string) => {
    const text = d.toString().trimEnd()
    log.write(`[api:err] ${text}`, 'error', `[api] ${text}`)
  })
}
