/**
 * Ordering pins for the packaged boot coordinator.
 *
 * The rule, in its own words (owner report, installer #13 cold start): the
 * engine is spawned CONCURRENTLY with the embedded Postgres boot; the engine's
 * ~48 s cold import must overlap the DB coming up, not run serially after it,
 * and the boot does NOT wait for a separate migrate step (the engine migrates
 * itself, in-process).
 */

import { describe, it, expect } from 'vitest'
import { coordinatePackagedBoot } from './packagedBootCoordinator'
import type { BootFailure } from './bootSequence'

/** A minimal prepared-stack stand-in — the coordinator only threads it through. */
interface FakePrep {
  port: number
}

describe('coordinatePackagedBoot', () => {
  it('spawns the engine before await-postgres-ready resolves (concurrent DB boot)', async () => {
    const order: string[] = []
    let resolveReady!: () => void
    // The cluster-boot promise stands in for init-cluster → start-postgres →
    // await-postgres-ready; it resolves only when the test says the server is up.
    const clusterReady = new Promise<void>(resolve => {
      resolveReady = () => {
        order.push('postgres-ready')
        resolve()
      }
    })

    const outcome = await coordinatePackagedBoot<FakePrep>({
      prepare: async () => ({ ok: true, prep: { port: 55123 } }),
      onPrepared: () => order.push('prepared'),
      startCluster: () => clusterReady,
      spawnEngine: () => order.push('engine-spawn'),
    })

    // The engine is already spawned while the database is still coming up.
    expect(outcome.ok).toBe(true)
    expect(order).toEqual(['prepared', 'engine-spawn'])
    expect(order).not.toContain('postgres-ready')

    resolveReady()
    await outcome.clusterReady
    expect(order).toEqual(['prepared', 'engine-spawn', 'postgres-ready'])
  })

  it('runs no separate migrate step between prepare and the engine spawn', async () => {
    // The migration is the engine's job now — nothing (no migrate.py child)
    // runs between preparing the stack and spawning the engine.
    const order: string[] = []
    await coordinatePackagedBoot<FakePrep>({
      prepare: async () => ({ ok: true, prep: { port: 1 } }),
      onPrepared: () => order.push('prepared'),
      startCluster: () => {
        order.push('cluster-begin')
        return new Promise<void>(() => {}) // never resolves — proves it is not awaited
      },
      spawnEngine: () => order.push('engine-spawn'),
    })

    expect(order).toEqual(['prepared', 'cluster-begin', 'engine-spawn'])
  })

  it('reports a prepare failure without booting the cluster or the engine', async () => {
    const order: string[] = []
    const failure: BootFailure = {
      stage: 'resolve-paths',
      summary: 'StrixGeo could not find its own bundled files.',
      message: 'the database server is missing',
      log: '[boot] resolve-paths failed',
    }

    const outcome = await coordinatePackagedBoot<FakePrep>({
      prepare: async () => ({ ok: false, failure }),
      onPrepared: () => order.push('prepared'),
      startCluster: () => {
        order.push('cluster-begin')
        return Promise.resolve()
      },
      spawnEngine: () => order.push('engine-spawn'),
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.failure).toBe(failure)
    expect(order).toEqual([]) // nothing downstream of a failed prepare runs
  })
})
