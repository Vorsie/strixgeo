/**
 * Renderer console → main-process stdout, for development only.
 *
 * WHY this exists: when the owner reports a bug they paste their terminal,
 * which carries ``[api ...]`` (uvicorn) and ``[main ...]`` lines but NOT the
 * renderer's ``[ui ...]`` lines — those live in the DevTools console, a
 * separate window that has to be opened, scrolled and copied by hand. Half of
 * every UI bug report therefore arrived with the backend's side of the story
 * and none of the frontend's. Forwarding puts one ordered stream in the
 * terminal, so a paste shows the request and the click that caused it.
 *
 * NEVER in packaged builds. It is a debugging convenience with a real cost —
 * renderer output is untrusted text and a shipped app has no terminal to write
 * it to. The caller gates on ``!app.isPackaged``; this module keeps the pure
 * decisions so they can be tested without an Electron window.
 *
 * @module main/rendererConsoleForwarding
 */

/** Console severities Electron reports on ``console-message``. */
export type RendererConsoleLevel = 'debug' | 'info' | 'warning' | 'error'

/** The subset of Electron's console-message details this module needs. */
export interface RendererConsoleMessage {
  level: RendererConsoleLevel
  message: string
  sourceId: string
  lineNumber: number
}

/**
 * Source URLs whose console output is noise, not the app talking.
 *
 * DevTools logs into the page it is inspecting, so leaving it unfiltered means
 * opening DevTools starts a feedback loop of its own messages in the terminal.
 */
const IGNORED_SOURCE_PREFIXES = ['devtools://', 'chrome-extension://']

/**
 * Env var that opts this terminal in to the renderer's ``debug`` stream.
 *
 * Mirrors the renderer-side ``localStorage['strix.log.trace']`` switch: the
 * moment you want the detail is always after the interesting thing started
 * happening, so the switch stays cheap to flip — but the default is quiet.
 */
export const FORWARD_DEBUG_ENV_VAR = 'STRIX_FORWARD_RENDERER_DEBUG'

/**
 * Whether a renderer console message is worth putting in the terminal.
 *
 * Three filters: DevTools/extension chatter, empty lines, and a LEVEL FLOOR.
 * The floor matters because ``log.debug`` is used per-call across the api and
 * section clients — mirroring all of it into the terminal the owner pastes from
 * would re-create the flood that demoting the per-render line to ``trace`` was
 * meant to end. ``info`` / ``warning`` / ``error`` always pass: those are the
 * lines a bug report needs.
 *
 * Parameters
 * ----------
 * details : RendererConsoleMessage
 *     The message as Electron reported it.
 * env : Record<string, string | undefined>, optional
 *     Environment to read the debug opt-in from; defaults to ``process.env``.
 *     Injectable so the floor is testable without mutating the process.
 *
 * Returns
 * -------
 * boolean
 *     ``false`` for DevTools/extension chatter, empty messages, and unopted-in
 *     ``debug``; ``true`` for everything else the app itself logged.
 */
export function shouldForwardRendererMessage(
  details: RendererConsoleMessage,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (details.message.trim() === '') return false
  const source = details.sourceId ?? ''
  if (IGNORED_SOURCE_PREFIXES.some(prefix => source.startsWith(prefix))) return false
  if (details.level === 'debug' && env[FORWARD_DEBUG_ENV_VAR] !== '1') return false
  return true
}

/**
 * The exact line to write to the terminal for a renderer console message.
 *
 * Messages from ``utils/log`` already carry their own ``[ui <ts> <LEVEL>
 * <scope>]`` prefix, so re-prefixing them would double the tag and push the
 * useful text further right. Anything else — a React warning, a bare
 * ``console.log`` — is stamped ``[ui]`` so its origin is unambiguous next to
 * the ``[main]`` and ``[api]`` lines around it.
 *
 * Parameters
 * ----------
 * details : RendererConsoleMessage
 *     The message as Electron reported it.
 *
 * Returns
 * -------
 * string
 *     The formatted line, without a trailing newline.
 */
export function formatRendererMessage(details: RendererConsoleMessage): string {
  return details.message.startsWith('[ui ') ? details.message : `[ui] ${details.message}`
}

/**
 * Which ``console`` method a forwarded message should use.
 *
 * Keeping severity means a warning stays visible as a warning in the terminal
 * instead of flattening into the same stream as every render log.
 *
 * Parameters
 * ----------
 * level : RendererConsoleLevel
 *     Electron's reported severity.
 *
 * Returns
 * -------
 * 'log' | 'warn' | 'error'
 *     The console method name to call.
 */
export function consoleMethodForLevel(
  level: RendererConsoleLevel,
): 'log' | 'warn' | 'error' {
  if (level === 'error') return 'error'
  if (level === 'warning') return 'warn'
  return 'log'
}

/**
 * Forward one renderer console message to a line writer (the main log).
 *
 * Applies the filter, the ``[ui]`` stamp and the severity in one place, so the
 * caller in ``index.ts`` only wires the event to the writer. In dev the writer
 * is the main log, which puts the line in ``backend.log`` next to the ``[api]``
 * and ``[main]`` lines AND echoes it to the terminal.
 *
 * Parameters
 * ----------
 * details : RendererConsoleMessage
 *     The message as Electron reported it.
 * write : (line: string, method: 'log' | 'warn' | 'error') => void
 *     The line writer.
 * env : Record<string, string | undefined>, optional
 *     Environment for the debug opt-in; defaults to ``process.env``.
 */
export function forwardRendererMessage(
  details: RendererConsoleMessage,
  write: (line: string, method: 'log' | 'warn' | 'error') => void,
  env: Record<string, string | undefined> = process.env,
): void {
  if (!shouldForwardRendererMessage(details, env)) return
  write(formatRendererMessage(details), consoleMethodForLevel(details.level))
}
