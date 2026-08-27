import { describe, it, expect } from 'vitest'
import { acquireFreePort } from './freePort'

/** A probe that hands out the given ports in order, then repeats the last. */
function scriptedProbe(ports: number[]): () => Promise<number> {
  let i = 0
  return async () => ports[Math.min(i++, ports.length - 1)]
}

describe('acquireFreePort', () => {
  it('returns the first port the operating system offers', async () => {
    await expect(acquireFreePort(scriptedProbe([54121]), new Set())).resolves.toBe(54121)
  })

  // The probe binds :0, reads the port back and closes — so the port is free
  // again by the time the caller uses it, and two probes in one launch can
  // legitimately return the same number. Only Postgres takes a dynamic port
  // today (the backend's is still the fixed API_PORT), but the claimed-set is
  // what makes adding a second dynamic port safe rather than a race.
  it('rejects a port this launch already claimed and probes again', async () => {
    const port = await acquireFreePort(scriptedProbe([54121, 54122]), new Set([54121]))

    expect(port).toBe(54122)
  })

  it('gives up after the attempt budget rather than looping forever', async () => {
    await expect(
      acquireFreePort(scriptedProbe([54121]), new Set([54121]), 3),
    ).rejects.toThrow(/3 attempts/)
  })

  it('stops probing once the budget is spent', async () => {
    let calls = 0
    const probe = async (): Promise<number> => {
      calls += 1
      return 54121
    }

    await expect(acquireFreePort(probe, new Set([54121]), 3)).rejects.toThrow()
    expect(calls).toBe(3)
  })

  it('surfaces a probe failure instead of burning the whole budget on it', async () => {
    const probe = async (): Promise<number> => {
      throw new Error('EADDRINUSE')
    }

    await expect(acquireFreePort(probe, new Set())).rejects.toThrow(/EADDRINUSE/)
  })
})
