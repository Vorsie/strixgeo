# Geotech gapless navigation and rail localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make geotech coverage exact, make report “Show me” reliably reveal its geotechnical section span, and localize the complete workflow rail in Dutch.

**Architecture:** The final classed and fallback surfaces must retain the litho-derived cover; they are the same surfaces rendered and sent to the 3-D build. A Sections deep link carries an optional destination axis and waits for an affirmative bridge result. The workflow rail consumes typed translation keys, including dynamic status and footer copy.

**Tech Stack:** React/TypeScript, Vitest + Testing Library, existing useT/translate catalogues, hierarchical section-fill geometry.

**Spec:** docs/superpowers/specs/2026-08-28-geotech-gapless-navigation-and-rail-i18n-design.md

## Global Constraints

- Keep every closed litho-derived region in final geotech coverage; do not enlarge a geometry tolerance to hide loss.
- Clause 1 allows only the 1e-9 m² machine-rounding floor, never a width-scaled allowance.
- A 2-D geotech finding opens Sections on the geotechnical axis, never the 3-D Geotechnical stage.
- Clear a reveal request only after bridge success or a bounded, logged failure.
- Preserve the owner’s uncommitted constructive-fill files.
- Use Node 22 and run Vitest from desktop/. Do not start the app, Playwright, or integration tests.
- Stage and commit one file at a time; do not push.

---

## File structure

