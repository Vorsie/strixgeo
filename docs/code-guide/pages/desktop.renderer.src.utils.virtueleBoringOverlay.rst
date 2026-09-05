desktop.renderer.src.utils.virtueleBoringOverlay
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/virtueleBoringOverlay.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/virtueleBoringOverlay.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../desktop/src/renderer/src/utils/virtueleBoringOverlay.ts
   :language: typescript
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** State utilities for the Virtuele Boring (DOV synthetic-borehole) overlay. The comment records where the project-level state is persisted (in ``project.view_state.virtuele_boring``, stored opaquely by the server) and its shape: two model slots (each a DOV lagenmodel code or nothing for "off", driving two side-by-side ghost columns on the section view) and a maximum depth in metres. It imports the shared view-state bag reader.

**Why it is here.** The comment records two decisions: the 30 m default depth matches typical CPT and borehole depth, so the overlay reads as "what is relevant to this test" rather than DOV's full crustal column down to bedrock; and the per-pane visibility lives in localStorage because it is per-user screen chrome, not a project-level engineering decision — the rule that decisions live in the project bundle and localStorage holds only UI preferences.

.. CG-EXPLANATION-END id=module-header

``interface VirtueleBoringOverlayState``
----------------------------------------

.. CG-BLOCK id=interface:VirtueleBoringOverlayState lines=28-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/virtueleBoringOverlay.ts
   :language: typescript
   :lines: 28-37
   :lineno-match:

.. CG-EXPLANATION-START id=interface:VirtueleBoringOverlayState

**What this does.** The overlay's state shape: ``modelA`` and ``modelB`` (each a model code or nothing when the slot is off) and ``maxDepthM`` (a clip in metres below each investigation's surface, or nothing for no clip).

**Why it is here.** Names the project-level overlay state the section view reads and writes.

.. CG-EXPLANATION-END id=interface:VirtueleBoringOverlayState

``const DEFAULT_VIRTUELE_BORING_OVERLAY``
-----------------------------------------

.. CG-BLOCK id=const:DEFAULT_VIRTUELE_BORING_OVERLAY lines=38-44

.. literalinclude:: ../../../desktop/src/renderer/src/utils/virtueleBoringOverlay.ts
   :language: typescript
   :lines: 38-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_VIRTUELE_BORING_OVERLAY

**What this does.** The default state: both slots off, 30 m depth.

**Why it is here.** The comment records that 30 m matches typical investigation depth so the overlay stays relevant rather than showing the full column.

.. CG-EXPLANATION-END id=const:DEFAULT_VIRTUELE_BORING_OVERLAY

``const VIRTUELE_BORING_VIEW_STATE_KEY``
----------------------------------------

.. CG-BLOCK id=const:VIRTUELE_BORING_VIEW_STATE_KEY lines=45-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/virtueleBoringOverlay.ts
   :language: typescript
   :lines: 45-49
   :lineno-match:

.. CG-EXPLANATION-START id=const:VIRTUELE_BORING_VIEW_STATE_KEY

**What this does.** The JSON key inside ``project.view_state`` that owns the overlay state, followed by the comment on the depth bounds below.

**Why it is here.** Naming the key once keeps the read and the write from drifting onto different names.

.. CG-EXPLANATION-END id=const:VIRTUELE_BORING_VIEW_STATE_KEY

``const VIRTUELE_BORING_MAX_DEPTH_MIN_M``
-----------------------------------------

.. CG-BLOCK id=const:VIRTUELE_BORING_MAX_DEPTH_MIN_M lines=50-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/virtueleBoringOverlay.ts
   :language: typescript
   :lines: 50-50
   :lineno-match:

.. CG-EXPLANATION-START id=const:VIRTUELE_BORING_MAX_DEPTH_MIN_M

**What this does.** The smallest depth clip the control accepts, 1 m.

**Why it is here.** The comment records that 1 m is the minimum meaningful clip.

.. CG-EXPLANATION-END id=const:VIRTUELE_BORING_MAX_DEPTH_MIN_M

``const VIRTUELE_BORING_MAX_DEPTH_MAX_M``
-----------------------------------------

