// Red-first pin for owner ruling 2 (2026-09-06): "Stel het coordinatensysteem
// in is invisible when projectgegevens is open, it should be visible there."
//
// Root cause: the shared Modal paints its backdrop + card at the int32-max
// z-index, and the tutorial overlay sat at z-[9999], so the coach card and the
// spotlight ring were painted BEHIND the modal scrim. Both layers are
// position:fixed portalled to <body> and therefore share ONE flat root stacking
// context (see Modal.tsx's own comment) — so the numeric z-index alone decides
// which paints on top. This test pins that the tutorial overlay's z-index is
// strictly greater than the Modal's, i.e. the guide renders ABOVE any modal
// dialog and its ring can outline a field inside the open dialog.

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import Modal from '../components/ui/Modal'
import TutorialOverlay from './TutorialOverlay'
import { ShellContext, type ShellContextValue } from '../shell/ShellContext'
import { resolveChainTestid } from './tutorialAnchorChain'
import { TUTORIAL_STEPS } from './tutorialCatalogue'

afterEach(() => {
  // RTL cleanup unmounts the tree (and both body portals). No manual
  // replaceChildren — that races RTL's own removeChild and throws.
  cleanup()
  try {
    window.localStorage.clear()
  } catch {
    /* jsdom localStorage is always present, but be defensive */
  }
})

/** The narrow slice `deriveTutorialState` reads, cast to the full bus type. */
function fakeShell(): ShellContextValue {
  return {
    project: { default_horizontal_epsg: null, default_vertical_epsg: null },
    visibleCpts: [],
    visibleBoreholes: [],
    sections: { sections: [], selectedSectionId: null, sectionModelAxis: 'geological' },
    geoModel: {
      activeGeologicalModel: null,
      activeLithoModel: null,
      activeGeotechModel: null,
      contacts: [],
      lithoLayers: [],
      hasLithoSolids: false,
      hasGeotechSolids: false,
      surfacesByFormationId: new Map(),
    },
    lifecycle: { currentLumping: null, metadataEditorOpen: true },
    coordinator: { selectedId: null, selectedBoreholeId: null, importMenuOpen: false },
  } as unknown as ShellContextValue
}

/** Extract the numeric z-index from a `z-[N]` Tailwind arbitrary class. */
function zOf(el: Element | null | undefined): number {
  const m = el?.className.match(/z-\[(\d+)\]/)
  return m ? Number(m[1]) : NaN
}

describe('tutorial stacking (owner ruling 2)', () => {
  it('the overlay renders above a modal dialog (z-index strictly greater)', () => {
    // A modal dialog (the project-settings shape) is open AND the tutorial is
    // running — both portal to <body>, so only z-index separates them.
    render(
      <ShellContext.Provider value={fakeShell()}>
        <Modal open onCancel={() => {}} labelledBy="dlg-title">
          <h2 id="dlg-title">Project settings</h2>
        </Modal>
        <TutorialOverlay active onExit={() => {}} />
      </ShellContext.Provider>,
    )

    const overlay = document.body.querySelector('[data-testid="tutorial-overlay"]')
    // The modal backdrop is the fixed, dimmed portal root the shared Modal draws.
    const modalBackdrop = Array.from(document.body.querySelectorAll('div')).find(
      d => d.className.includes('z-[') && d.className.includes('bg-black'),
    )

    expect(overlay).not.toBeNull()
    expect(modalBackdrop).toBeTruthy()
    expect(zOf(overlay)).toBeGreaterThan(zOf(modalBackdrop))
  })
})

describe('CRS / datum step chains resolve into the open dialog (owner ruling 2)', () => {
  const stepChain = (id: string): readonly string[] => {
    const step = TUTORIAL_STEPS.find(s => s.id === id)
    if (!step?.anchors) throw new Error(`${id} must be a chained step`)
    return step.anchors
  }

  it('CRS step: highlights the settings button when the dialog is closed, the CRS field when open', () => {
    const chain = stepChain('project-crs')
    // Dialog closed — only the settings button is in the DOM.
    expect(resolveChainTestid(chain, id => id === 'project-metadata-open')).toBe(
      'project-metadata-open',
    )
    // Dialog open — the CRS field exists too, so the spotlight lands on the
    // field inside the open dialog.
    expect(resolveChainTestid(chain, () => true)).toBe('project-crs-horizontal')
  })

  it('datum step: resolves to the vertical-datum field when the dialog is open', () => {
    const chain = stepChain('project-datum')
    expect(resolveChainTestid(chain, () => true)).toBe('project-crs-vertical')
  })
})
