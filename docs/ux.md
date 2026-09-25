# UX Conventions

The desktop UI is built against a **layered stack of style guides**, in
order of precedence when they disagree:

1. **WCAG 2.2 — level AA**, the non-negotiable accessibility floor.
   4.5 : 1 contrast for body text, 3 : 1 for large text and UI
   components, visible focus rings on every keyboard-reachable
   element, 44 × 44 px minimum hit-target on touchable surfaces, full
   keyboard reachability, no information conveyed by colour alone.
2. **Apple HIG** for desktop interaction conventions. The most useful
   chapters for this app: Modality / Sheets / Popovers / Sidebars /
   Inspectors / Keyboard Shortcuts. Treats Esc as the universal
   dismiss key, ⌘0 / Ctrl+0 as zoom-reset, ⌘W / Ctrl+W as close pane.
3. **GitHub Primer** for visual tokens + dark-mode strategy. Two
   surface levels (page, card), accent (blue) reserved for primary
   action / selection, danger (red) reserved for destructive intent,
   muted greys for secondary chrome. We map these onto Tailwind
   utility classes (mostly `slate-*` / `gray-*` / `blue-*` /
   `red-*`); when Primer says "use accent.primary" we read that as
   `blue-600` light / `blue-400` dark.
4. **Tailwind UI / Catalyst** for code-level pattern lifts when a
   component shape exists there.
5. **Domain conventions** (ISO 14688-1 soil patterns, DOV PDF report
   layout) override every general guide above for the borelog and
   anything geotechnical-domain-specific. Generic UI (sidebars,
   dialogs, panels) follows the layered defaults strictly.

## Override rule

When a guide actively hurts UX or conflicts with domain need:

* Override at the smallest scope possible (one component, never the
  whole app theme).
* Document **why** in a header comment near the override, citing the
  guide rule it bypasses.
