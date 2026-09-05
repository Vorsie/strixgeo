desktop.renderer.src.components.SettingsDialog
==============================================

.. CG-PAGE source=desktop/src/renderer/src/components/SettingsDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/SettingsDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../desktop/src/renderer/src/components/SettingsDialog.tsx
   :language: tsx
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and imports for the Settings dialog, opened from File → Settings… (Ctrl+,). The comment explains its layout — a left rail of section names with a right pane of controls, showing one section at a time — and that each section has its own Save button. The imports bring in some icons, the ``useEffect`` and ``useState`` hooks, the shared ``Button``, ``Modal`` and ``NumericInput`` building blocks, the theme type, the language list and switcher, the translator, and three bundles of preference defaults and allowed ranges: the litho segmenter, the geotech subdivision, and the section defaults.

**Why it is here.** The header comment records the one thing that makes this dialog unusual: its settings live in two different places. Most of them ride inside the project's saved state and travel with the ``.strix`` bundle, so they are per-project; the Appearance section (theme and language) is per-machine and saved in *localStorage* — a small per-user store in the browser that survives a reload and holds only screen preferences, never engineering decisions (memory). Each section shows its scope so a colleague opening your bundle understands why your theme did not follow the file. Showing one section at a time also stops the user editing two sections and losing track of which Save applies to what.

.. CG-EXPLANATION-END id=module-header

``type SectionKey``
-------------------

.. CG-BLOCK id=type:SectionKey lines=42-43

.. literalinclude:: ../../../desktop/src/renderer/src/components/SettingsDialog.tsx
   :language: tsx
   :lines: 42-43
   :lineno-match:

.. CG-EXPLANATION-START id=type:SectionKey

**What this does.** Names the four settings sections by a short code: litho, geotech, sections, appearance.

**Why it is here.** Fixing the set of section names in one *type* (a note checked before the app runs) means the rail, the active-section tracker and the body branches can never disagree on which sections exist.

.. CG-EXPLANATION-END id=type:SectionKey

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=44-63

.. literalinclude:: ../../../desktop/src/renderer/src/components/SettingsDialog.tsx
   :language: tsx
   :lines: 44-63
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Declares the dialog's inputs (its *props*, introduced on the ``ProjectMetadataDialog`` page): whether it is open, whether a project is loaded, the three starting preference sets, the current theme, a cancel handler, and four callbacks — one to save each of the litho, geotech and section preference sets, and one to change the theme.

