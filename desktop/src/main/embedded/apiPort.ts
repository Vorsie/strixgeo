/**
 * Which loopback port the engine (the Python API) listens on.
 *
 * Dev and e2e pin ``8765``: the hand-started uvicorn, ``scripts/run-e2e.ps1`` and
 * every Playwright spec talk to it there. A PACKAGED app cannot pin it: another
 * program on the user's PC may own 8765 (AnkiConnect and several vendor tools
 * use it). Tester finding 2026-10-12: two starts in a row died with uvicorn's
 * ``[Errno 10048] error while attempting to bind on address ('127.0.0.1',
 * 8765)`` and the generic "could not start" dialog.
 *
 * So the packaged boot acquires the engine port the way it acquires the
 * Postgres port (./freePort): prefer 8765 when it is free (a familiar number in
 * logs and support), else the next free port of a small range above it, else a
 * port the OS assigns. The check-then-bind race is the same one the Postgres
 * port accepts; a lost race shows as the engine's bind failure, which the
 * failure dialog names (``port-busy``, ../backendFailureReason).
 *
 * @module main/embedded/apiPort
 */

import { connect, createServer } from 'net'

/** The engine port dev and e2e pin, and the one a packaged app prefers. */
export const DEFAULT_API_PORT = 8765

/** How many consecutive ports (from the preferred one) are tried before the OS picks. */
export const API_PORT_FALLBACK_SPAN = 10

/** The loopback host the engine binds and every client calls. */
const API_HOST = '127.0.0.1'

/**
 * How long the "does anything answer here" connect check waits. A loopback
 * connect is answered (accepted or refused) in well under a millisecond; the
 * bound only matters for a firewall that silently drops the SYN.
 */
const CONNECT_CHECK_TIMEOUT_MS = 500

/** How the engine port was chosen. */
export type ApiPortSource = 'preferred' | 'fallback' | 'os-assigned'

/** The chosen engine port and the candidates found busy before it. */
export interface ApiPortChoice {
  port: number
  source: ApiPortSource
  /** Candidate ports found busy (in the order tried), for the boot log. */
  busy: number[]
}

/**
 * The candidate ports, preferred first.
 *
 * @param preferred - The first port to try. Defaults to {@link DEFAULT_API_PORT}.
 * @param span - How many consecutive ports to try. Defaults to
 *   {@link API_PORT_FALLBACK_SPAN}.
 * @returns ``[preferred, preferred + 1, ...]``, ``span`` long.
 */
export function apiPortCandidates(
  preferred: number = DEFAULT_API_PORT,
  span: number = API_PORT_FALLBACK_SPAN,
): number[] {
  return Array.from({ length: span }, (_, i) => preferred + i)
}

/**
 * Choose the engine port: the first free candidate, else an OS-assigned one.
 *
 * @param deps.isFree - Whether nothing listens on a port and it can be bound.
 *   Injected so the policy is testable without real sockets.
 * @param deps.osAssigned - A port the OS reports free (../freePort probe).
 * @param deps.taken - Ports this launch already claimed (the Postgres port);
 *   never handed to the engine.
 * @param deps.candidates - The ports to try in order. Defaults to
 *   {@link apiPortCandidates}.
 * @returns The chosen port, how it was chosen, and the busy candidates.
 * @throws Error When the OS probe fails (no loopback socket can be bound at all).
 */
export async function chooseApiPort(deps: {
  isFree: (port: number) => Promise<boolean>
  osAssigned: () => Promise<number>
  taken: ReadonlySet<number>
  candidates?: number[]
}): Promise<ApiPortChoice> {
  const candidates = deps.candidates ?? apiPortCandidates()
  const busy: number[] = []
  for (const [index, port] of candidates.entries()) {
    if (!deps.taken.has(port) && (await deps.isFree(port))) {
      return { port, source: index === 0 ? 'preferred' : 'fallback', busy }
    }
    busy.push(port)
  }
  // Every candidate busy: let the OS pick. Re-ask when it hands back a port
  // this launch already claimed (the same self-collision ./freePort guards).
  for (let attempt = 0; attempt < API_PORT_FALLBACK_SPAN; attempt += 1) {
    const port = await deps.osAssigned()
    if (!deps.taken.has(port)) return { port, source: 'os-assigned', busy }
  }
  throw new Error(
    `could not find a free engine port (busy: ${busy.join(', ')}; ` +
      `OS-assigned ports already claimed: ${[...deps.taken].join(', ')})`,
  )
}

/**
 * The boot-log note for a choice.
 *
 * @param choice - The chosen port.
 * @returns e.g. ``port 8765 (preferred)`` / ``port 8767 (busy: 8765, 8766)``.
 */
export function describeApiPortChoice(choice: ApiPortChoice): string {
  const busy = `busy: ${choice.busy.join(', ')}`
  if (choice.source === 'preferred') return `port ${choice.port} (preferred)`
  if (choice.source === 'fallback') return `port ${choice.port} (${busy})`
  return `port ${choice.port} (OS-assigned; ${busy})`
}

/**
 * The loopback origin of the engine on a port.
 *
 * @param port - The engine port.
 * @returns ``http://127.0.0.1:<port>``.
 */
export function apiBaseUrl(port: number): string {
  return `http://${API_HOST}:${port}`
}

/**
 * Whether a loopback port is free for the engine.
 *
 * Two checks, because one is not enough on Windows: a program listening on
 * every interface (``0.0.0.0``) does not always stop a bind on ``127.0.0.1``
 * of the same port, yet it answers a connect to it. So a port counts as free
 * only when nothing accepts a connection there AND a bind on ``127.0.0.1``
 * succeeds (the exact address uvicorn binds).
 *
 * @param port - The port to check.
 * @returns True when the engine can take the port.
 */
export async function isLoopbackPortFree(port: number): Promise<boolean> {
  if (await somethingAccepts(port)) return false
  return canBind(port)
}

/** True when a TCP connect to ``127.0.0.1:<port>`` is accepted. */
function somethingAccepts(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ host: API_HOST, port })
    const done = (accepted: boolean): void => {
      socket.destroy()
      resolve(accepted)
    }
    socket.setTimeout(CONNECT_CHECK_TIMEOUT_MS, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/** True when ``127.0.0.1:<port>`` can be bound (then released at once). */
function canBind(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, API_HOST, () => server.close(() => resolve(true)))
  })
}
