// Owner rule for the grain-size hover popup: it is on by default, and it can
// be turned off from the Display menu OR from the bare P key.
//
//   PP1  the section opens with the PSD hover preview ON, and toggling flips it.
//   PP2  the menu item and the hotkey drive the SAME switch — flipping from one
//        is immediately visible to the other.

import { describe, expect, it } from 'vitest'

import { getPsdPreviewOn, setPsdPreviewOn, togglePsdPreviewOn } from './psdPreviewOnStore'

describe('psdPreviewOnStore', () => {
  it('PP1: the hover preview is on by default and toggling flips it', () => {
    expect(getPsdPreviewOn()).toBe(true)
    togglePsdPreviewOn()
    expect(getPsdPreviewOn()).toBe(false)
    togglePsdPreviewOn()
    expect(getPsdPreviewOn()).toBe(true)
  })

  it('PP2: menu and hotkey share one switch', () => {
    setPsdPreviewOn(false)
    expect(getPsdPreviewOn()).toBe(false)
    togglePsdPreviewOn()
    expect(getPsdPreviewOn()).toBe(true)
    setPsdPreviewOn(true)
    expect(getPsdPreviewOn()).toBe(true)
  })
})
