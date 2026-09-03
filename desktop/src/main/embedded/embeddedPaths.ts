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

/**
 * Where the ``pgdata`` cluster is rooted, when it has been moved off the Roaming
 * profile (audit M1).
 *
 * ``null`` (the default) keeps ``pgdata`` under ``userDataPath`` — the original
 * behaviour, and what dev, e2e and isolated runs want. ``index.ts`` sets this to
 * ``%LOCALAPPDATA%\StrixGeo`` on a packaged launch (after relocating any existing
 * Roaming cluster), so the live database does not sit on a Roaming share.
 *
 * A configured value rather than a new ``resolveEmbeddedLayout`` argument on
 * purpose: ``embeddedStack`` calls ``resolveEmbeddedLayout`` and it is owned by
 * another change tonight — the module-level override lets the cluster move
 * without touching that call. Set once at startup, before anything resolves a
 * layout, exactly like ``configureRecoveryStore`` / ``configureDiagnosticsStore``.
 */
let configuredPgdataRoot: string | null = null

/**
 * Point the ``pgdata`` cluster at a machine-local root (or clear the override).
 *
 * @param root - The directory to root ``pgdata`` under, or ``null`` to keep it
 *   under ``userDataPath`` (the default / dev behaviour).
 */
export function configurePgdataRoot(root: string | null): void {
  configuredPgdataRoot = root
}

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
  // The cluster is rooted under the machine-local root when one is configured
  // (audit M1); everything else — the credentials + the transient init password
  // file — stays under the (Roaming) user profile so it can follow the user.
  const pgdataRoot = configuredPgdataRoot ?? userDataPath
  return {
    pgsqlRoot,
    initdbExe: join(pgsqlRoot, 'bin', 'initdb.exe'),
    postgresExe: join(pgsqlRoot, 'bin', 'postgres.exe'),
    pythonExe: join(resourcesPath, 'python', 'python.exe'),
    backendSrcDir: join(resourcesPath, 'backend', 'src'),
    dataDir: join(pgdataRoot, 'pgdata'),
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
