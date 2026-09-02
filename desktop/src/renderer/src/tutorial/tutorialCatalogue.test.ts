// Integrity pins for the tutorial catalogue (spec §Testing): every anchor testid
// exists somewhere under desktop/src, every copy key exists in both locale
// catalogues, no two steps share an id, and every `done.state` is a real
// TutorialState fact. These catch the failure modes a catalogue silently ships:
// a typo'd anchor (spotlight lands nowhere), a missing key (raw key text on the
// card), a duplicate id (progress collides), a stale done fact (never advances).

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { EN } from '../i18n/locales/en'
import { NL } from '../i18n/locales/nl'
import { emptyTutorialState } from './tutorialState'
import { TUTORIAL_CHAPTERS, TUTORIAL_STEPS } from './tutorialCatalogue'

// --- source scan ----------------------------------------------------------
// The catalogue's own directory is excluded so an anchor is only "found" when a
// REAL control carries it, not because the catalogue lists it. Vitest runs from
// `desktop/` (project rule), so cwd anchors the renderer source root.
const SRC_ROOT = path.join(process.cwd(), 'src', 'renderer', 'src')
const TUTORIAL_DIR = path.join(SRC_ROOT, 'tutorial')

function collectSource(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      collectSource(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !full.startsWith(TUTORIAL_DIR)) {
      out.push(readFileSync(full, 'utf8'))
    }
  }
}

const SOURCE_FILES: string[] = []
collectSource(SRC_ROOT, SOURCE_FILES)
const SOURCE_BLOB = SOURCE_FILES.join('\n')

/**
 * Whether a real control carries this anchor. A literal testid appears verbatim;
 * a template-generated one (e.g. `stage-tab-${id}`) appears as its static prefix
 * followed by the template opener `${`.
 */
function anchorExists(anchor: string): boolean {
  if (SOURCE_BLOB.includes(anchor)) return true
  const templatePrefix = anchor.replace(/[^-]+$/, '') // drop the last "-segment"
  return templatePrefix !== anchor && SOURCE_BLOB.includes(`${templatePrefix}\${`)
}

const STATE_KEYS = new Set(Object.keys(emptyTutorialState()))

describe('tutorialCatalogue integrity', () => {
  it('every anchor testid is carried by a real control under desktop/src', () => {
    const missing = TUTORIAL_STEPS.filter(s => !anchorExists(s.anchor)).map(s => `${s.id} → ${s.anchor}`)
    expect(missing).toEqual([])
  })

  it('no two steps share an id', () => {
    const ids = TUTORIAL_STEPS.map(s => s.id)
    expect(ids).toHaveLength(new Set(ids).size)
  })

  it('every step copy key exists in the EN and NL catalogues', () => {
    const missingEn: string[] = []
    const missingNl: string[] = []
    for (const step of TUTORIAL_STEPS) {
      for (const key of [step.titleKey, step.bodyKey]) {
        if (!(key in EN)) missingEn.push(key)
        if (!(key in NL)) missingNl.push(key)
      }
    }
    expect(missingEn).toEqual([])
    expect(missingNl).toEqual([])
  })

  it('every chapter title key exists in the EN and NL catalogues', () => {
    for (const chapter of TUTORIAL_CHAPTERS) {
      expect(chapter.titleKey in EN).toBe(true)
      expect(chapter.titleKey in NL).toBe(true)
    }
  })

  it('every step references a chapter that has metadata', () => {
    const chapters = new Set(TUTORIAL_CHAPTERS.map(c => c.chapter))
    const orphans = TUTORIAL_STEPS.filter(s => !chapters.has(s.chapter)).map(s => s.id)
    expect(orphans).toEqual([])
  })

  it('every done.state names a real TutorialState fact', () => {
    const bad: string[] = []
    for (const step of TUTORIAL_STEPS) {
      if (step.done !== 'next' && !STATE_KEYS.has(step.done.state)) {
        bad.push(`${step.id} → ${step.done.state}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('no chapter carries a videoUrl yet (A7: the owner sets them later)', () => {
    // The type allows `videoUrl`; today every chapter leaves it unset (no clips
    // exist, the app is offline-first). This pins that default so a stray URL is
    // a deliberate change, not an accident.
    expect(TUTORIAL_CHAPTERS.every(c => c.videoUrl === undefined)).toBe(true)
  })
})
