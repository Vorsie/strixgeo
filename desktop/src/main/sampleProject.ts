// Where the bundled worked-example project lives, and what a copy of it is
// called when a user installs one (debt #93, owner ruling A8 in
// docs/superpowers/specs/2026-09-02-guided-tutorial-design.md: "the worked
// example ships with the installer — the .strix is an installer resource; Load
// sample project imports it").
//
// PURE + electron-free by design: the three Electron facts it needs
// (isPackaged, resourcesPath, appPath) are injected, so ``index.ts`` supplies
// ``app.isPackaged`` / ``process.resourcesPath`` / ``app.getAppPath()`` and the
// unit test (sampleProject.test.ts) points it at a real temp directory. The
// module must NOT import ``electron`` — same constraint the recovery store and
// the packaged-profile helper follow, and what lets the tests run under vitest.

import { existsSync } from 'fs'
import { join } from 'path'

/** The sample directory name under the resource root — same in dev and packaged. */
export const SAMPLE_DIR_NAME = 'sample'

/**
 * The bundled worked-example file name the owner will build and ship.
 *
 * ``build.extraResources`` maps ``resources/sample`` → ``<install>/resources/sample``
 * (outside the asar, so the main process can copy it with the fs API). The
 * owner authors this file later; until it exists the resolver returns null and
 * the onboarding overlay keeps its empty-project fallback.
 */
export const SAMPLE_PROJECT_FILE_NAME = 'worked-example.strix'

/**
 * Default file name offered when a user installs THEIR own copy of the sample.
 *
 * A friendly, spaced name for the Save dialog — distinct from the internal
 * resource file name above (which is a build artefact the customer never sees).
 */
export const SAMPLE_INSTALL_DEFAULT_FILE_NAME = 'StrixGeo worked example.strix'

/** The three Electron facts the resolver needs, injected so it stays electron-free. */
export interface SampleProjectLocation {
  /** ``app.isPackaged`` — true in an installed build, false under electron-vite dev. */
  isPackaged: boolean
  /** ``process.resourcesPath`` — the installer's ``<install>/resources`` (packaged only). */
  resourcesPath: string
  /** ``app.getAppPath()`` — the app root in dev, whose ``resources/`` holds the sample. */
  appPath: string
}

/**
 * Resolve the absolute path of the bundled worked-example ``.strix``, or null.
 *
 * Packaged builds read ``<resourcesPath>/sample/worked-example.strix`` (the
 * ``extraResources`` landing spot); dev reads
 * ``<appPath>/resources/sample/worked-example.strix`` (the source tree). Either
 * way the file's presence is probed, so a build whose sample has not been
 * authored yet returns null rather than a path that ``copyFile`` would fail on.
 *
 * Parameters
 * ----------
 * location : SampleProjectLocation
 *     The injected Electron facts (see {@link SampleProjectLocation}).
 *
 * Returns
 * -------
 * string | null
 *     The absolute path when the file exists on disk; otherwise null.
 */
export function resolveSampleProjectPath(location: SampleProjectLocation): string | null {
  const base = location.isPackaged
    ? join(location.resourcesPath, SAMPLE_DIR_NAME)
    : join(location.appPath, 'resources', SAMPLE_DIR_NAME)
  const candidate = join(base, SAMPLE_PROJECT_FILE_NAME)
  return existsSync(candidate) ? candidate : null
}
