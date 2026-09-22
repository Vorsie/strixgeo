// Cross-language twin test — cross-section channel toggle keys (debt #284/#275).
//
// The section view_state carries two toggle bags, cpt_channels and
// borehole_channels. Their keys live once here (DEFAULT_CPT_CHANNELS /
// DEFAULT_BOREHOLE_CHANNELS) and once in Python
// (api/schemas/project/cross_section.py — CptChannels / BoreholeChannels,
// extra='forbid'). SectionPanel PATCHes the WHOLE bag on every toggle, so a key
// the backend does not know rejects every toggle with a 422 — which is what
// happened on 2026-09-22 after PR #18 added the coded-lithology toggle on this
// side only ("Kon de profielwijziging niet opslaan").
//
// This module and its Python twin (tests/unit/api/test_twin_section_channel_keys.py)
// read the SAME committed arbiter, tests/fixtures/contracts/section_channel_keys.json.
// A key added or dropped on either side turns the other side's suite red.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { DEFAULT_BOREHOLE_CHANNELS, DEFAULT_CPT_CHANNELS } from './cptChannels'

// .../desktop/src/renderer/src/components/sections -> repo root is 6 up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../'.repeat(6))
const FIXTURE_PATH = resolve(REPO_ROOT, 'tests/fixtures/contracts/section_channel_keys.json')

interface Fixture {
  cpt_channels: string[]
  borehole_channels: string[]
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture

describe('section channel keys twin (debt #284/#275)', () => {
  it('the CPT toggles the renderer can send are exactly the shared contract', () => {
    expect(new Set(Object.keys(DEFAULT_CPT_CHANNELS))).toEqual(new Set(fixture.cpt_channels))
  })

  it('the borehole toggles the renderer can send are exactly the shared contract', () => {
    expect(new Set(Object.keys(DEFAULT_BOREHOLE_CHANNELS))).toEqual(
      new Set(fixture.borehole_channels),
    )
  })
})
