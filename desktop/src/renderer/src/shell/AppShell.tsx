// Root layout component — replaces the loaded-project render block in App.tsx.
//
// Composes: StageSpine (left) + StageToolbar (top) + StageCanvas (center) +
// Inspector (right), wired via useShellState for the active stage and
// inspector open/collapsed flag.
//
// The ShellContext.Provider is established HERE, not in App.tsx — AppShell
// is the provider boundary. App.tsx assembles the value (useMemo-wrapped)
// and passes it via the ``context`` prop.
//
// §8 Risk 2 note: the ``context`` prop must be a ``useMemo``-wrapped value
// from App.tsx. If passed as an object literal it recreates every App render
// and causes all useShell() consumers to re-render unnecessarily. The
// responsibility is on the caller (App.tsx, step 9).
//
// §2.2 DOM shape exactly:
//
//   <div class="flex flex-col h-screen bg-surface-app overflow-hidden">
//     <StageToolbar />          <!-- h-10, top bar -->
//     <div class="flex flex-1 overflow-hidden">
//       <StageSpine />          <!-- w-16, left rail -->
//       <StageCanvas />         <!-- flex-1, center -->
//       <Inspector />           <!-- w-[420px], right -->
//     </div>
//   </div>

import { useEffect } from 'react'
import { ShellContext } from './ShellContext'
import type { ShellContextValue } from './ShellContext'
import { useShellState } from './useShellState'
import StageSpine from './StageSpine'
import StageToolbar from './StageToolbar'
import StageCanvas from './StageCanvas'
import Inspector from './Inspector'
import { log } from '../utils/log'

export interface AppShellProps {
  /**
   * The assembled ShellContext value from App.tsx.
   *
   * MUST be wrapped in ``useMemo`` at the call site — see §8 Risk 2.
   * Passing an inline object literal causes every ``useShell()`` consumer
   * to re-render on every App render.
   */
  context: ShellContextValue
}

/**
 * Root layout component for the workflow-spine shell.
 *
 * Establishes the ``ShellContext.Provider`` so all descendant stage components
 * can read app state via ``useShell()``.  Owns the active-stage and inspector-
 * open UI chrome via ``useShellState`` (localStorage-backed, per §2.4).
 *
 * Composes ``StageSpine``, ``StageToolbar``, ``StageCanvas``, and
 * ``Inspector`` into the §2.2 DOM shape.
 *
 * Parameters
 * ----------
 * context
 *     The full ``ShellContextValue`` assembled in App.tsx.  Must be
 *     ``useMemo``-wrapped at the call site.
 *
 * Returns
 * -------
 * JSX.Element
 *     The full shell layout.
 */
export default function AppShell({ context }: AppShellProps): JSX.Element {
  const { activeStageId, inspectorOpen, setActiveStage, toggleInspector } = useShellState()

  // Reset to Data stage on every project open. The localStorage-backed
  // stage preference ("remember last stage") is a within-session UX:
  // opening a *different* project should start on Data, not wherever
  // the user left off last session. The effect fires whenever the
  // project.id changes (including the initial mount — fresh open always
  // lands on Data). "Remember last stage within a session" is
  // unaffected: if the user switches stages and then navigates back
  // within the same project open, the activeStageId in-memory state
  // already tracks their current stage correctly.
  useEffect(() => {
    setActiveStage('data')
    // reason: setActiveStage is a stable useCallback; including
    // context.project.id ensures the effect re-fires when the user
    // switches projects without remounting AppShell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.project.id])

  // Debt #43: the shell rework dropped the global "Esc backs out of the
  // detail view" behaviour. A gINT/Plaxis-trained engineer reflexively
  // hits Esc to leave a chart/borelog and nothing happened. This restores
  // ONE peel layer: the Data-stage transient detail (CptChart / BoreholeLog
  // that replaces the map) → clear the selection, returning to the map.
  //
  // Deliberately NOT closing the persistent right Inspector: it is an
  // always-on workspace panel (ui-shell §2.4 default-open + the
  // soft-coupling UX rule), not the transient "detail panel" docs/ux.md's
  // Esc rule refers to. Collapsing it on Esc would be surprising.
  //
  // Collision-safe by yielding to every more-specific Esc owner:
  //   * an open Modal (renders role="dialog" + its own Esc handler),
  //   * an active draw mode (bbox / section line — their components own Esc),
  //   * the Sections-stage editor's per-layer Esc peel (we never act off
  //     the Data stage, and bail when a section is selected),
  //   * a typing target (input / textarea / select / contentEditable).
  // The handler reads live values off ``context`` (a useMemo'd object that
  // re-identifies when any slice changes) so the effect re-binds with
  // fresh state rather than closing over a stale snapshot.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }
      // A modal owns Esc — Modal.tsx renders role="dialog".
      if (document.querySelector('[role="dialog"]')) return
      // A draw mode owns Esc (bbox import / section line).
      if (
        context.investigations.bboxImportType !== null ||
        context.sections.drawingSection
      ) {
        return
      }
      // Scoped to the Data-stage transient detail only — the Sections
      // editor runs its own per-layer Esc peel and must not be touched.
      if (activeStageId !== 'data') return
      if (context.sections.selectedSectionId !== null) return
      const hasSelection =
        context.coordinator.selectedId !== null ||
        context.coordinator.selectedBoreholeId !== null
      if (!hasSelection) return
      e.preventDefault()
      context.coordinator.setSelectedId(null)
      context.coordinator.setSelectedBoreholeId(null)
      context.coordinator.setView('map')
      log.debug('shell', 'Esc → cleared data-stage detail selection')
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [activeStageId, context])

  log.debug('shell', `render stage=${activeStageId} inspectorOpen=${inspectorOpen}`)

  return (
    <ShellContext.Provider value={context}>
      {/* §2.2 outer wrapper — full-screen, flex column, dark-first surface */}
      <div className="flex flex-col h-screen bg-surface-app overflow-hidden">
        {/* Top bar — h-10, stage verbs left, global controls right */}
        <StageToolbar
          activeStageId={activeStageId}
          inspectorOpen={inspectorOpen}
          onToggleInspector={toggleInspector}
        />

        {/* Body row — spine + canvas + inspector */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left spine — w-16 */}
          <StageSpine
            activeStageId={activeStageId}
            onSelectStage={setActiveStage}
          />

          {/* Center canvas — flex-1 */}
          <StageCanvas activeStageId={activeStageId} />

          {/* Right inspector — 420 px or 0 when collapsed */}
          <Inspector activeStageId={activeStageId} open={inspectorOpen} />
        </div>
      </div>
    </ShellContext.Provider>
  )
}
