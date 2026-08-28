/**
 * What the main process should DO about an uncaught error.
 *
 * The crash handler in ``index.ts`` used to treat every uncaught error the same
 * way: log it, show a blocking ``dialog.showErrorBox``, exit 1. That is right
 * for a programming error and wrong for a dead output pipe.
 *
 * A broken pipe means whoever was READING our stdout/stderr went away — a
 * terminal that closed, a parent process that exited, a test harness that killed
 * the app. Our own state is untouched. Turning that into a modal the user has to
 * dismiss (2026-08-28: ten of them stacked on the owner's desktop, one per
 * orphaned Electron instance) tells them something is broken when nothing is,
 * and exiting throws away whatever they were doing. It reaches real users too:
 * a packaged app started from a terminal the user then closes takes the same
 * path.
 *
 * Kept as a pure module so the POLICY is testable without booting Electron —
 * ``index.ts`` only wires it up.
 */

/** What the crash handler should do with an error. */
export type CrashAction = 'ignore-broken-pipe' | 'fatal'

/**
 * Error codes that mean "the far end of our output is gone".
 *
 * ``EPIPE`` — the classic broken pipe. ``ERR_STREAM_DESTROYED`` — Node's own
 * code when the stream object was torn down under us. ``EIO`` — what a dying
 * tty raises instead on some platforms.
 */
const BROKEN_PIPE_CODES = new Set(['EPIPE', 'ERR_STREAM_DESTROYED', 'EIO'])

/**
 * Syscalls that mean the failure was an OUTPUT write.
 *
 * A bare ``EPIPE`` is not automatically the console dying — a socket we own can
 * raise it too, and that IS a fault worth surfacing. Node leaves ``syscall``
 * undefined on stream-level errors, so an absent syscall counts as a write;
 * anything else named must be a write to qualify.
 */
const OUTPUT_SYSCALLS = new Set(['write', 'writev'])

/**
 * Is this error a dead stdout/stderr rather than an application fault?
 *
 * Parameters
 * ----------
 * err
 *     The value passed to the ``uncaughtException`` handler — anything at all,
 *     since a thrown non-Error is legal JavaScript.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` only for a write failure against a pipe nobody is reading.
 */
export function isBrokenPipe(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const { code, syscall } = err as NodeJS.ErrnoException
  if (typeof code !== 'string' || !BROKEN_PIPE_CODES.has(code)) return false
  return syscall === undefined || OUTPUT_SYSCALLS.has(syscall)
}

/**
 * The action the main-process crash handler should take.
 *
 * Everything that is not provably a dead output pipe stays ``fatal`` — an
 * unclassifiable value is never swallowed, because silently surviving a real
 * corruption is worse than an unnecessary exit.
 *
 * Parameters
 * ----------
 * err
 *     The uncaught value.
 *
 * Returns
 * -------
 * CrashAction
 *     ``'ignore-broken-pipe'`` to log and carry on, ``'fatal'`` to warn and exit.
 */
export function crashActionFor(err: unknown): CrashAction {
  return isBrokenPipe(err) ? 'ignore-broken-pipe' : 'fatal'
}
