desktop.renderer.src.utils.lithoSegmenterPrefs
==============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/lithoSegmenterPrefs.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/lithoSegmenterPrefs.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoSegmenterPrefs.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the imports. This file holds the per-project settings for the litho segmenter (the "Suggest" verb) and stores them inside the project's saved view-state. It imports the suggest request shape and two shared view-state readers.

**Why it is here.** The comment records that the settings live in the .gmproj project bundle so a user's tuning round-trips across save and reload and travels with the file. They are per-project — not per-user or per-machine — because different projects have different sampling resolutions and geological scales, and because the project file is the unit of sharing, so a machine-only preference would be invisible to a colleague opening the same file (CLAUDE.md "Project files"). A forward-compatibility note records that a future per-soil unit-weight table will join the bag without breaking the current single value.

.. CG-EXPLANATION-END id=module-header

``interface LithoSegmenterPrefs``
---------------------------------

.. CG-BLOCK id=interface:LithoSegmenterPrefs lines=26-98

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoSegmenterPrefs.ts
   :language: typescript
   :lines: 26-98
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoSegmenterPrefs

**What this does.** The shape of the segmenter settings: minimum layer thickness, soil unit weight above the water table, the sand relative-density compression factor, whether same-lithology segments merge, whether to use the stress-normalised classifier, the litho-to-geology snap tolerance, the auto-correlate depth window, the open-extent draw length, the section-fill sampling mode, and the horizontal and vertical voxel cell sizes.

**Why it is here.** The docstrings record each field's default, allowed range and geotechnical meaning: the 0.15 m minimum thickness matches typical CPT sampling; the 16 kN/m3 unit weight is a project-wide value until a per-soil table arrives; the 0.675 relative-density factor is Jamiolkowski's "average quartz"; merging same lithology is on by owner directive (2026-05-25). The normalised toggle chooses between the stress-normalised Robertson 2015 pipeline (Qtn / F / Ic) and the non-normalised Robertson 2010 index (which needs no stress or water-table profile but leaves relative density and NAD packing blank, since those need effective stress) — these are characterisation outputs, not design values.

.. CG-EXPLANATION-END id=interface:LithoSegmenterPrefs

``const LITHO_SEGMENTER_DEFAULTS``
----------------------------------

.. CG-BLOCK id=const:LITHO_SEGMENTER_DEFAULTS lines=99-112

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoSegmenterPrefs.ts
   :language: typescript
   :lines: 99-112
   :lineno-match:

.. CG-EXPLANATION-START id=const:LITHO_SEGMENTER_DEFAULTS

**What this does.** The default value for every setting in the bag.

**Why it is here.** These are the per-field fall-backs used whenever nothing valid is stored.

.. CG-EXPLANATION-END id=const:LITHO_SEGMENTER_DEFAULTS

``const LITHO_SEGMENTER_BOUNDS``
--------------------------------

.. CG-BLOCK id=const:LITHO_SEGMENTER_BOUNDS lines=113-123

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoSegmenterPrefs.ts
   :language: typescript
   :lines: 113-123
   :lineno-match:

.. CG-EXPLANATION-START id=const:LITHO_SEGMENTER_BOUNDS

**What this does.** The allowed lowest and highest value for each numeric setting.

**Why it is here.** These ranges, mirroring the engine's own request constraints, are what the reader clamps every stored or hand-edited number to so a value can never go out of range.

.. CG-EXPLANATION-END id=const:LITHO_SEGMENTER_BOUNDS

``const VIEW_STATE_KEY``
------------------------

.. CG-BLOCK id=const:VIEW_STATE_KEY lines=124-133

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoSegmenterPrefs.ts
   :language: typescript
   :lines: 124-133
   :lineno-match:

.. CG-EXPLANATION-START id=const:VIEW_STATE_KEY

**What this does.** The name the settings bag lives under inside the project view-state: ``litho_segmenter``.

**Why it is here.** Naming it once means the reader and the save-patch builder can never drift onto different keys.

.. CG-EXPLANATION-END id=const:VIEW_STATE_KEY

``function readLithoSegmenterPrefs``
------------------------------------

.. CG-BLOCK id=function:readLithoSegmenterPrefs lines=134-222

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoSegmenterPrefs.ts
   :language: typescript
   :lines: 134-222
   :lineno-match:

.. CG-EXPLANATION-START id=function:readLithoSegmenterPrefs

**What this does.** Reads the settings out of a project's view-state bag: a missing bag returns all defaults, each number is clamped to its range with its default as fall-back, and each on/off flag keeps its owner-set default unless an explicit true or false was stored.

**Why it is here.** The docstring records that the bag is best-effort persistence, not a contract, so a missing key, a malformed value, or an out-of-range number all fall back to that field's default, and every field defaults independently so a corrupted unit-weight cannot wipe a valid minimum-thickness setting.

.. CG-EXPLANATION-END id=function:readLithoSegmenterPrefs

``function buildSuggestBody``
-----------------------------

.. CG-BLOCK id=function:buildSuggestBody lines=223-248

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoSegmenterPrefs.ts
   :language: typescript
   :lines: 223-248
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildSuggestBody

**What this does.** Builds the suggest-litho request for one investigation: the CPT path carries the stress-derived knobs (unit weight, relative-density factor, merge flag, normalised flag) while the borehole path carries only the minimum thickness.

**Why it is here.** The docstring records that this is the single source shared by the single Suggest verb and the bulk fan-out worker, so a new setting cannot silently diverge between the two paths, and that the stress-derived knobs ride only the CPT path because the borehole segmenter has no cone resistance to normalise.

.. CG-EXPLANATION-END id=function:buildSuggestBody

``function buildLithoSegmenterPatch``
-------------------------------------

.. CG-BLOCK id=function:buildLithoSegmenterPatch lines=249-267

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoSegmenterPrefs.ts
   :language: typescript
   :lines: 249-267
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildLithoSegmenterPatch

**What this does.** Builds the save payload that writes the settings back into view-state under the ``litho_segmenter`` key.

**Why it is here.** The docstring records the shallow-merge contract: only the ``litho_segmenter`` key is overwritten, and sibling view-state keys (like the CPT channel choices and the DEM overlay) are preserved by the server-side merge.

.. CG-EXPLANATION-END id=function:buildLithoSegmenterPatch

