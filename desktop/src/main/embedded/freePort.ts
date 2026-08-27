/**
 * Free-TCP-port acquisition for the embedded stack.
 *
 * The packaged app cannot hardcode a port. ``5433`` is the single most likely
 * first-run failure on a machine that already runs Postgres (a coworker with
 * their own Docker stack is exactly the target user), and the failure is
 * invisible: the app connects to SOMEBODY ELSE'S database.
 *
 * The strategy is the standard one — bind ``:0``, let the OS pick, read the
 * port back, close. That leaves a race: the port is free again between the
 * close and the real bind, and two probes in the same launch can return the
 * same number. The retry-against-a-claimed-set here closes the self-collision
 * half, which is the half that is deterministic and therefore worth code.
 *
 * @module main/embedded/freePort
 */

import { createServer } from 'net'

/** How many times to ask the OS before giving up. */
const DEFAULT_ATTEMPTS = 10

/**
 * Ask for a port the OS considers free and that this launch has not claimed.
 *
 * @param probe - Returns a port the OS says is currently free. Injected so the
 *   retry logic is testable without binding real sockets.
 * @param taken - Ports already claimed by this launch. A probe result inside
 *   this set is rejected and retried.
 * @param attempts - Probe budget. Defaults to {@link DEFAULT_ATTEMPTS}.
 * @returns The accepted port.
 * @throws Error If the budget is spent without an acceptable port, or if the
 *   probe itself fails — a probe failure is surfaced immediately rather than
 *   retried, because "cannot bind a socket at all" does not improve on the
 *   second try and the real error is more useful than a budget-exhausted one.
 */
export async function acquireFreePort(
  probe: () => Promise<number>,
  taken: ReadonlySet<number>,
  attempts: number = DEFAULT_ATTEMPTS,
): Promise<number> {
  for (let i = 0; i < attempts; i += 1) {
    const port = await probe()
    if (!taken.has(port)) return port
  }
  throw new Error(
    `could not find a free TCP port in ${attempts} attempts ` +
      `(ports already claimed this launch: ${[...taken].join(', ')})`,
  )
}

/**
 * Bind an ephemeral port on the loopback interface and report which one.
 *
 * @returns The port the OS assigned, already released.
 * @throws Error If the socket cannot be bound or the OS reports no address.
 */
export function probeEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    // Loopback only — matching where Postgres and the backend actually listen,
    // so a machine whose firewall blocks external binds still succeeds here.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('the OS reported no port for the probe socket')))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
    })
  })
}