.. CG-BLOCK id=const:VIRTUELE_BORING_MAX_DEPTH_MAX_M lines=51-62

.. literalinclude:: ../../../desktop/src/renderer/src/utils/virtueleBoringOverlay.ts
   :language: typescript
   :lines: 51-62
   :lineno-match:

.. CG-EXPLANATION-START id=const:VIRTUELE_BORING_MAX_DEPTH_MAX_M

**What this does.** The largest depth clip the control accepts, 1000 m, followed by the reader's docstring.

**Why it is here.** The comment records that 1000 m covers any realistic mining-depth survey while still bounding a runaway value from a hand-edited project bundle.

.. CG-EXPLANATION-END id=const:VIRTUELE_BORING_MAX_DEPTH_MAX_M

``function readVirtueleBoringOverlay``
--------------------------------------

.. CG-BLOCK id=function:readVirtueleBoringOverlay lines=63-94

.. literalinclude:: ../../../desktop/src/renderer/src/utils/virtueleBoringOverlay.ts
   :language: typescript
   :lines: 63-94
   :lineno-match:

.. CG-EXPLANATION-START id=function:readVirtueleBoringOverlay

**What this does.** Pulls the overlay state out of the view_state bag with sensible defaults. It reads the bag (returning the defaults when it is absent), then validates the depth (an explicit nothing means no clip; a finite in-range number is kept; anything else falls back to the default), and coerces each model slot to a non-empty string or nothing. It is followed by the active-models docstring.

**Why it is here.** The docstring records that it is tolerant of hand-edited or migrated bundles — it never throws and always returns a usable shape — so a bad stored value cannot render an invisible or endless overlay forever. This is the best-effort view_state persistence rule.

.. CG-EXPLANATION-END id=function:readVirtueleBoringOverlay

``function activeOverlayModels``
--------------------------------

.. CG-BLOCK id=function:activeOverlayModels lines=95-113

.. literalinclude:: ../../../desktop/src/renderer/src/utils/virtueleBoringOverlay.ts
   :language: typescript
   :lines: 95-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:activeOverlayModels

**What this does.** Returns the currently-active (non-null) model codes in A-then-B order, dropping a duplicate when both slots hold the same model. It is followed by the section comment that introduces per-pane visibility.

**Why it is here.** The comment records both choices: an empty list when both slots are off lets callers skip the predictions fetch instead of hitting the backend with an empty query, and de-duplicating avoids two identical ghost columns confusing the UI.

.. CG-EXPLANATION-END id=function:activeOverlayModels

``type VirtueleBoringPane``
---------------------------

.. CG-BLOCK id=type:VirtueleBoringPane lines=114-115

.. literalinclude:: ../../../desktop/src/renderer/src/utils/virtueleBoringOverlay.ts
   :language: typescript
   :lines: 114-115
   :lineno-match:

.. CG-EXPLANATION-START id=type:VirtueleBoringPane

**What this does.** The three panes that can show the overlay independently: the section view, the CPT detail panel, and the borehole detail panel.

**Why it is here.** Names the panes whose visibility and model override are tracked separately.

.. CG-EXPLANATION-END id=type:VirtueleBoringPane

``const DEFAULT_PANE_VISIBILITY``
---------------------------------

.. CG-BLOCK id=const:DEFAULT_PANE_VISIBILITY lines=116-127

.. literalinclude:: ../../../desktop/src/renderer/src/utils/virtueleBoringOverlay.ts
   :language: typescript
   :lines: 116-127
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_PANE_VISIBILITY

**What this does.** The default on/off state per pane: the section view on, the CPT and borehole detail panes off.

**Why it is here.** The comment records the reasoning: the section view defaults on so that picking a model there shows the ghost columns without a second click, while the detail panes default off because opting into the overlay on the section view should not burst it into the CPT chart or borelog without an explicit click.

.. CG-EXPLANATION-END id=const:DEFAULT_PANE_VISIBILITY

``function paneStorageKey``
---------------------------

.. CG-BLOCK id=function:paneStorageKey lines=128-139

.. literalinclude:: ../../../desktop/src/renderer/src/utils/virtueleBoringOverlay.ts
   :language: typescript
   :lines: 128-139
   :lineno-match:

