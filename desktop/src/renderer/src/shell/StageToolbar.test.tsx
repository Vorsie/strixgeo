// Smoke test for StageToolbar (debt #23 — toolbar clip at narrow widths).
//
// The toolbar's left zone used to be `overflow-hidden`, which silently
// clipped the rightmost verbs at sub-900px window widths (the original
// failure class behind debt #14's InterpretationPane overflow). The
// fix swapped that for a `toolbar-scrollable` class that gives a thin
// horizontal scrollbar when the content exceeds the available width.
//
// This test pins the class contract: the left zone must always carry
// `toolbar-scrollable` (and NOT `overflow-hidden`), so a future
// refactor that reverts the class fails loudly.
//
// Layout-aware "actually scrolls when narrow" coverage is out of scope
// for JSDOM — that needs a real browser. The class contract is the
// load-bearing structural invariant; the CSS does the visual work.

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import StageToolbar from './StageToolbar'
import { ShellContext, type ShellContextValue } from './ShellContext'

const noopAsync = (): Promise<void> => Promise.resolve()

// Minimal ShellContextValue stub — only the fields StageToolbar reads.
// All other slices are filled with shape-correct empty values.
function makeShellCtx(): ShellContextValue {
  return {
    project: {
      id: 'p1',
      name: 'Test Project',
      project_number: null,
      client: null,
      site_label: null,
      description: null,
      tags: [],
      default_horizontal_epsg: 31370,
      default_vertical_epsg: 5710,
      phase: 'design',
      status: 'active',
      view_state: {},
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      archived_at: null,
    },
    lifecycle: {
      projectDirty: false,
      newProjectOpen: false,
      setNewProjectOpen: vi.fn(),
      metadataEditorOpen: false,
      setMetadataEditorOpen: vi.fn(),
      closeConfirmOpen: false,
      setCloseConfirmOpen: vi.fn(),
      unsavedDialogOpen: false,
      unsavedSaving: false,
      saveProject: () => Promise.resolve(true),
      discardSessionImports: vi.fn(),
      handleCloseProjectRequest: vi.fn(),
      handleUnsavedSave: noopAsync,
      handleUnsavedDiscard: vi.fn(),
      handleUnsavedCancel: vi.fn(),
      stageLumping: vi.fn(),
      currentLumping: null,
    },
    // Other slices intentionally empty — StageToolbar only reads
    // project + lifecycle + coordinator.projectFilePath.
    investigations: {} as ShellContextValue['investigations'],
    visibleCpts: [],
    visibleBoreholes: [],
    geoModel: {} as ShellContextValue['geoModel'],
    sections: {} as ShellContextValue['sections'],
    overlays: {} as ShellContextValue['overlays'],
    toasts: { toasts: [], toast: vi.fn() },
    undo: {} as ShellContextValue['undo'],
    boot: { ready: true, apiError: false },
    mapState: {} as ShellContextValue['mapState'],
    coordinator: {
      ...({} as ShellContextValue['coordinator']),
      projectFilePath: null,
    } as ShellContextValue['coordinator'],
  }
}

describe('StageToolbar (debt #23 — overflow scroll)', () => {
  it('left zone has the toolbar-scrollable class (not overflow-hidden)', () => {
    const { container } = render(
      <ShellContext.Provider value={makeShellCtx()}>
        <StageToolbar
          activeStageId="data"
          inspectorOpen={false}
          onToggleInspector={vi.fn()}
        />
      </ShellContext.Provider>,
    )

    // The toolbar's left zone is the first child of the role="toolbar".
    const toolbar = container.querySelector('[role="toolbar"]')
    expect(toolbar).not.toBeNull()
    const leftZone = toolbar?.firstElementChild
    expect(leftZone).not.toBeNull()
    expect(leftZone?.className).toContain('toolbar-scrollable')
    // Defensive: the old class must NOT come back via copy-paste from
    // an older revision. A literal `overflow-hidden` here would
    // re-introduce debt #23's silent clip.
    expect(leftZone?.className).not.toContain('overflow-hidden')
  })
})
