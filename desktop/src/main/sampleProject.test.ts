// Unit tests for the worked-example sample-project path resolver (#93, owner
// ruling A8: "the worked example ships with the installer — the .strix is an
// installer resource; Load sample project imports it").
//
// The resolver is a PURE function over three injected values (isPackaged,
// resourcesPath, appPath) so it stays free of any electron import and these
// tests point it at a real temp directory (the recoveryStore.test.ts pattern):
// the whole point is that a MISSING file on a real disk degrades to null, and a
// stubbed fs would let a wrong existsSync assumption pass.
//
// The behavioural rules, in the ruling's own words:
//   SP1 — PACKAGED: the sample lives at <resourcesPath>/sample/worked-example.strix.
//   SP2 — DEV:      the sample lives at <appPath>/resources/sample/worked-example.strix.
//   SP3 — packaged, file absent → null (the mechanism ships before the data).
//   SP4 — dev, file absent → null.
//
// SP3/SP4 are the load-bearing guards: tonight the .strix does NOT exist, so
// the resolver MUST return null and the onboarding fallback (empty project)
// stays. SP1/SP2 pin WHERE the file is looked up once the owner builds it.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  SAMPLE_DIR_NAME,
  SAMPLE_PROJECT_FILE_NAME,
  resolveSampleProjectPath,
} from './sampleProject'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'strix-sample-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Plant <base>/sample/worked-example.strix on the real disk; return its path. */
function plantSample(base: string): string {
  const dir = join(base, SAMPLE_DIR_NAME)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, SAMPLE_PROJECT_FILE_NAME)
  writeFileSync(file, 'STRIXB1-not-a-real-bundle', 'utf-8')
  return file
}

describe('resolveSampleProjectPath', () => {
  it('SP1 — packaged: resolves <resourcesPath>/sample/worked-example.strix', () => {
    const resourcesPath = root
    const expected = plantSample(resourcesPath)

    const resolved = resolveSampleProjectPath({
      isPackaged: true,
      resourcesPath,
      appPath: 'C:\\unused\\in\\packaged',
    })

    expect(resolved).toBe(expected)
  })

  it('SP2 — dev: resolves <appPath>/resources/sample/worked-example.strix', () => {
    const appPath = root
    // Dev looks one level under appPath (the desktop dir) inside resources/.
    const expected = plantSample(join(appPath, 'resources'))

    const resolved = resolveSampleProjectPath({
      isPackaged: false,
      resourcesPath: 'C:\\unused\\in\\dev',
      appPath,
    })

    expect(resolved).toBe(expected)
  })

  it('SP3 — packaged, no bundled file: returns null so the fallback stays', () => {
    // Empty temp dir — nothing planted; this is tonight's real state.
    const resolved = resolveSampleProjectPath({
      isPackaged: true,
      resourcesPath: root,
      appPath: 'C:\\unused',
    })

    expect(resolved).toBeNull()
  })

  it('SP4 — dev, no bundled file: returns null so the fallback stays', () => {
    // No resources/sample planted under root.
    const resolved = resolveSampleProjectPath({
      isPackaged: false,
      resourcesPath: 'C:\\unused',
      appPath: root,
    })

    expect(resolved).toBeNull()
  })
})