.. CG-EXPLANATION-START id=function:paneStorageKey

**What this does.** Builds the localStorage key for a pane's visibility, keyed by project id (returning nothing when there is no project). It is followed by the reader docstring.

**Why it is here.** The comment records that keying by project id lets the same setting be tuned differently per project; with no project id there is nothing to store.

.. CG-EXPLANATION-END id=function:paneStorageKey

``function readPaneVisibility``
-------------------------------

.. CG-BLOCK id=function:readPaneVisibility lines=140-161

.. literalinclude:: ../../../desktop/src/renderer/src/utils/virtueleBoringOverlay.ts
   :language: typescript
   :lines: 140-161
   :lineno-match:

.. CG-EXPLANATION-START id=function:readPaneVisibility

**What this does.** Reads whether a pane currently shows the overlay: the per-pane default when there is no project id or no localStorage, otherwise a stored "1" means on and "0" means off, tolerating any corrupt value. It is followed by the writer docstring.

**Why it is here.** The docstring and comment record that it returns the default on a test mount, the welcome screen, or when localStorage is unavailable, and the read is wrapped so a quota or private-mode failure falls through to the default — the guarded-read pattern.

.. CG-EXPLANATION-END id=function:readPaneVisibility

``function writePaneVisibility``
--------------------------------

.. CG-BLOCK id=function:writePaneVisibility lines=162-193

.. literalinclude:: ../../../desktop/src/renderer/src/utils/virtueleBoringOverlay.ts
   :language: typescript
   :lines: 162-193
   :lineno-match:

.. CG-EXPLANATION-START id=function:writePaneVisibility

**What this does.** Persists a pane's visibility, doing nothing when there is no project id or localStorage is not writable. It is followed by the section comment introducing the per-pane model override.

**Why it is here.** The comment records that a storage failure is ignored because the caller's UI still reflects the new value through React state, so the in-memory state stays consistent.

.. CG-EXPLANATION-END id=function:writePaneVisibility

``function paneModelStorageKey``
--------------------------------

.. CG-BLOCK id=function:paneModelStorageKey lines=194-206

.. literalinclude:: ../../../desktop/src/renderer/src/utils/virtueleBoringOverlay.ts
   :language: typescript
   :lines: 194-206
   :lineno-match:

.. CG-EXPLANATION-START id=function:paneModelStorageKey

**What this does.** Builds the localStorage key for a pane's model override, keyed by project id (nothing when there is no project). It is followed by the reader docstring.

**Why it is here.** The override is stored per project and per pane, the same keying pattern as the visibility flag.

.. CG-EXPLANATION-END id=function:paneModelStorageKey

``function readPaneModelOverride``
----------------------------------

.. CG-BLOCK id=function:readPaneModelOverride lines=207-226

.. literalinclude:: ../../../desktop/src/renderer/src/utils/virtueleBoringOverlay.ts
   :language: typescript
   :lines: 207-226
   :lineno-match:

.. CG-EXPLANATION-START id=function:readPaneModelOverride

**What this does.** Reads the active model override for a detail pane: an empty string (the default) means "follow the section", and a specific code means show only that one ghost column. It tolerates a missing project id or unavailable localStorage.

**Why it is here.** The comment records that an empty string means follow the section's selection, which the caller treats as "no override" and falls back to the section's own modelA / modelB — the same guarded read as the visibility reader.

.. CG-EXPLANATION-END id=function:readPaneModelOverride

``function writePaneModelOverride``
-----------------------------------

.. CG-BLOCK id=function:writePaneModelOverride lines=227-239

.. literalinclude:: ../../../desktop/src/renderer/src/utils/virtueleBoringOverlay.ts
   :language: typescript
   :lines: 227-239
   :lineno-match:

.. CG-EXPLANATION-START id=function:writePaneModelOverride

**What this does.** Persists a pane's model override; an empty string clears the override back to "follow the section". It does nothing when there is no project id or localStorage is not writable.

**Why it is here.** The comment records that it silently ignores quota or private-mode failures, the same fallback as the other writers.

.. CG-EXPLANATION-END id=function:writePaneModelOverride

