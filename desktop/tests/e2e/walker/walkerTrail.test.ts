/**
 * Pins for the walker's on-disk step trail.
 *
 * The rule: Playwright's reporters hide the test's ``console.log``, so a hung
 * run showed nothing of where it hung. Every step is appended to
 * ``<resultsDir>/trail.log`` AS IT GOES -- before the action runs -- so the
 * file of a run that hangs still ends with the step it hung on.
 *
 * Explicit vitest imports (see walkerPolicy.test.ts for why).
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { TrailWriter, formatTrailLine } from './walkerTrail'

const made: string[] = []

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walker-trail-test-'))
  made.push(dir)
  return dir
}

afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe('walker trail -- one line per step', () => {
  it('names the step, the stage, the action kind and its note', () => {
    expect(formatTrailLine(7, 'Sections', 'click', 'click <button#section-create>')).toBe(
      'step 7 stage=Sections click: click <button#section-create>',
    )
  })

  it('an unknown stage prints as ?', () => {
    expect(formatTrailLine(0, null, 'pressKey', 'press Escape')).toBe('step 0 stage=? pressKey: press Escape')
  })
})

describe('walker trail -- appended as it goes', () => {
  it('each line is on disk the moment it is written, before the next step', () => {
    const dir = tmpDir()
    const trail = new TrailWriter(dir)
    trail.step(0, 'Data', 'click', 'first')
    // A hang after this step must still leave this line in the file.
    expect(fs.readFileSync(path.join(dir, 'trail.log'), 'utf-8')).toContain('step 0 stage=Data click: first')
    trail.step(1, 'Data', 'wheel', 'second')
    const lines = fs.readFileSync(path.join(dir, 'trail.log'), 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('step 1 stage=Data wheel: second')
  })

  it('free notes (a switch outcome, a reopen) land in the same file', () => {
    const dir = tmpDir()
    const trail = new TrailWriter(dir)
    trail.note('switch project -> fixture: switched')
    expect(fs.readFileSync(path.join(dir, 'trail.log'), 'utf-8')).toContain('switch project -> fixture: switched')
  })

  it('a missing results directory never throws into the walk', () => {
    const trail = new TrailWriter(path.join(tmpDir(), 'gone', 'deeper'))
    expect(() => trail.step(0, null, 'click', 'x')).not.toThrow()
  })
})
