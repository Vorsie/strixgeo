# Guided tutorial — design

**Date:** 2026-09-02 · **Debt:** #93 (onboarding), owner ruling 24 (worked sample AND
a skippable tour) · **Source:** the owner's dictated brief of 2026-09-02, transcribed
under "Owner's words" at the end. He is away while this is built; every assumption
is marked and he reviews tonight.

## Goal

Two deliverables, one of them his:

1. **A worked example project** — a small real project, fully modelled, that shows what
   a good ground model looks like at every stage. The owner builds it. The app only
   needs the mechanism to ship and load it (the prototype's "Load sample project"
   button, wired but empty today).
2. **A hands-on tutorial** — "game-like, holding by the hand": each step highlights the
   control to use, explains it, and completes when the user actually does it on THEIR
   OWN project, stage by stage: project setup → import → cross-sections → geological
   model → litho → geotech → parameters → export. Every slider and every option gets
   explained where it lives. It closes with "more coming — tell us which file formats
   you use and we build the parser".

This document designs the tutorial. The sample-project mechanism is a separate slice.
The owner will also record tutorial videos on the worked example; the tutorial links
to them per chapter (A7).

## What exists

`components/onboarding/OnboardingOverlay.tsx` (prototype, landed 2026-09-02): a modal
with welcome → choose (sample | scratch) → a six-slide tour naming the spine stages one
sentence each; persisted "seen" flag; re-openable from Help; suppressed under `STRIX_E2E`.
It is a slideshow, not a guide. It stays as the FIRST-LAUNCH front door; its tour slides
are replaced by "Start the tutorial" / "Skip", and the tutorial becomes the thing the
Help menu re-opens.

The app already carries `data-testid` attributes on the controls the e2e suite drives
(welcome screen, project dialog, import verbs, section toolbar, stage tabs, body menus).
Those ids are the tutorial's anchors — no stage component changes to point at a control.

## The tutorial, as the user sees it

* A **coach card** sits next to the highlighted control: chapter name, step title, two
  to four short sentences, and Back / Skip step / Skip tutorial. No Next button on a
  step that completes by doing — the card says what to do and shows a progress ring;
  when the user does it, the card ticks, waits a beat, and slides to the next step.
  Steps that only explain something ("this slider spreads the columns") carry Next.
* A **spotlight**: the rest of the window dims; the anchored control stays bright with a
  rounded cut-out and a 2 px ring. The user can still click anything (the dim layer
  does not block input) — a tutorial that fights the app is worse than none.
* A **progress strip** at the bottom of the card: chapter i of n, step j of m. Progress
  persists per user (localStorage, like the "seen" flag); reopening resumes at the last
  incomplete step; "Restart tutorial" in Help starts over.
* If the anchored control is not on screen (another stage is open), the card docks to
  the bottom-right and says which stage tab to open, highlighting that tab instead.
* Language follows the app (EN / NL catalogues).

## Chapters and steps (content from the brief; wording is a draft for the owner)

Each step: `anchor` = testid the spotlight targets; `done` = how the step completes
(`click` = Next, or the observable state that proves the user did it — read from the
shell context, no new events).

**0 · Welcome** (from the existing overlay): start the tutorial or skip.

**1 · Your project.** Anchor the New-project button, then the name field, then the
coordinate-system and vertical-datum fields, then Create. Done: a project is open.
Explains: why the EPSG matters (Lambert 72 for Belgium, RD for the Netherlands), what
the vertical datum means for every elevation you will see.

**2 · Import.** Anchor the Import menu ("highlight the import knob"), then each verb in
turn: DOV bbox CPT import (draw a box on the map; done: CPT count > 0); filtering the
list by date and test type, and hiding a test from the dataset (project-local hide,
reversible); DOV boreholes (done: borehole count > 0); then the remaining verbs the
Import menu actually offers today (enumerate them from the menu, one step each;
GEF files is one of them). Closing tip
step: "More importers are coming, depending on what you need — send the file formats
you use to StrixGeo and we build the parser."

**3 · Cross-sections.** Create one (done: section count > 0); look at it; then one
step per control on the section header and inspector: projection buffer, column
spacing, vertical exaggeration, channels (qc / Rf / fs / u2 / qT), boreholes on/off,
the axis tabs (Geo / Litho / Geotech), snap, the DEM line, the view-state persistence.

**4 · Geological model.** Create the model; seed from boreholes (done: contacts > 0);
"this unit is the same as that unit" — lumping the stratigraphy (done: a lumping
exists); put stratigraphy on the boreholes; extract it to the CPTs (contacts on CPT
columns); rebuild surfaces; the crossing check.

**5 · Lithostratigraphic model.** The segmenter suggestions and Accept; correlate two
columns; bodies; Build (done: litho solids exist).

**6 · Geotechnical model.** The packing pipeline; divide boreholes; correlate packing;
Join with… / Ontkoppelen; Build.

**7 · Parameters & statistics.** The unit tree; per-unit statistics; the fence cutout.

**8 · Export.** DXF, Plaxis, D-Stability / D-Sheet, the PDF sheet; the closing tip.

