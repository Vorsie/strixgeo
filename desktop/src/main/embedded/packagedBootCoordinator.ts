/**
 * Packaged startup ordering — spawn the engine CONCURRENTLY with the DB boot.
 *
 * A packaged cold first launch used to run three independent cold costs in
 * series (owner report, installer #13): ~60 s to boot the embedded Postgres,
 * then ~17 s for a separate ``migrate.py`` interpreter, then ~48 s for the
 * engine's own cold import. The engine import and the database boot are
 * independent, so this coordinator overlaps them: it prepares the stack (the
 * fast part — resolve paths, secrets, pick a port), kicks off the cluster boot
 * WITHOUT awaiting it, and — the moment the licence gate allows — spawns the
 * engine, whose cold import then runs while Postgres is still coming up. The
 * engine waits for + migrates the database itself (see ``api/boot_migration.py``),
 * so there is no separate migrate step here.
 *
 * Deliberately pure and injectable: no Electron, no fs, no child processes. The
 * caller wires the real ``prepareEmbeddedStack`` / ``startEmbeddedCluster`` /
 * ``startApi`` in, and this file only fixes the ORDER — which is the one thing
 * that is easy to get wrong and impossible to unit-test inside ``index.ts``.
 *
 * @module main/embedded/packagedBootCoordinator
 */

import type { BootFailure } from './bootSequence'

/** The result of the fast preparation phase — either a prepared stack or a failure. */
export type PreparedResult<Prep> = { ok: true; prep: Prep } | { ok: false; failure: BootFailure }

/** Everything the coordinator needs, injected so the ordering is unit-testable. */
export interface PackagedBootDeps<Prep> {
  /**
   * The fast phase: resolve paths, read/generate secrets, acquire a port, build
   * the backend env. Must NOT block on the database coming up.
   */
  prepare: () => Promise<PreparedResult<Prep>>
  /**
   * Called once ``prepare`` succeeds and BEFORE the engine is spawned, so the
   * caller can publish the prepared stack (the engine reads it, and a deferred
   * activation start needs it later).
   */
  onPrepared: (prep: Prep) => void
  /**
   * Kick off the cluster boot — init-cluster, start-postgres, await-postgres-ready.
   * The returned promise is NOT awaited before the engine is spawned; the caller
   * attaches its own success/failure handler.
   */
  startCluster: (prep: Prep) => Promise<void>
  /** Whether the licence gate permits the engine to start now (dev never blocks). */
  gateAllowsEngine: () => boolean
  /** Spawn the engine process (``startApi``). */
  spawnEngine: () => void
}

/** The coordinated outcome. */
export interface CoordinatedBoot<Prep> {
  ok: boolean
  /** Present only on a prepare failure — the caller shows the dialog and quits. */
  failure?: BootFailure
  /** The prepared stack, on success. */
  prep?: Prep
  /**
   * The cluster-boot promise (resolves at await-postgres-ready). The engine was
   * already spawned before this resolves.
   */
  clusterReady?: Promise<void>
  /** Whether the engine was spawned (false when the licence gate deferred it). */
  engineSpawned: boolean
}

/**
 * Prepare the stack, boot the database concurrently, and spawn the engine.
 *
 * @typeParam Prep - The prepared-stack shape the caller threads through.
 * @param deps - Injected phases (see {@link PackagedBootDeps}).
 * @returns The prepared stack + the still-pending cluster-boot promise, or the
 *   prepare failure.
 */
export async function coordinatePackagedBoot<Prep>(
  deps: PackagedBootDeps<Prep>,
): Promise<CoordinatedBoot<Prep>> {
  const prepared = await deps.prepare()
  if (!prepared.ok) {
    return { ok: false, failure: prepared.failure, engineSpawned: false }
  }
  const { prep } = prepared
  // Publish the prepared stack before anything downstream runs — the engine
  // reads it, and a licence-deferred build needs it when activation later starts
  // the engine.
  deps.onPrepared(prep)
  // Kick off the DB boot but do NOT await it: the engine's cold import must
  // overlap the cluster coming up. The caller owns the failure handler.
  const clusterReady = deps.startCluster(prep)
  let engineSpawned = false
  if (deps.gateAllowsEngine()) {
    // No engine before the gate passes ("require Beta-key before API"); once it
    // has, spawn it BEFORE await-postgres-ready resolves. The engine waits for
    // and migrates the database itself.
    deps.spawnEngine()
    engineSpawned = true
  }
  return { ok: true, prep, clusterReady, engineSpawned }
}
