// The "Check for updates at start" preference and the pending-download record
// (owner ruling 2026-10-11, option a).
//
// The updater runs in MAIN at launch, before any renderer exists, so the
// setting lives in a small userData file main can read on its own. The default
// is ON; an unreadable file must never silently turn the start check off, so
// every damaged-file case reads as the default.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  UPDATER_PENDING_FILENAME,
  UPDATER_PREFERENCES_FILENAME,
  configureUpdaterPreferenceStore,
  readCheckAtStart,
  readPendingDownload,
  resetUpdaterPreferenceStoreForTests,
  writeCheckAtStart,
  writePendingDownload,
} from './updaterPreferenceStore'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'strix-updater-prefs-'))
  configureUpdaterPreferenceStore({ userDataDir: dir })
})

afterEach(() => {
  resetUpdaterPreferenceStoreForTests()
  rmSync(dir, { recursive: true, force: true })
})

describe('Check for updates at start: default on, remembered', () => {
  it('UP1 - a fresh install checks at start (default ON)', () => {
    expect(readCheckAtStart()).toBe(true)
  })

  it('UP2 - switching it off is remembered across a restart', () => {
    writeCheckAtStart(false)
    // A "restart": a fresh configuration over the same directory.
    resetUpdaterPreferenceStoreForTests()
    configureUpdaterPreferenceStore({ userDataDir: dir })
    expect(readCheckAtStart()).toBe(false)
  })

  it('UP3 - switching it back on is remembered too', () => {
    writeCheckAtStart(false)
    writeCheckAtStart(true)
    expect(readCheckAtStart()).toBe(true)
  })

  it('UP4 - the file is ours: a kind envelope and a real boolean', () => {
    writeCheckAtStart(false)
    const raw = JSON.parse(readFileSync(join(dir, UPDATER_PREFERENCES_FILENAME), 'utf-8'))
    expect(raw.kind).toBe('strixgeo.updater-preferences')
    expect(raw.checkAtStart).toBe(false)
  })
})

describe('a damaged preference file reads as the default (on)', () => {
  it('UP5 - unparseable JSON reads as on', () => {
    writeFileSync(join(dir, UPDATER_PREFERENCES_FILENAME), '{ not json', 'utf-8')
    expect(readCheckAtStart()).toBe(true)
  })

  it('UP6 - a flag that is not a real boolean reads as on', () => {
    writeFileSync(
      join(dir, UPDATER_PREFERENCES_FILENAME),
      JSON.stringify({ kind: 'strixgeo.updater-preferences', format_version: 1, checkAtStart: 'false' }),
      'utf-8',
    )
    expect(readCheckAtStart()).toBe(true)
  })

  it('UP7 - a foreign file reads as on', () => {
    writeFileSync(join(dir, UPDATER_PREFERENCES_FILENAME), JSON.stringify({ checkAtStart: false }), 'utf-8')
    expect(readCheckAtStart()).toBe(true)
  })

  it('UP8 - an unconfigured store reads as on and never throws', () => {
    resetUpdaterPreferenceStoreForTests()
    expect(readCheckAtStart()).toBe(true)
    expect(readPendingDownload()).toBeNull()
  })
})

describe('the pending download is remembered for the next start', () => {
  it('PD1 - nothing downloaded yet reads as null', () => {
    expect(readPendingDownload()).toBeNull()
  })

  it('PD2 - a finished download is remembered with its version and file', () => {
    writePendingDownload({ version: '0.1.6', downloadedFile: 'C:/cache/pending/StrixGeo-Setup-0.1.6.exe' })
    resetUpdaterPreferenceStoreForTests()
    configureUpdaterPreferenceStore({ userDataDir: dir })
    expect(readPendingDownload()).toEqual({
      version: '0.1.6',
      downloadedFile: 'C:/cache/pending/StrixGeo-Setup-0.1.6.exe',
    })
  })

  it('PD3 - clearing the record forgets it', () => {
    writePendingDownload({ version: '0.1.6', downloadedFile: 'C:/x.exe' })
    writePendingDownload(null)
    expect(readPendingDownload()).toBeNull()
  })

  it('PD4 - a damaged record reads as nothing pending', () => {
    writeFileSync(join(dir, UPDATER_PENDING_FILENAME), JSON.stringify({ kind: 'strixgeo.updater-pending', version: 6 }), 'utf-8')
    expect(readPendingDownload()).toBeNull()
  })
})
