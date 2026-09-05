desktop.renderer.src.shell.stages.sections.SectionsInspector
============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-52

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 1-52
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the panel down the right side of the Sections stage. It hosts the cross-section list, the selected section's properties, the model-action verbs, the borehole-preview legend, the read-only formation list, the geological-backdrop picker, the crossings banner and the Virtuele Boring overlay controls. It imports the shell bus, the sub-dialogs and the small helpers each section uses.

**Why it is here.** All state is sourced from the shell (no props accepted) to match the inspector-component contract. The model-management verbs (Build, Sync, Seed, Dedupe) live here rather than in the toolbar (debt #97, owner directive 2026-05-22) because they act on a model, not a section, and belong next to the model rows.

.. CG-EXPLANATION-END id=module-header

``const NATURAL``
-----------------

.. CG-BLOCK id=const:NATURAL lines=53-73

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 53-73
   :lineno-match:

.. CG-EXPLANATION-START id=const:NATURAL

**What this does.** A number-aware string comparator used to order the section list.

**Why it is here.** Matches the ordering the old sidebar used, so section names like 'CS2' and 'CS10' sort in human order rather than character order.

.. CG-EXPLANATION-END id=const:NATURAL

``function SectionsInspector``
------------------------------

.. CG-BLOCK id=function:SectionsInspector lines=74-412

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 74-412
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionsInspector

**What this does.** The panel component. It reads the sections, models, formations, overlays and coordinator slices off the shell, resolves the selected section, wires the crossing-issue navigation (one candidate deep-links directly, several open a picker, none toasts), filters the formation list to the geological vocabulary only, and stacks its sections: the section list, the selected section's properties, the model actions, a borehole-preview legend (only while the overlay draws something), the read-only formation list, the backdrop picker (only with more than one geological model), the crossings banner, and the Virtuele Boring controls.

**Why it is here.** The formation list is filtered to geological formations because litho and geotech units belong in their own stages' inspectors — without the filter every litho unit would leak into this panel. The preview legend reads what the overlay ACTUALLY drew this frame (from a store), not a recomputed approximation, because the toolbar-era legend once claimed 'Hatched = preview' over an empty axis. The backdrop picker appears only for multi-model projects, since single-model projects have nothing to pick.

.. CG-EXPLANATION-END id=function:SectionsInspector

``function inspectorCollapseKey``
---------------------------------

.. CG-BLOCK id=function:inspectorCollapseKey lines=413-416

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 413-416
   :lineno-match:

.. CG-EXPLANATION-START id=function:inspectorCollapseKey

**What this does.** Builds the localStorage key that remembers whether one inspector section is open or closed, from a stable slug.

**Why it is here.** The key is built from a stable English slug, never the translated label, so a user's collapse state does not split across languages and the stored keys the tests assert stay stable.

.. CG-EXPLANATION-END id=function:inspectorCollapseKey

``function loadCollapseState``
------------------------------

.. CG-BLOCK id=function:loadCollapseState lines=417-427

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 417-427
   :lineno-match:

.. CG-EXPLANATION-START id=function:loadCollapseState

**What this does.** Reads a section's remembered open/closed state from localStorage, defaulting to open, and tolerating an unavailable store.

**Why it is here.** First-time users should see everything, so the default is open; the read is wrapped so a blocked or missing localStorage falls back to the default rather than throwing.

.. CG-EXPLANATION-END id=function:loadCollapseState

``interface InspectorSectionProps``
-----------------------------------

.. CG-BLOCK id=interface:InspectorSectionProps lines=428-469

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 428-469
   :lineno-match:

.. CG-EXPLANATION-START id=interface:InspectorSectionProps

**What this does.** The inputs to one collapsible inspector section: a stable id (for the collapse key and panel id), a label, an optional count, an optional badge and whether the badge is amber, plus the content.

**Why it is here.** The id is separate from the label because the label is translated and keying persistence on it would break both the stored state and the tests.

.. CG-EXPLANATION-END id=interface:InspectorSectionProps

``function InspectorSection``
-----------------------------

.. CG-BLOCK id=function:InspectorSection lines=470-541

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 470-541
   :lineno-match:

.. CG-EXPLANATION-START id=function:InspectorSection

**What this does.** Renders a labelled collapsible section — a chevron header that toggles the content and persists the choice to localStorage, with an optional count and status badge. The header is a real button with the expanded/controls accessibility attributes.

**Why it is here.** The button plus those attributes let keyboard users toggle with Space/Enter and screen readers announce the state. Persisting the choice means the user's collapsed sections survive a refresh.

.. CG-EXPLANATION-END id=function:InspectorSection

``interface SectionListProps``
------------------------------

.. CG-BLOCK id=interface:SectionListProps lines=542-582

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 542-582
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionListProps

**What this does.** The section list's inputs: the sections, the selected id, select/create/delete callbacks, whether create is allowed, the set of unsaved-this-session ids, and the translator.

**Why it is here.** The unsaved-id set drives the amber marker on freshly-created sections, at parity with CPT and borehole rows elsewhere.

.. CG-EXPLANATION-END id=interface:SectionListProps

``function SectionList``
------------------------

.. CG-BLOCK id=function:SectionList lines=583-661

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 583-661
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionList

**What this does.** Renders the ordered cross-section list with a create button at the top. It sorts by display order then natural name, disables create when no horizontal CRS is set, and shows an empty-state line otherwise. Creating a section auto-selects it.

**Why it is here.** Create is disabled without a metric horizontal CRS because along-section distance is a Euclidean distance in CRS units, so degrees would silently produce garbage geometry (debt #31). Auto-select matches the toolbar's New button so both entry points behave the same.

.. CG-EXPLANATION-END id=function:SectionList

``interface SectionRowProps``
-----------------------------

.. CG-BLOCK id=interface:SectionRowProps lines=662-691

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 662-691
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionRowProps

**What this does.** One row's inputs: the section, whether it is selected, whether it is unsaved, and the click and delete callbacks, plus the translator.

**Why it is here.** The unsaved flag gives the row its amber left border; the rest are the standard select/delete affordances.

.. CG-EXPLANATION-END id=interface:SectionRowProps

``function SectionRow``
-----------------------

.. CG-BLOCK id=function:SectionRow lines=692-825

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 692-825
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionRow

**What this does.** Renders one section row — an icon, the display name (with a dirty asterisk when unsaved), the length and buffer, and a hover-revealed delete button that opens a confirmation modal. Delete fires only after the modal is confirmed.

**Why it is here.** Deleting a section is irreversible, so per docs/ux.md it opens a modal with default focus on Cancel and a button that names the action, replacing a bare browser confirm; the busy flag stops Escape or a backdrop click from dismissing it mid-request.

.. CG-EXPLANATION-END id=function:SectionRow

``interface SectionPropertiesProps``
------------------------------------

.. CG-BLOCK id=interface:SectionPropertiesProps lines=826-855

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 826-855
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionPropertiesProps

**What this does.** The properties panel's inputs: the selected section, a patch callback, and the translator.

**Why it is here.** The patch callback commits name, buffer and exaggeration changes; the section carries the current values the sliders start from.

.. CG-EXPLANATION-END id=interface:SectionPropertiesProps

``function SectionProperties``
------------------------------

.. CG-BLOCK id=function:SectionProperties lines=856-1021

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 856-1021
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionProperties

**What this does.** Renders the selected section's editable properties: an inline-editable name (click to edit, commit on blur/Enter, cancel on Escape), and two sliders — projection buffer and vertical exaggeration — that patch on release. Local slider and name state reset only when the SELECTED SECTION changes.

**Why it is here.** The reset is keyed on the section id, not on the values, so a server echo after a patch does not flicker the slider back to the last-committed value mid-release or clobber an in-progress rename. A blank name falls back to the prior name (docs/ux.md: no blank names).

.. CG-EXPLANATION-END id=function:SectionProperties

``interface FormationListProps``
--------------------------------

.. CG-BLOCK id=interface:FormationListProps lines=1022-1059

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 1022-1059
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FormationListProps

**What this does.** The formation list's input: the formations to render, each with id, name, colour and display order.

**Why it is here.** A minimal shape — the list is read-only and the per-formation staleness lives on the header badge, not the rows.

.. CG-EXPLANATION-END id=interface:FormationListProps

``function FormationList``
--------------------------

.. CG-BLOCK id=function:FormationList lines=1060-1096

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 1060-1096
   :lineno-match:

.. CG-EXPLANATION-START id=function:FormationList

**What this does.** Renders the geological formations as a read-only list, sorted DESCENDING by display order — youngest and shallowest at the top, oldest and deepest at the bottom — each with a colour swatch and its order number.

**Why it is here.** Descending matches how a geologist reads a borehole log or the DOV description, surface-to-depth. This is a presentation sort only: the renderer and the 3-D stack still iterate ascending so older formations paint first and younger paint on top (superposition), which reversing the list here does not touch.

.. CG-EXPLANATION-END id=function:FormationList

``interface CrossingsBannerProps``
----------------------------------

.. CG-BLOCK id=interface:CrossingsBannerProps lines=1097-1133

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 1097-1133
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CrossingsBannerProps

**What this does.** The crossings banner's inputs: the project and model ids, a refresh signal, the stale-surface count, and a callback to open the offending cross-section.

**Why it is here.** The stale count is passed so the banner can suppress an untrustworthy warning while the TIN is out of date; the refresh signal re-fetches after every contact mutation.

.. CG-EXPLANATION-END id=interface:CrossingsBannerProps

``function CrossingsBanner``
----------------------------

.. CG-BLOCK id=function:CrossingsBanner lines=1134-1248

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 1134-1248
   :lineno-match:

.. CG-EXPLANATION-START id=function:CrossingsBanner

**What this does.** Fetches and renders surface-crossing issues for the active model. It shows a 'check failed' amber note when validation errored, a neutral 'Build to check' line when the surfaces are stale, nothing when the model is fresh and clean, and otherwise an amber warning listing the issues — each clickable to open its cross-section.

**Why it is here.** Validation is stale-gated (debt #18): a stale cache is not validated, so a neutral pending line shows instead of an untrustworthy warning, and it re-validates once Build clears the stale flag. A failed check produces an empty issue list — the same shape as a clean model — so it says so explicitly rather than letting silence read as 'no crossings' (audit F10). Body text uses the high-contrast token in light mode because amber-on-amber failed WCAG at 11px.

.. CG-EXPLANATION-END id=function:CrossingsBanner

``interface ModelActionsProps``
-------------------------------

.. CG-BLOCK id=interface:ModelActionsProps lines=1249-1292

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 1249-1292
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ModelActionsProps

**What this does.** The model-actions row's inputs: the translator, the axis, the active geological and litho models, the stale count, the backdrop override, the open section, the visible boreholes, the contacts, and the handlers behind Build, Dedupe, Seed and backdrop-load, plus the section-update callback.

**Why it is here.** Return types are deliberately left unspecified because these handlers return counts the inspector does not consume — that avoids brittle prop-type churn when a bus signature grows a return value.

.. CG-EXPLANATION-END id=interface:ModelActionsProps

``function ModelActions``
-------------------------

.. CG-BLOCK id=function:ModelActions lines=1293-1540

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsInspector.tsx
   :language: tsx
   :lines: 1293-1540
   :lineno-match:

.. CG-EXPLANATION-START id=function:ModelActions

**What this does.** Renders the axis-aware model verbs: Build (with an amber stale badge on the geology axis), then on the litho axis Sync geology, or on the geological axis Seed and Seed-for-new-tests; and Dedupe (behind a confirmation dialog naming the duplicates). Seed-for-new-tests is scoped to boreholes with no contacts yet.

**Why it is here.** These verbs act on the GEOLOGICAL model regardless of axis (litho TINs are derived), so they gate on the geological model and the geology axis, or they would silently write to the wrong model. Dedupe database-deletes contacts with no way back, so it opens a confirmation that names the loss (the maintenance verb never had that gate) rather than firing. Seed-for-new-tests lets a fresh import be seeded without re-touching already-accepted boreholes.

.. CG-EXPLANATION-END id=function:ModelActions