| File | Responsibility |
|---|---|
| utils/geotechHierarchicalFill/index.ts | Return final surfaces without whole-region removal. |
| utils/geotechHierarchicalFill/needleDropCoverage.test.ts | Pin retention of a closed thin region. |
| utils/gaplessGate/gaplessGate_constants.ts | Expose only a floating-point area floor. |
| utils/gaplessGate/clauses2d.test.ts | Pin exact-cover pass and material-loss failure. |
| shell/ShellContext.ts | Type an optional destination section axis. |
| shell/stages/geotechnical/GeotechnicalCanvas.tsx | Send report reveals to the geotech axis. |
| shell/stages/geotechnical/useGeotechBuildPreflight.ts | Send preflight visits to the geotech axis. |
| shell/AppShell.tsx | Select axis and conditionally retry the bridge. |
| shell/StageDescriptor.ts + StageSpine.tsx | Use translated spine label keys and footer copy. |
| i18n/locales/*/chrome.ts + stage descriptors | Localize rail labels and dynamic summaries. |

### Task 1: Preserve exact final geotech cover

**Files:**
- Modify: desktop/src/renderer/src/utils/geotechHierarchicalFill/needleDropCoverage.test.ts
- Modify: desktop/src/renderer/src/utils/geotechHierarchicalFill/index.ts
- Modify: desktop/src/renderer/src/utils/gaplessGate/clauses2d.test.ts
- Modify: desktop/src/renderer/src/utils/gaplessGate/gaplessGate_constants.ts

**Interfaces:**
- Consumes: the classed regions, fallback regions, and pre-merge regions computed from litho cover.
- Produces: HierarchicalGeotechFillResult surfaces that retain every closed region; areaConservationEpsilonM2(widthM) always returns 1e-9.

- [ ] **Step 1: Write the failing coverage test**

Replace the needle test’s apex-only assertion with a complete-cover assertion:

~~~ts
const output = computeHierarchicalGeotechFill(existingNeedleInput)
const retained = output.lithoFallback.find(region => region.gapIndex === 0)
expect(retained).toBeDefined()
expect(regionAreaM2(retained!, GAP_WIDTH_M)).toBeCloseTo(
  regionAreaM2(needleLithoRegion(), GAP_WIDTH_M),
  9,
)
~~~

Import regionAreaM2 from utils/partitionFill/regionArea. The test says a closed thin region is still model ground.

- [ ] **Step 2: Run the test and observe red**

~~~powershell
cd desktop
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npx vitest run src/renderer/src/utils/geotechHierarchicalFill/needleDropCoverage.test.ts
~~~

Expected: FAIL because the result path removes a whole needle region.

- [ ] **Step 3: Retain exact result geometry**

In computeHierarchicalGeotechFill, keep the cross-family weld but return its regions, lithoFallback, and preMergeRegions directly. Remove only its three dropRegionNeedles calls. Do not alter the standalone helper or owner-owned constructive files.

~~~ts
const swept = weldAcrossFamilies(regions, classKeyOf)
return {
  regions: swept.regions,
  lithoFallback,
  preMergeRegions,
  // existing diagnostics
}
~~~

- [ ] **Step 4: Run coverage tests green**

~~~powershell
npx vitest run src/renderer/src/utils/geotechHierarchicalFill/needleDropCoverage.test.ts src/renderer/src/utils/geotechHierarchicalFill/dropNeedleSpurs.test.ts
~~~

Expected: PASS; the helper may retain its visual-cleanup unit tests, but final model geometry must not call it.

- [ ] **Step 5: Write failing exact-accounting tests**

In clauses2d.test.ts, add:
1. matching classed/fallback boxes pass with zero delta;
2. a 0.0001 m² missing box fails on a 5 km-wide gap.

~~~ts
const clause = clauses2dForSection({
  lithoRegions: [box(1, 0, 1, 0, 8.42)],
  hierarchical: hierarchical({ regions: [box(1, 0, 1, 0, 8.4199)] }),
  alongM: [0, 5, 5005],
  columnInvestigationIds: OWNER_COLUMNS,
}).find(entry => entry.key === 'area-conservation')!
expect(clause.status).toBe('fail')
~~~

- [ ] **Step 6: Run the clause test red**

~~~powershell
npx vitest run src/renderer/src/utils/gaplessGate/clauses2d.test.ts
~~~

Expected: FAIL because the current allowance grows with gap width.

- [ ] **Step 7: Limit clause 1 to floating-point residue**

Change areaConservationEpsilonM2 to ignore width and return AREA_EPS_FLOOR_M2. Update its documentation and the report copy: it must say floating-point allowance, never “gap this wide.”

~~~ts
export function areaConservationEpsilonM2(_widthM: number): number {
  return AREA_EPS_FLOOR_M2
}
~~~

- [ ] **Step 8: Verify and commit one file at a time**

~~~powershell
npx vitest run src/renderer/src/utils/geotechHierarchicalFill/needleDropCoverage.test.ts src/renderer/src/utils/geotechHierarchicalFill/dropNeedleSpurs.test.ts src/renderer/src/utils/gaplessGate/clauses2d.test.ts
git add desktop/src/renderer/src/utils/geotechHierarchicalFill/needleDropCoverage.test.ts
git commit -m "test(geotech): pin exact final cover"
git add desktop/src/renderer/src/utils/geotechHierarchicalFill/index.ts
git commit -m "fix(geotech): retain closed cover regions"
git add desktop/src/renderer/src/utils/gaplessGate/clauses2d.test.ts
git commit -m "test(geotech): pin exact cover accounting"
git add desktop/src/renderer/src/utils/gaplessGate/gaplessGate_constants.ts
git commit -m "fix(geotech): limit cover check to float residue"
~~~

### Task 2: Deliver report reveals to the ready geotech section

**Files:**
- Modify: desktop/src/renderer/src/shell/ShellContext.ts
- Modify: desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalCanvas.tsx
- Modify: desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalCanvas.test.tsx
- Modify: desktop/src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight.ts
- Modify: desktop/src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight.test.tsx
- Modify: desktop/src/renderer/src/shell/AppShell.tsx
- Modify: desktop/src/renderer/src/shell/AppShell.test.tsx

**Interfaces:**
- Consumes: sectionsRevealColumnCallback.current(ids), which returns undefined or { revealed, missingInvestigationIds }.
- Produces: sectionsDeepLinkTarget.sectionModelAxis?: SectionModelAxis and a target cleared only after success or bounded failure.

- [ ] **Step 1: Write failing geotech-caller tests**

Extend the existing report and preflight expectations:

~~~ts
expect(setSectionsDeepLinkTarget).toHaveBeenCalledWith({
  sectionId: 'section-1',
  contactIds: [],
  revealInvestigationIds: ['left-id', 'right-id'],
  sectionModelAxis: 'geotechnical',
})
~~~

- [ ] **Step 2: Run caller tests red**

~~~powershell
cd desktop
npx vitest run src/renderer/src/shell/stages/geotechnical/GeotechnicalCanvas.test.tsx src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight.test.tsx
~~~

Expected: FAIL because callers omit the axis.

- [ ] **Step 3: Type and send the axis**

Import the existing section-axis union into ShellContext and add the optional field. Set sectionModelAxis: 'geotechnical' in the report and preflight callers only; preserve current-axis behavior for other deep links.

- [ ] **Step 4: Run caller tests green**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Write failing AppShell tests for readiness**

Use fake timers and mutate the actual bridge ref. Start with undefined, then return a revealed outcome. Assert:
- setSectionModelAxis('geotechnical') runs before handleSelectSection;
- the target stays live after the first unavailable attempt;
- the second attempt centres the two names and then clears the target;
- a never-ready bridge logs once and clears after the bounded deadline.

The test comment must say “wait until the section bridge confirms the span,” not describe a timer.

- [ ] **Step 6: Run AppShell test red**

~~~powershell
npx vitest run src/renderer/src/shell/AppShell.test.tsx
~~~

Expected: FAIL because the current 600-ms one-shot neither selects the axis nor retries.

- [ ] **Step 7: Implement condition-based delivery**

Set target.sectionModelAxis before handleSelectSection. Keep contact focus a one-time operation. For reveal ids, retry only while the bridge outcome is absent or unrevealed; stop immediately on outcome.revealed. Bound the loop to 5 seconds at 50 ms intervals, clean up both timers, log section plus missing IDs at expiry, and clear then. Empty revealIds retain the contact-only clear behavior.

~~~ts
const deadline = Date.now() + 5_000
const attemptReveal = () => {
  const outcome = sectionsRevealColumnCallback.current?.(revealIds)
  if (outcome?.revealed) return context.coordinator.setSectionsDeepLinkTarget(null)
  if (Date.now() < deadline) return window.setTimeout(attemptReveal, 50)
  log.warn('shell', /* target section and unresolved ids */)
  context.coordinator.setSectionsDeepLinkTarget(null)
}
~~~

