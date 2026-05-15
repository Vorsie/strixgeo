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