Chapters 1–3 ship with full drafted copy in this slice. Chapters 4–8 ship with their
step skeletons (anchors + done conditions) and one-sentence drafts, so the walk is
end-to-end tonight and the owner's review is a copy pass, not a design pass.

## Architecture

`desktop/src/renderer/src/tutorial/`:

* `tutorialCatalogue.ts` — the chapters and steps as data: `{ id, chapter, anchor,
  done: 'next' | { state: keyof TutorialState } , titleKey, bodyKey, stage }`. Pure.
* `tutorialState.ts` — `TutorialState` = the handful of observable facts the done
  conditions read (projectOpen, cptCount, boreholeCount, sectionCount,
  geoModelExists, contactCount, lumpingCount, lithoAcceptedCount, lithoSolidsBuilt,
  geotechModelExists, …), derived from `useShell()` in one hook `useTutorialState()`.
* `tutorialMachine.ts` — pure step machine: `advance(progress, state)` returns the
  next incomplete step; `complete(progress, stepId)`; `restart()`; serialisable
  progress `{ stepId, completed: string[] }` for localStorage. Tested exhaustively.
* `useAnchorRect.ts` — resolves `[data-testid="…"]` to a rect, re-measures on resize /
  scroll / mutation (ResizeObserver + MutationObserver + rAF throttle), returns null
  when absent.
* `TutorialOverlay.tsx` — the spotlight (an SVG mask with the cut-out; `pointer-events:
  none`) + `CoachCard.tsx` (positioned by a small placement function: right of the
  anchor, else below, else docked bottom-right). Mounted once in `App.tsx` next to the
  onboarding overlay; renders nothing while the tutorial is inactive.
* `tutorialProgress.ts` — localStorage read/write with the same try/catch discipline as
  `onboardingSeen.ts`.
* i18n: `locales/{en,nl}/tutorial.ts`, keys `tutorial.<chapter>.<step>.title|body`,
  `tutorial.ui.*` for the card chrome.

Hooks into what exists: `OnboardingOverlay` gains a "Start the tutorial" action that
sets the tutorial active (its old six slides go); the Help menu gets "Tutorial" (start /
resume) and "Restart tutorial"; the `STRIX_E2E` suppression applies to auto-start only,
the e2e flow starts it explicitly.

## Testing

* `tutorialMachine.test.ts`: advance on state, skip, back, restart, resume from
  persisted progress, a completed step never re-arms, unknown step id in storage
  resets.
* `tutorialCatalogue.test.ts`: every anchor testid exists somewhere under
  `desktop/src` (grep at test time), every key exists in both catalogues, no two steps
  share an id, every `done.state` is a key of `TutorialState`.
* `useAnchorRect.test.tsx` and `CoachCard.test.tsx`: rect resolution and placement.
* e2e `flow_tutorial_first_chapters.spec.ts`: start from Help, chapter 1 highlights the
  New-project button, creating a project auto-advances, chapter 2 highlights the
  Import menu, "Skip tutorial" hides everything, reopening resumes at chapter 2.

## Assumptions the owner reviews tonight

* A1 — the tutorial runs on the user's OWN project (the brief: "put in your project
  data"); the worked example is separate and not a tutorial dataset.
* A2 — the dim layer never blocks clicks.
* A3 — "explain every option" = one step per control on the section header and
  inspector; other stages get one step per verb.
* A4 — auto-advance on observable state; nothing is faked or scripted.
* A5 — one phrase of the transcript ("Safety, q three part m") is unresolved; the
  owner confirmed it is NOT G3Dv3. Chapter 2 covers the Import menu's real verbs
  until he names it.
* A6 — the closing "send us your formats" step names StrixGeo and no address yet.
* A7 — (owner, same day) he will record **tutorial videos on the worked-example
  project**. Each chapter carries an optional `videoUrl`; the coach card shows a
  "Watch the clip" button only when one is set, opening the URL in the system
  browser (the app is offline-first; videos are not bundled). No URLs today.

## Owner's words (transcribed 2026-09-02, cleaned for punctuation only)

"So we have one worked example for the users, which has all good — so we don't have
one yet, but we all make one that has an overview of what a good model should look
like. And then I think we should do a tutorial, like a game-like tutorial, holding by
hands: first step put in your project data, coordinate systems and stuff like that.
And then second step, highlight the import data knob, and then import CPTs; how do
you filter the CPTs based on the date or the test type, and then how do you throw
them out of your dataset. Second, drillings. [unresolved phrase — not G3Dv3.] And
then maybe say, like,
there will be more tips coming soon, depends on the users' needs and the file formats
that you usually use, which you can send to StrixGeo for a new parser, and so on. And
how to make a cross-section, how to look at the cross-section, what else do you have
in the cross-section — all the sliders, explain all of it, all the options, explain
each option. Then go to the stratigraphical / geological model: how to feed from
boreholes, how to say this unit is the same as that unit when you are building your
stratigraphy, how to put the stratigraphy on the boreholes, how to extract it to the
CPTs, and so on. And do the same for the litho stage, for the geotech stage — explain
every step that we did to make the test [model]."