- [ ] **Step 8: Verify and commit one file at a time**

~~~powershell
npx vitest run src/renderer/src/shell/AppShell.test.tsx src/renderer/src/shell/stages/sections/useSectionColumnRevealBridge.test.ts src/renderer/src/shell/stages/sections/GapRevealFlash.test.tsx
~~~

Commit test files before their source files. Use test(sections): pin geotech report reveal, feat(geotech): target report at geotech axis, and fix(shell): wait for section reveal.

### Task 3: Localize the vertical workflow rail

**Files:**
- Modify: desktop/src/renderer/src/i18n/locales/en/chrome.ts
- Modify: desktop/src/renderer/src/i18n/locales/nl/chrome.ts
- Modify: desktop/src/renderer/src/shell/StageDescriptor.ts
- Modify: desktop/src/renderer/src/shell/StageSpine.tsx
- Modify: desktop/src/renderer/src/shell/StageSpine.test.tsx
- Modify: stage descriptor files under shell/stages/data, sections, geology, lithology, geotechnical, parameters, export.

**Interfaces:**
- Consumes: MessageKey and useT().
- Produces: StageDescriptor.spineLabelKey, translated visible rail labels, titles, ARIA labels, dynamic summaries, and selection footer.

- [ ] **Step 1: Write failing Dutch rail tests**

In StageSpine.test.tsx, call setLanguage('nl') before rendering and reset English after each test:

~~~ts
render(<StageSpine activeStageId="sections" onSelectStage={vi.fn()} />)
expect(screen.getByText('Profielen')).toBeInTheDocument()
expect(screen.getByRole('navigation', { name: 'Werkvolgorde' })).toBeInTheDocument()
expect(screen.getByRole('button', { name: /profielen/i })).toHaveAttribute('title', 'Profielen')
~~~

With an active selection, assert the count, clear aria label, title, and visual abbreviation all use Dutch messages. Add an English regression assertion.

- [ ] **Step 2: Run rail test red**

~~~powershell
cd desktop
npx vitest run src/renderer/src/shell/StageSpine.test.tsx
~~~

Expected: FAIL because the rail and footer contain raw English strings.

- [ ] **Step 3: Add translated message and descriptor contracts**

Add matching English/Dutch chrome keys for footer text and dynamic summaries, with identical placeholders. Add spineLabelKey: MessageKey to StageDescriptor. Replace all seven static spineLabel values with existing spine.* keys. Make each stage’s summary hook call useT for its visible summary while preserving badge number and intent.

- [ ] **Step 4: Translate StageSpine**

Use useT in the rail. Render t(descriptor.spineLabelKey); use translated stage label plus translated summary in button title/aria label; replace raw Workflow stages, selected, click to clear, and sel. with catalogue keys. Preserve button behavior and badge semantics.

- [ ] **Step 5: Verify and commit one file at a time**

~~~powershell
npx vitest run src/renderer/src/shell/StageSpine.test.tsx src/renderer/src/i18n/localeParity.test.ts
npx tsc -p tsconfig.web.json --noEmit
~~~

Expected: PASS. Commit tests before sources, one file per commit, with test(i18n): pin dutch workflow rail, feat(i18n): translate workflow rail, and refactor(shell): key workflow rail labels.

### Task 4: Final verification and dogfood handoff

**Files:** No new files unless focused verification finds a defect.

- [ ] **Step 1: Run the focused output suite**

~~~powershell
cd desktop
npx vitest run src/renderer/src/utils/geotechHierarchicalFill/needleDropCoverage.test.ts src/renderer/src/utils/geotechHierarchicalFill/dropNeedleSpurs.test.ts src/renderer/src/utils/gaplessGate/clauses2d.test.ts src/renderer/src/shell/AppShell.test.tsx src/renderer/src/shell/stages/geotechnical/GeotechnicalCanvas.test.tsx src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight.test.tsx src/renderer/src/shell/stages/sections/useSectionColumnRevealBridge.test.ts src/renderer/src/shell/stages/sections/GapRevealFlash.test.tsx src/renderer/src/shell/StageSpine.test.tsx src/renderer/src/i18n/localeParity.test.ts
~~~

Expected: PASS. The known owner-unapproved CS1 golden remains outside this suite and must not be claimed fixed.

- [ ] **Step 2: Run TypeScript checks**

~~~powershell
npx tsc -p tsconfig.web.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
~~~

Expected: PASS.

- [ ] **Step 3: Verify actual application output**

In the owner-run app: set Dutch and inspect the rail for Werkvolgorde and Profielen; rebuild geotech and confirm the two prior false clause-1 failures are absent; press Show me and confirm Sections opens on Geotech, centres the named span, and flashes the span rather than either endpoint. Keep a fixture with material loss to prove clause 1 still fails.

- [ ] **Step 4: Report evidence**

Report focused tests, TypeScript checks, one-file commits, no push, and the distinct still-unapproved CS1 visual golden.