* Domain convention beats general convention; general convention beats
  personal taste. "I think it looks better" is not a documented
  reason — find which higher principle the guide rule is failing in
  this case (e.g. "ISO 14688-1 mandates dotted fill for sand, which
  Primer's solid-fill cards fight against — overriding").

## Selection

* **Click row body** — select / open detail (single-select).
* **Hover-X icon** — single-row remove (project-local; never DB delete).
* **Checkbox** — multi-select, always visible left of the row icon
  (NOT hover-only — discoverability beats clean-row aesthetics for
  power users curating large lists).
* **Bulk action bar** — appears at the top of the list when ≥ 1 row
  is checked; format: `N selected · [Action] · Clear`.
* **Tab switch resets selection** — checkboxes in a different tab
  refer to different items; carrying selection across is misleading.

## Keyboard shortcuts

| Shortcut | Action | Scope |
|---|---|---|
| `Esc` | Close detail panel / cancel bbox draw / cancel modal / cancel drag / cancel marquee / clear selection | Global, when applicable. On the section editor, ESC peels one interaction layer at a time (active drag → active marquee → active selection). |
| `← / →` | Prev / next item in detail panel (samples, future CPTs) | When detail panel open |
| `Ctrl + wheel` | Zoom (vertical scale on borelog, depth axis on map) | Map + borelog |
| `Ctrl + 0` | Reset zoom to 100 % | Borelog |
| `Delete` / `Backspace` | Remove selection (project-local) | When ≥ 1 row checked |
| `Click` on contact line | Replace selection + start drag. Cursor on release = new (column, depth). | Section editor |
| `Ctrl/Cmd + Click` on contact line | Toggle this contact in/out of selection (no drag) | Section editor |
| `Shift + Click` on contact line | Range-select shallow→deep within the source anchor's contacts | Section editor |
| `Drag` plain on section (background or column) | **Pan the viewport** (existing behaviour preserved) | Section editor |
| `Wheel` (no modifier) on section canvas | **Zoom** the section view, cursor-anchored (the column under the cursor stays put). Operates on the rendered, `column_spacing`-warped X — not the raw along-section position. Unlike the map / borelog, the section canvas zooms on a bare wheel, no `Ctrl`. | Section editor |
| `Click` plain on section background (no drag) | Clear contact selection | Section editor |
| `Shift + drag` ANYWHERE on the section (background OR column) | Marquee (box) select. Always **additive** — preserves existing selection. To replace, click bg to clear first, then Shift+drag. Marquee dispatch lives on the SVG root so Shift takes priority over the column's contact-pick handler. | Section editor |
| `Drag` cross-column on a contact (no Alt) | **COPY** — creates new contact(s) at the target anchor; originals stay where they were. The "stamp interpretation onto a nearby test" workflow. | Section editor |
| `Alt + drag` cross-column on a contact | **MOVE** — re-anchors the existing contact(s) to the target column. Use to fix a misclicked anchor. | Section editor |
| `Ctrl + drag` on a packing boundary strip (**geotech axis**) | Absorb-all on packing bands (owner 2026-09-25): the boundary runs through every band in its direction inside the litho body; on release every band it fully passed (or squeezed to the pair-absorb sliver) is absorbed into the dragged band and the band the release lands in keeps its far edge. One consequence sheet over the final intervals, one undo step. The litho contact stops it. | Section editor |
| `Ctrl + drag` on a ghost layer's top or bottom handle | Absorb-all (owner 2026-09-23/24): the edge travels through every pending unit in its direction and, on release, every unit it fully passed is absorbed into the dragged unit; the unit the release lands in keeps its far edge. An accepted contact stops it. `Shift + drag` on the same handle copies the whole ghost column onto another test. | Ghost review |
| `Drag` same-column on a contact | Re-pick depth (single contact) or shift all selected depths (multi-select). | Section editor |
| `Right-click` on contact line | Confirm → delete contact | Section editor |
| `Right-click` anywhere on a test — band, sample capsule, header, or the collar gap — on the **geotech axis** | ONE menu (owner installer #39: "one right-click on a test gives one menu"). Header = the test name, then the COLUMN verbs (Focus op deze proef / Details openen / Onderverdeling wissen / Uit dit profiel verwijderen), a rule, then — only when the pointer sits on a packing band — the BAND verbs (Band hier splitsen, Statistieken van deze eenheid…, Voeg samen met… / Ontkoppelen, Pakkingsklasse ▸). A second right-click closes the open menu and opens the one for the new spot (never two menus, never a different KIND for the second click). The overlay owns it; `GeotechBandEditOverlay` + `geotechMenuTargetAt`, mirroring the litho axis's unified menu. | Section editor (geotech axis) |
| `Ctrl/Cmd + A` | Select all | Future — list views |
| `Ctrl/Cmd + F` | Filter / find | Future — list views |

All shortcuts skip when an `<input>` / `<textarea>` / `<select>` /
`contentEditable` element owns focus — a centralised `isTypingTarget`
helper checks this before firing. The same helper is duplicated across
the FOUR components that listen today (Sidebar / BoreholeLog /
LabTestPanel / ContactsLayer); per CLAUDE.md's "extract on the third
copy" rule it's now ripe — collapse into a shared
`hooks/useGlobalShortcut.ts` (or just `utils/isTypingTarget.ts`) when
the next debt sweep lands.

## Stage toolbars — responsive, never clipped

A stage toolbar declares its verbs as `ToolbarItemSpec`s and renders
them through `shell/ResponsiveToolbarRow`. The row measures the space
the shell gives it and `shell/toolbarOverflow.ts` (a pure function of
widths, no DOM reads) decides which verbs keep their labels, which
become an icon-with-tooltip, and which fold into a "⋯ More" menu —
the GitHub Primer action-bar ladder.

* **Nothing is ever cut mid-word, and nothing is ever unreachable.**
  Every verb is in the bar or is a labelled row in the ⋯ menu.
* **Priority is declared, not inferred.** `pinned` = a mode control
  (never folded, never an icon; its only concession is a *designed*
  short form). `high` = pressed on nearly every pass through the
  stage. `medium` = a few times per section. `low` = escape hatches.
  A band is spent completely before the next one gives ground, so the
  verbs the engineer presses constantly keep their labels longest.
  Within a band the *trailing* control degrades first — a toolbar
  erodes from its far end so muscle memory keeps working.
* **`iconOnly: false` on two kinds of control**: destructive verbs (a
  bare trash icon is not an acceptable presentation for an
  irreversible action) and any control whose LABEL carries state the
  user must read without hovering (`qc: median`, `Correlate · click 2
  bands`). Those fold straight to a labelled menu row instead.
* **An icon-only control keeps its accessible name and tooltip** — the
  primitives move the label into `aria-label` + `title`.
* **Wide screens anchor, they do not distribute.** The stage verbs
  stay left-anchored and the global controls stay right-anchored; the
  middle is empty space. No max-width clamp, no control drifting to an
  unreachable centre.
* **A flex item with `overflow-hidden` has a ZERO automatic minimum
  size** (CSS Flexbox §4.5 — `min-width: auto` applies only while
  overflow is `visible`). Any bordered/rounded group in a toolbar row
  therefore needs `shrink-0`, or flexbox will pick it as the one item
  free to absorb the whole width deficit and its own clip will cut it
  mid-word. This is what produced "Geology | Litho | Geote".
* `toolbar-scrollable` on the shell's left zone stays as the last
  resort beneath all of this: a stage that has not adopted the
  responsive row, or a width estimate that comes up short, gets a thin
  horizontal scrollbar rather than a silent clip.

## Exports live in one place — the Export stage

Owner ruling (installer #35): the **Export stage is the only export surface**.
Every export is a card there, grouped by model level, each with its own scope
pickers (cross-section; model level where the card offers a choice), an Export
button and a "last saved" reminder. A card whose prerequisite is missing tells
the user what to do first instead of showing a dead button — the same
"tell-the-user-where-to-go" empty-state pattern the other stages use.

No toolbar owns an export any more. On a cross-section the Sections toolbar shows
one **Export…** verb that opens the Export stage with that section and axis
preselected; the 3-D Lithology / Geotechnical stages do the same with a single
**Export…** jump. A scattered export verb is a UX regression — new export targets
become new cards, never new toolbar buttons.

## Detail panels

* **Push-mode**, NOT overlay. The panel is a flex sibling that pushes
  the main view to a narrower width, so the user can interact with
  both. Apple HIG calls this an Inspector.
* **420 px fixed width** — wide enough for tables and small charts,
  narrow enough not to dominate.
* **Header** = title + nav (prev / next / close). **Body** = scrolls
  independently. **No sticky footer** — actions live in-place.
* **Close**: X button OR `Esc` key. Both must be wired.
* **Open via single-click** of the source item. No double-click.
* **Don't trap focus** — the panel coexists with the main view, so
  unlike a modal it must NOT trap keyboard focus. (HIG: Inspectors
  are non-modal.)

## Map

* **Shape encodes source kind, colour encodes property within kind.**
  ● Circle = CPT, ■ Square = Borehole. Within each kind, colour comes
  from the active filter axis (CPT type / drill method / borehole
  type). This satisfies WCAG "no info by colour alone".
* **Layout** (Leaflet defaults): zoom controls top-left, fit-to-data
  below them. Layer-control dropdown top-right (Option B — only one
  category expanded at a time). Legend bottom-right, mirrors marker
  shapes (circle vs. square).
* **Bbox draw**: drag a rectangle in crosshair mode; `Esc` cancels.
* **Tooltip on hover** = name + key fact; click = select + fly-to at
  zoom 17.
* **Hidden vs. removed**: layer-control hides per type (visual filter
  only); sidebar removes per ID (project-local persisted).

## Borelog

* **Vertical depth axis, top → down.** Domain convention; ISO 14688-1
  / DOV PDF style.
* **Lithology patterns** from ``soilPatterns.tsx`` — fine sand =
  small dots, clay = 45° hatching, glauconite = green V-chevrons,
  etc. Override of Primer because Primer doesn't ship soil patterns.
* **Zoom**: `Ctrl + wheel` adjusts vertical scale. `Ctrl + 0` resets.
  Wheel without `Ctrl` scrolls vertically as expected.
* **Selecting a sample auto-centers** its depth in the visible
  viewport (smooth scroll). Re-zooming keeps the sample centered.
* **Hidden / type-filtered rows** in the sidebar are still visible at
  `opacity-40`, partitioned to the bottom of the list — they're
  demoted, not removed. `Hidden (N)` separator with `EyeOff` icon.

## Destructive actions

The desktop UI distinguishes **reversible** from **irreversible**
actions:

* **Reversible** (project-local hide, sort change, theme switch) —
  fire immediately, no confirmation. Provide an undo path: the
  sidebar's `N removed · restore all` link is the canonical example.
* **Irreversible** (DB delete, file delete, project delete, sending
  external requests) — require an explicit confirmation dialog.
  Default-focus on Cancel, not the destructive action. Match the
  destructive button copy to the action ("Delete" / "Discard" /
  "Remove permanently") — never just "OK".

This once claimed the frontend had **no irreversible actions**. It
does. The close-without-save **Discard** replace-restores the whole
project in the database from the last-saved `.gmproj`, so every
correlation, boundary move and accepted suggestion made since that
save is gone; there is no undo. Its dialog therefore has to *name* the
loss — kinds of work, and counts where they exist — not describe it as
"changes". `UnsavedChangesDialog.tsx` is the worked example; the same
obligation lands on any new destructive flow.

The dialog's text is part of the safety rail, not decoration: a
confirmation whose copy under-states the damage is worse than none,
because it buys consent under a false premise. When you change what a
destructive handler does, re-read its dialog copy in the same commit.

**A safety rail must never become a trap.** The Discard's replace-restore
first passes a **save-anchor gate**: if the `.strix` on disk is not this
project's latest save, a blind revert would delete work the file never
held, so the gate refuses. That refusal used to dead-end — a toast, the
dialog re-opened, and a user who wanted his session *gone* had no way out
but Task Manager (owner report, installer #26). The refusal now opens a
**force-revert confirmation** (`ConfirmDialog` in `AppDialogs.tsx`, wired
from `useProjectLifecycle`): Cancel default-focused; a destructive,
named **"Revert to file and close"** that replaces the DB from the file
*regardless* of the anchor (`revertToLastSaved(true)`); and **Save** as
the non-destructive way out. The named-loss obligation still holds — the
body names the file and spells out that this session and everything saved
since are gone — so the protection is preserved by making the loss
explicit and consented, not by trapping the user. The gate logs both
anchors + the file path at WARNING when it refuses, so the divergence
(a save whose file write failed, or a stale copy opened against a DB the
bundled build persisted) is diagnosable from the log.

## Dark mode

* **Strategy**: `darkMode: 'class'` in Tailwind. The `useTheme` hook
  toggles a `dark` class on `<html>`. Three modes:
    1. `system` (default) — follows `prefers-color-scheme` and
       responds live when the OS preference changes.
    2. `light` — explicit override, persisted to
       `localStorage["groundmodel.theme"]`.
    3. `dark`  — same.
* **Token mapping**: every component MUST author colours as `dark:`
  variants when introduced. Migrating existing components to dark is
  a separate pass; new components write light + dark from day one.
* **Test contrast** in both modes — Primer's dark palette already
  hits WCAG AA against the recommended dark-surface backgrounds, but
  custom hues (soil patterns, marker fill colours derived from
  `hashColor`) need to be re-checked when displayed on a dark
  background.

## Translation & persistence

* **Translate at the presentation boundary, never at ingest** —
  domain stores raw DOV tokens; `desktop/src/renderer/src/utils/`
  hosts lookup tables (e.g. `soilColors.ts`, `labTestLabels.ts`).
* **Show the source token as a `title` tooltip** on every translated
  label so domain experts can verify the mapping without leaving the
  UI.
* **Persist user preferences in localStorage**, never in the `.gmproj`
  bundle (UI chrome is per-user, not a project decision). Two key shapes:
  * **Global** `groundmodel.<area>.<kind>` — for preferences that are
    the same wherever the user goes (theme, sidebar sort, map basemap,
    active shell stage, borelog hidden columns). This is the common
    case. e.g. `groundmodel.borelog.hidden_tracks`,
    `groundmodel.map.basemap`, `groundmodel.sidebar.sort`.
  * **Project-scoped** `groundmodel.<area>.<projectId>.<kind>` — ONLY
    when the value genuinely differs per project (e.g. the per-project
    session-import / removed sets). `usePersistedSet` is the canonical
    pattern for these.
  Always parse-guard reads (tolerate corrupt/manual-edited / unknown
  values; fall back to the default, never throw).

## Loading + error feedback

* **Async actions** — disable the trigger button while pending,
  show a spinner inside it; do NOT show a full-screen loader unless
  the action blocks all interaction (rare).
* **Toast notifications** for completion (success / error) of
  user-initiated bulk actions. Keep concise: 1 line, dismiss on
  click + auto-dismiss after 4 s.
* **Inline validation** for forms; never use a toast or alert box
  for "field X is invalid".
* **Empty states** — text + icon (Lucide), never just blank.

## Tutorial coach card

The guided-tutorial coach card (`tutorial/CoachCard.tsx`) sits beside the
spotlighted control, but the user can move it out of the way two ways so it
never blocks the work it points at:

* **Drag.** The card's header row is a grab handle (`cursor-grab`, native
  pointer events with pointer capture). A drag relocates the card, clamped
  inside the same `DOCK_MARGIN` the computed placement respects, and the
  dragged spot **overrides** the computed placement while the same step is
  shown (a window resize re-clamps but keeps it). A **step change re-places**
  the card, because the next anchor may be anywhere. A drop that would cover
  the spotlight snaps just off it (`nudgeCardOffSpotlight` in
  `coachCardPlacement.ts`) so the card never hides the control it points at.
* **Fold.** A chevron collapses the card to a compact pill ("Tutorial · step
  n/total") docked bottom-right. It stays folded across step changes until the
  user unfolds it, and the spotlight ring keeps working while folded so the
  user still sees where to click. The pill is a `<button>` (Enter/Space
  unfold). Folded state is session-only renderer state, never persisted.

Fold is also the **keyboard/single-pointer alternative** to the drag gesture
(WCAG 2.2 §2.5.7 Dragging Movements): a user who cannot drag can fold the card
to move it aside. Drag / fold state lives on the card, not the tutorial
machine (`tutorialMachine.ts`) — the do-it auto-advance and Next / Back / Skip
all keep working folded or unfolded.
