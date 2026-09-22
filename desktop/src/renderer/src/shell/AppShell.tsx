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
import StageErrorBoundary from './StageErrorBoundary'
import Inspector from './Inspector'
import { sectionsRevealColumnCallback } from './stages/sections/sectionColumnRevealBridge'
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

  // Geology deep-link — triggered from the Sections (litho) canvas when
  // the user picks "Edit in Stratigraphy stage" on a geological contact.
  //
  // The stratigraphic model is edited on CROSS-SECTIONS, not on the Stratigraphy
  // stage's 3D Cesium viewer (that stage is 3D-or-empty-state only, see
  // GeologyCanvas). So the deep-link opens the SECTION VIEW — the Sections
  // stage on the GEOLOGICAL axis, where the geological contact is the
  // editable one — and pulses that contact (debt #156). Routing to the
  // Stratigraphy stage instead landed the user on the globe and fired
  // "couldn't find the contact" twice (dogfeed 2026-05-28).
  //
  // The focus states the geological axis explicitly (third arg): the user
  // fired this from the litho axis, so without the override
  // handleFocusContacts searches lithoContacts and misses the geological
  // contact. The axis is switched too so the amber ring paints on the
  // geological axis. The payload is cleared here (single-fire); unlike the
  // sections deep-link below there is no deferred timer, so a synchronous
  // clear cannot cancel any pending work.
  useEffect(() => {
    const target = context.coordinator.geoDeepLinkTarget
    if (target == null) return
    log.info(
      'shell',
      `geo-deep-link: stage=sections axis=geological section=${target.sectionId} contact=${target.contactId}`,
    )
    setActiveStage('sections')
    context.sections.setSectionModelAxis('geological')
    context.sections.handleSelectSection(target.sectionId)
    context.sections.handleFocusContacts([target.contactId], target.sectionId, 'geological')
    context.coordinator.setGeoDeepLinkTarget(null)
    // reason: setActiveStage + the sections handlers + the coord setter are
    // stable callbacks; context.coordinator.geoDeepLinkTarget is the only
    // signal that should trigger this effect. Including context itself would
    // re-fire on every unrelated shell-state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.coordinator.geoDeepLinkTarget])

  // Sections deep-link — set by the surface-crossings banner (Geology
  // or Sections inspector) when the user picks an issue.  Switches to
  // the Sections stage, selects the chosen section, then DEFERS the
  // focus-contacts call by a beat so the freshly-mounted SectionPanel
  // has time to fetch its cptPlots / boreholeDetails before the
  // zoom-to-detail math runs.  Without this delay the math reads
  // empty data maps, predicts the wrong post-zoom column widths, and
  // the target ends up offscreen-right (user-reported repeatedly on
  // the Geology-pane click while the same click from an already-
  // mounted Sections stage works correctly — that's the asymmetry
  // we're erasing).  Same dispatch the xsection-click path uses,
  // just delayed until the section is alive.
  useEffect(() => {
    const target = context.coordinator.sectionsDeepLinkTarget
    if (target == null) return
    log.info(
      'shell',
      `sections-deep-link: stage=sections section=${target.sectionId} contacts=${target.contactIds.length}`,
    )
    setActiveStage('sections')
    if (target.sectionModelAxis !== undefined) {
      context.sections.setSectionModelAxis(target.sectionModelAxis)
    }
    context.sections.handleSelectSection(target.sectionId)
    // Defer the focus pulse.  600 ms covers the CPT-plot batch fetch
    // observed at ~440 ms on the test project + a margin for the
    // borehole-detail fetch + first layout pass.
    //
    // CRITICAL: clear the deep-link target INSIDE the timer callback,
    // not synchronously.  If we cleared it here the effect's deps
    // would flip to null immediately, React would run the cleanup
    // (clearing the timer we just set) BEFORE re-running the effect
    // body, and handleFocusContacts would never fire — which is
    // exactly the regression that hit both Geology-pane click AND
    // xsection-pane click in the previous commit.
    let revealTimer: number | null = null
    const focusTimer = window.setTimeout(() => {
      context.sections.handleFocusContacts(target.contactIds, target.sectionId)
      // The column half of the same deep-link (owner ruling 2026-08-26): the
      // Build pre-flight sends a TEST to visit rather than contacts to pulse,
      // and the gapless build report sends a GAP as the two columns it stands
      // between (owner dogfeed 2026-08-28). Both run after the same 600 ms beat
      // and for the same reason — the freshly-mounted panel has to have placed
      // its columns before anything can ask where one of them is.
      const revealIds = target.revealInvestigationIds ?? []
      if (revealIds.length === 0) {
        context.coordinator.setSectionsDeepLinkTarget(null)
        return
      }
      const deadline = Date.now() + 5_000
      const attemptReveal = (): void => {
        const outcome = sectionsRevealColumnCallback.current?.(revealIds)
        if (outcome?.revealed) {
          context.coordinator.setSectionsDeepLinkTarget(null)
          return
        }
        if (Date.now() < deadline) {
          revealTimer = window.setTimeout(attemptReveal, 50)
          return
        }
        log.warn(
          'shell',
          `sections-deep-link: could not centre '${revealIds.join(', ')}' on ` +
            `section ${target.sectionId} — ` +
            (outcome === undefined
              ? 'the section canvas is not mounted'
              : `not drawn there (missing: ${outcome.missingInvestigationIds.join(', ')})`),
        )
        context.coordinator.setSectionsDeepLinkTarget(null)
      }
      attemptReveal()
    }, 600)
    return () => {
      window.clearTimeout(focusTimer)
      if (revealTimer !== null) window.clearTimeout(revealTimer)
    }
    // reason: setActiveStage + sections handlers + coord setter are
    // stable callbacks; sectionsDeepLinkTarget is the only signal that
    // should trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.coordinator.sectionsDeepLinkTarget])

  // Parameters deep-link — set when the engineer picks "Unit statistics…"
  // from a geotech band's right-click menu in a cross-section (owner ballot
  // 2026-08-26). Switches to the Parameters stage and scopes it to the band's
  // unit, which is all the destination needs: the per-unit surface is driven
  // by data, not by canvas geometry.
  //
  // Cleared SYNCHRONOUSLY, unlike the sections deep-link above. That effect
  // must defer its clear because a setTimeout still needs the payload, and
  // clearing early makes React run the cleanup (killing the timer) before the
  // effect body re-runs. Here nothing is deferred, so there is no such window
  // — and clearing at once is what stops a later inspector re-mount from
  // re-navigating on a stale target.
  useEffect(() => {
    const target = context.coordinator.parametersDeepLinkTarget
    if (target == null) return
    // The five-kind scope has no single ``unitId`` (geotech-class carries a
    // litho unit + body + class instead), so log the whole discriminated scope.
    log.info('shell', `parameters-deep-link: stage=parameters ${JSON.stringify(target)}`)
    setActiveStage('parameters')
    context.coordinator.setSelectedParameterUnit(target)
    context.coordinator.setParametersDeepLinkTarget(null)
    // reason: setActiveStage and both coordinator setters are stable
    // callbacks; parametersDeepLinkTarget is the only signal that should
    // trigger this effect. Including context itself would re-fire on every
    // unrelated shell-state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.coordinator.parametersDeepLinkTarget])

  // Export deep-link (installer #35 — the Export hub is the only export
  // surface). Set by the Sections toolbar's single "Export…" verb and the 3-D
  // stages' "Export…" verbs. Switches to the Export stage; when a section is
  // named, selects it + sets the axis first so the hub's pickers open already
  // scoped to the section and level the engineer was looking at.
  //
  // Cleared SYNCHRONOUSLY, like the parameters deep-link: nothing here is
  // deferred, so the cleanup-before-re-run hazard the sections deep-link guards
  // against cannot arise. The hub seeds its own local pickers from
  // ``selectedSectionId`` + ``sectionModelAxis``, which this effect has just set.
  useEffect(() => {
    const target = context.coordinator.exportDeepLinkTarget
    if (target == null) return
    log.info(
      'shell',
      `export-deep-link: stage=export axis=${target.axis} section=${target.sectionId ?? '(none)'}`,
    )
    if (target.sectionId !== null) {
      context.sections.setSectionModelAxis(target.axis)
      context.sections.handleSelectSection(target.sectionId)
    }
    setActiveStage('export')
    context.coordinator.setExportDeepLinkTarget?.(null)
    // reason: setActiveStage + the sections handlers + the coord setter are
    // stable callbacks; exportDeepLinkTarget is the only signal that should
    // trigger this effect. Including context itself would re-fire on every
    // unrelated shell-state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.coordinator.exportDeepLinkTarget])

  // Open-a-detail → Data stage. handleSelect / handleSelectBorehole are
  // the single funnel for "show this investigation's detail" (map click
  // AND section double-click): they set the selection + view='chart'.
  // But the detail only renders inside the Data stage, so a double-click
  // on a column while the Sections stage is active set the state and
  // showed nothing — the user "landed on the map" (the #3 stage-router
  // bug). Route any open-detail action to the Data stage.
  //
  // Keyed on the SELECTION + view (the action), deliberately NOT on
  // activeStageId: manual spine navigation away from Data while a detail
  // is still open changes only activeStageId, so this effect does not
  // re-run and the user is NOT bounced back. setActiveStage('data') is
  // idempotent (same-id set is a no-op) so no activeStageId guard is
  // needed — which is also why exhaustive-deps stays satisfied.
  useEffect(() => {
    const hasSelection =
      context.coordinator.selectedId !== null ||
      context.coordinator.selectedBoreholeId !== null
    if (hasSelection && context.coordinator.view === 'chart') {
      setActiveStage('data')
    }
  }, [
    context.coordinator.selectedId,
    context.coordinator.selectedBoreholeId,
    context.coordinator.view,
    setActiveStage,
  ])

  // Debt #43: the shell rework dropped the global "Esc backs out of the
  // detail view" behaviour. A gINT/Plaxis-trained engineer reflexively
  // hits Esc to leave a chart/borelog and nothing happened. This restores
  // ONE peel layer: the Data-stage transient detail (CptChart / BoreholeLog).
  // Esc clears the detail selection and returns to wherever the user came
  // from — back to their open cross-section (Sections stage) if one is
  // selected, otherwise to the bare Data-stage map.
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
  //     the Data stage, so the editor's own Esc is untouched),
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
      // editor (not on the Data stage) runs its own per-layer Esc peel.
      if (activeStageId !== 'data') return
      const hasSelection =
        context.coordinator.selectedId !== null ||
        context.coordinator.selectedBoreholeId !== null
      if (!hasSelection) return
      e.preventDefault()
      context.coordinator.setSelectedId(null)
      context.coordinator.setSelectedBoreholeId(null)
      context.coordinator.setView('map')
      if (context.sections.selectedSectionId !== null) {
        // The detail was opened while a cross-section was the user's
        // workspace (right-click → Open detail, or a map click with a
        // section still open). Esc backs out DIRECTLY to that section
        // instead of dropping to the bare map — the section is still
        // selected because open-detail no longer clears it.
        setActiveStage('sections')
        log.debug('shell', 'Esc → back to cross-section from detail')
      } else {
        log.debug('shell', 'Esc → cleared data-stage detail selection')
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [activeStageId, context, setActiveStage])

  // Per-RENDER, not per-event: React re-renders the shell on every state change
  // anywhere beneath it, so this fired dozens of times a second during a drag
  // and buried every other debug line in the console (owner paste 2026-08-02).
  // Per-render detail is what `trace` is for — opt in with
  // localStorage['strix.log.trace'] = '1' when the shell itself is the suspect.
  log.trace('shell', `render stage=${activeStageId} inspectorOpen=${inspectorOpen}`)

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

          {/* Center canvas — flex-1. Wrapped in a per-stage error boundary
              (audit M5): a render crash inside a stage canvas shows a "reset
              this stage" card in the stage slot while the spine, toolbar and
              inspector keep working. ``resetKey`` is the active stage id so
              navigating to a different stage clears a prior stage's crash. */}
          <StageErrorBoundary resetKey={activeStageId}>
            <StageCanvas activeStageId={activeStageId} />
          </StageErrorBoundary>

          {/* Right inspector — 420 px or 0 when collapsed */}
          <Inspector activeStageId={activeStageId} open={inspectorOpen} />
        </div>
      </div>
    </ShellContext.Provider>
  )
}
