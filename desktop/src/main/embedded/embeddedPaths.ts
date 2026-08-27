/**
 * Where the packaged app's bundled runtimes and its per-user state live.
 *
 * The split this module exists to enforce: **everything shipped is read-only,
 * everything written is per-user.** A standard Windows install lands under
 * ``C:\Program Files\``, which a normal account cannot write to — so a data
 * directory resolved relative to the install path works on the developer's
 * machine (where the app runs from a writable build tree) and fails on every
 * real one.
 *
 * @module main/embedded/embeddedPaths
 */

import { join } from 'path'

/** Resolved absolute locations for one packaged install. */
export interface EmbeddedLayout {
  /** Root of the bundled PostgreSQL + PostGIS tree (read-only). */
  pgsqlRoot: string
  /** ``initdb.exe`` — creates the cluster on first launch. */
  initdbExe: string
  /** ``postgres.exe`` — the server itself. */
  postgresExe: string
  /** Root of the bundled CPython runtime (read-only). */
  pythonExe: string
  /** Directory added to ``PYTHONPATH`` so ``groundmodel`` imports (read-only). */
  backendSrcDir: string
  /** The PostgreSQL data directory (written). */
  dataDir: string
  /** JSON file holding this install's generated database password (written). */
  credentialsFile: string
  /**
   * Transient file handing the initial password to ``initdb --pwfile``.
   *
   * Deliberately a SIBLING of the data directory, never a child of it:
   * ``initdb`` refuses any target that is not empty, so a password file
   * written inside would make first-boot fail with "directory exists but is
   * not empty" on every machine and every retry. It goes through a file at
   * all — rather than an argument — because command lines are readable by
   * any other process on the machine.
   */
  initPasswordFile: string
}

/**
 * Resolve every path the embedded stack needs.
 *
 * @param resourcesPath - Electron's ``process.resourcesPath`` — the install's
 *   ``resources`` directory, where ``extraResources`` are unpacked.
 * @param userDataPath - Electron's ``app.getPath('userData')`` — per-user,
 *   writable, and preserved across app updates.
 * @returns Absolute paths for the bundled binaries and the per-user state.
 */
export function resolveEmbeddedLayout(
  resourcesPath: string,
  userDataPath: string,
): EmbeddedLayout {
  const pgsqlRoot = join(resourcesPath, 'pgsql')
  return {
    pgsqlRoot,
    initdbExe: join(pgsqlRoot, 'bin', 'initdb.exe'),
    postgresExe: join(pgsqlRoot, 'bin', 'postgres.exe'),
    pythonExe: join(resourcesPath, 'python', 'python.exe'),
    backendSrcDir: join(resourcesPath, 'backend', 'src'),
    dataDir: join(userDataPath, 'pgdata'),
    credentialsFile: join(userDataPath, 'pgcredentials.json'),
    initPasswordFile: join(userDataPath, 'pginit.tmp'),
  }
}

/**
 * Every path in the layout the app writes to.
 *
 * Exists so the "nothing writable under the install directory" rule is
 * checkable in one place instead of being re-derived by each reader — and so
 * adding a writable member without listing it here fails a test.
 *
 * @param layout - A resolved layout.
 * @returns The writable paths, in declaration order.
 */
export function writablePaths(layout: EmbeddedLayout): string[] {
  return [layout.dataDir, layout.credentialsFile, layout.initPasswordFile]
}
