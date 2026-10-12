/**
 * Name the program that owns a TCP port, best effort, for the main log.
 *
 * When the engine cannot bind its port, "another program owns it" is the
 * diagnosis and "which program" is the fix the user needs (tester finding
 * 2026-10-12: AnkiConnect and several vendor tools use 8765). Windows only:
 * ``netstat -ano -p TCP`` names the listening pid, ``tasklist`` its image.
 * Every failure (another OS, a missing tool, a timeout) answers ``null``;
 * this never blocks or fails the boot.
 *
 * The two parsers are pure and unit-tested; the process calls are not.
 *
 * @module main/portOwner
 */

import { spawn } from 'child_process'

/** Upper bound on each external command; the answer is a log nicety. */
const COMMAND_TIMEOUT_MS = 3_000

/**
 * The pids LISTENING on a port in ``netstat -ano`` output.
 *
 * Counts a listener on any local address (``127.0.0.1``, ``0.0.0.0``, ``[::]``,
 * ``[::1]``): each of them blocks or shadows the engine's loopback bind.
 *
 * @param text - Raw ``netstat -ano`` output.
 * @param port - The port of interest.
 * @returns Distinct pids, in the order listed.
 */
export function parseNetstatListeners(text: string, port: number): number[] {
  const pids: number[] = []
  for (const line of text.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    // Proto  Local  Foreign  State  PID
    if (cols.length < 5 || cols[0].toUpperCase() !== 'TCP' || cols[3] !== 'LISTENING') continue
    const local = cols[1]
    if (local.slice(local.lastIndexOf(':') + 1) !== String(port)) continue
    const pid = Number(cols[4])
    if (Number.isInteger(pid) && !pids.includes(pid)) pids.push(pid)
  }
  return pids
}

/**
 * The image name in ``tasklist /FO CSV /NH`` output.
 *
 * @param text - Raw tasklist output for one pid.
 * @returns e.g. ``anki.exe``, or null when no task matched.
 */
export function parseTasklistImage(text: string): string | null {
  const match = /^"([^"]+)"/.exec(text.trim())
  return match ? match[1] : null
}

/**
 * Run a program (no shell; fixed arguments) and answer its stdout, or null on
 * any failure or after {@link COMMAND_TIMEOUT_MS}.
 */
function runProgram(program: string, args: string[]): Promise<string | null> {
  return new Promise(resolve => {
    let out = ''
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const child = spawn(program, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const timer = setTimeout(() => {
      child.kill()
      finish(null)
    }, COMMAND_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.once('error', () => finish(null))
    child.once('close', code => finish(code === 0 ? out : null))
  })
}

/**
 * Describe who listens on a port, e.g. ``pid 4242 (anki.exe)``.
 *
 * @param port - The port of interest.
 * @returns A short description, or null when unknown (non-Windows, no
 *   listener found, a command failed).
 */
export async function describePortOwner(port: number): Promise<string | null> {
  if (process.platform !== 'win32') return null
  const netstat = await runProgram('netstat', ['-ano', '-p', 'TCP'])
  if (netstat === null) return null
  const pids = parseNetstatListeners(netstat, port)
  if (pids.length === 0) return null
  const owners = await Promise.all(
    pids.map(async pid => {
      const listing = await runProgram('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
      const image = parseTasklistImage(listing ?? '')
      return image ? `pid ${pid} (${image})` : `pid ${pid}`
    }),
  )
  return owners.join(', ')
}