**Why it is here.** The three preference callbacks and the theme callback are split on purpose, and the comment on the theme prop says why: theme is reversible screen chrome, so it applies immediately with no Save click, exactly like every other appearance toggle — whereas the three preference sets are per-project and go through an explicit Save (the two-stage save: the callback updates the app's live state, and File → Save later writes it to disk).

.. CG-EXPLANATION-END id=interface:Props

``const SECTIONS``
------------------

.. CG-BLOCK id=const:SECTIONS lines=64-75

.. literalinclude:: ../../../desktop/src/renderer/src/components/SettingsDialog.tsx
   :language: tsx
   :lines: 64-75
   :lineno-match:

.. CG-EXPLANATION-START id=const:SECTIONS

**What this does.** The rail's contents: for each section, its code, the catalogue key for its label, its icon, and whether its scope is the project or the device.

**Why it is here.** The comment flags a subtle trap it avoids: the list carries label KEYS, not the finished words. Because the list is built once when the file loads, storing rendered text would freeze the rail in whatever language the app started in; storing keys lets the translator produce the right words on every redraw — the translate-at-the-presentation-boundary rule (CLAUDE.md).

.. CG-EXPLANATION-END id=const:SECTIONS

``function SettingsDialog``
---------------------------

.. CG-BLOCK id=function:SettingsDialog lines=76-210

.. literalinclude:: ../../../desktop/src/renderer/src/components/SettingsDialog.tsx
   :language: tsx
   :lines: 76-210
   :lineno-match:

.. CG-EXPLANATION-START id=function:SettingsDialog

**What this does.** The dialog component. It calls the translator and keeps four remembered values: which section is active, and a working draft of each of the three preference sets. A ``useEffect`` re-seeds the three drafts from their starting values every time the dialog opens, while leaving the active tab where the user last left it. After an early ``return`` that draws nothing when closed, it renders a ``Modal`` (the blocking dialog window introduced on the ``ProjectMetadataDialog`` page) holding a titled header, the left rail of section buttons, and a right pane that shows exactly one section's controls depending on which tab is active, plus a Close button in the footer.

**Why it is here.** Re-seeding the drafts on open means a Cancel in one session never leaks stale edits into the next, and it also picks up any change made elsewhere (say, a colleague's edit merged into the bundle in another window); the comment notes the active tab is deliberately NOT reset because which tab you were on is a passing screen choice, not a saved preference. The rail entries are real buttons so the keyboard can focus and activate them, and are marked up as tabs for assistive tools.

.. CG-EXPLANATION-END id=function:SettingsDialog

``function LithoSection``
-------------------------

.. CG-BLOCK id=function:LithoSection lines=211-485

.. literalinclude:: ../../../desktop/src/renderer/src/components/SettingsDialog.tsx
   :language: tsx
   :lines: 211-485
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithoSection

**What this does.** The litho-segmenter settings section. It reads the allowed range for each knob, works out whether each current value is a finite number inside its range, combines those into one all-valid flag, and works out whether anything changed from the starting values (the dirty flag). It then draws a titled shell containing a row per setting — minimum layer thickness, unsaturated unit weight, the relative-density compression factor, three checkboxes (merge same lithology, use normalised cone resistance, fill at the section line), snap tolerance, the auto-correlate depth window, the open-extent length, and a voxel-size heading with a horizontal and a vertical cell-size row — ending in a footer with Reset-to-defaults and Save.

**Why it is here.** Each numeric knob is range-checked so a nonsense value cannot be saved, and the dirty flag keeps Save meaningful — you can only save when something actually changed and everything is valid. These knobs steer the litho segmenter and the 3-D voxel builder, so they are per-project and travel with the bundle. The comment on the voxel block explains the separate horizontal and vertical cell sizes: geology is thin-layered vertically, so a fine vertical cell over a coarse horizontal one catches thin layers without exploding the number of cells across the map plane. The relative-density factor is a characterisation-only input (relative density Dr is an MVP characterisation output, not a design parameter — MVP scope).

.. CG-EXPLANATION-END id=function:LithoSection

``function GeotechSection``
---------------------------

.. CG-BLOCK id=function:GeotechSection lines=486-586

.. literalinclude:: ../../../desktop/src/renderer/src/components/SettingsDialog.tsx
   :language: tsx
   :lines: 486-586
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeotechSection

**What this does.** The geotechnical NAD-subdivision settings section (the "Subdivide all bodies" step). It exposes a minimum-thickness knob, a gradient-snap on/off toggle, and — only while snap is on — the snap window. It computes the same style of per-field validity, an all-valid flag that skips the snap-window check when snap is off, and a dirty flag, then draws the rows and the Reset/Save footer.

**Why it is here.** It is exported (unlike the other sections) so the conditional validity logic — the way the snap-window check is skipped when snap is disabled — can be tested on its own without driving the whole dialog, as its docstring states. These are the thresholds for splitting a litho body into NAD packing classes (a characterisation output, NBN EN 1997-1 ANB Tabel 2.1 — the Belgian annex), so they are per-project and ride with the bundle.

.. CG-EXPLANATION-END id=function:GeotechSection

``function SectionsSection``
----------------------------

.. CG-BLOCK id=function:SectionsSection lines=587-688

.. literalinclude:: ../../../desktop/src/renderer/src/components/SettingsDialog.tsx
   :language: tsx
   :lines: 587-688
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionsSection

**What this does.** The cross-sections settings section. It exposes three knobs — the corridor buffer width, the vertical exaggeration, and the tie-strike tolerance — each range-checked, with a dirty flag and the standard Reset/Save footer.

**Why it is here.** These are the defaults a new cross-section is created with; like the other model settings they are per-project and travel with the bundle. Vertical exaggeration stretches the depth axis so thin layers are readable — a display choice, so it lives with the project's own view preferences.

.. CG-EXPLANATION-END id=function:SectionsSection

``function AppearanceSection``
------------------------------

.. CG-BLOCK id=function:AppearanceSection lines=689-768

.. literalinclude:: ../../../desktop/src/renderer/src/components/SettingsDialog.tsx
   :language: tsx
   :lines: 689-768
   :lineno-match:

.. CG-EXPLANATION-START id=function:AppearanceSection

**What this does.** The Appearance section: a language dropdown and a theme dropdown (system, light or dark). The language dropdown lists every language written in its own language and switches immediately; the theme dropdown calls the change handler immediately.

**Why it is here.** Both settings apply the moment they change, with no Save button, because they are reversible per-device chrome — theme and language are stored in localStorage, not in the project bundle (memory). The comment explains the language is read through a hook rather than passed in as a prop for the same reason as the theme: it is immediate reversible chrome, and threading it through the top of the app would touch code that has no other reason to know about it. Listing each language in its own script (Nederlands, not "Dutch") is so a speaker scans for the word they recognise.

.. CG-EXPLANATION-END id=function:AppearanceSection

``function SectionShell``
-------------------------

.. CG-BLOCK id=function:SectionShell lines=769-793

.. literalinclude:: ../../../desktop/src/renderer/src/components/SettingsDialog.tsx
   :language: tsx
   :lines: 769-793
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionShell

**What this does.** A small wrapper each section draws inside: it shows the section title, a scope badge next to it, a one-line description, and then the section's controls.

**Why it is here.** Every section needs the same title-plus-scope-plus-blurb frame, so it is written once and reused, keeping the four sections visually consistent.

.. CG-EXPLANATION-END id=function:SectionShell

``function ScopeBadge``
-----------------------

.. CG-BLOCK id=function:ScopeBadge lines=794-806

.. literalinclude:: ../../../desktop/src/renderer/src/components/SettingsDialog.tsx
   :language: tsx
   :lines: 794-806
   :lineno-match:

.. CG-EXPLANATION-START id=function:ScopeBadge

**What this does.** A tiny muted label reading either "project" or "device", shown beside a section's title.

**Why it is here.** As the comment says, it lets the user see at a glance whether a section's settings travel with the ``.strix`` bundle or stay on this machine — the same two-scope split the header comment introduced — using quiet colours so it does not fight the title.

.. CG-EXPLANATION-END id=function:ScopeBadge

``function SectionFooter``
--------------------------

.. CG-BLOCK id=function:SectionFooter lines=807-843

.. literalinclude:: ../../../desktop/src/renderer/src/components/SettingsDialog.tsx
   :language: tsx
   :lines: 807-843
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionFooter

**What this does.** The shared footer for the three project-scoped sections: an amber note when no project is open, a Reset-to-defaults button, and a Save button. Save is disabled unless something changed, everything is valid, and a project is open.

**Why it is here.** Gating Save on dirty-and-valid-and-has-project stops a save that would do nothing, save an out-of-range value, or save with no project to save into. The "needs a project" note is amber, matching the app's rule that amber (never red) marks a soft, non-error state (memory).

.. CG-EXPLANATION-END id=function:SectionFooter

``function NumberRow``
----------------------

.. CG-BLOCK id=function:NumberRow lines=844-921

.. literalinclude:: ../../../desktop/src/renderer/src/components/SettingsDialog.tsx
   :language: tsx
   :lines: 844-921
   :lineno-match:

.. CG-EXPLANATION-START id=function:NumberRow

**What this does.** One numeric setting: a label, a slider paired with a typed number box, an optional unit, and a hint line. The slider is clamped to its own range while the typed box accepts the full allowed range and flags an out-of-range value with a red border.

**Why it is here.** The slider range is usually narrower than the input range (per the comment) so the slider stays useful for everyday values while the box still allows the full range the engine accepts. The typed box is the app's locale-tolerant ``NumericInput`` — it accepts both a comma and a dot as the decimal separator and blocks stray letters — because a plain number field misbehaves across locales; an out-of-range value is still allowed to sit in the box so the user can clear and retype, with the red border (danger colour, this being a validation error, not an unsaved state) showing it will not save.

.. CG-EXPLANATION-END id=function:NumberRow

``function CheckboxRow``
------------------------

.. CG-BLOCK id=function:CheckboxRow lines=922-957

.. literalinclude:: ../../../desktop/src/renderer/src/components/SettingsDialog.tsx
   :language: tsx
   :lines: 922-957
   :lineno-match:

.. CG-EXPLANATION-START id=function:CheckboxRow

**What this does.** One on/off setting: a checkbox with a label and a hint line, dimmed and unclickable when disabled.

**Why it is here.** A reused row so every toggle in the dialog looks and behaves the same, with the label tied to the checkbox so clicking either the box or the words works.

.. CG-EXPLANATION-END id=function:CheckboxRow

