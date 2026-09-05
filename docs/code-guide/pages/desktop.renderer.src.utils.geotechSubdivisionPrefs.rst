desktop.renderer.src.utils.geotechSubdivisionPrefs
==================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechSubdivisionPrefs.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechSubdivisionPrefs.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechSubdivisionPrefs.ts
   :language: typescript
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds the per-project preferences for the geotech NAD subdivision ("Subdivide all bodies"). The comment records that they persist inside the project's view-state under their own key, kept separate from the litho segmenter's preferences so tuning packing never moves lithology, and that it uses the same best-effort read pattern as its litho sibling. It imports two shared view-state readers.

**Why it is here.** Keeping the packing preferences in their own bag is the recorded reason — so a packing tuning change cannot disturb lithology settings. These are screen/tuning preferences persisted server-side in the project's view-state, following the platform's rule that engineering decisions and UI-tuning both persist with the project rather than only in the browser.

.. CG-EXPLANATION-END id=module-header

``interface GeotechSubdivisionPrefs``
-------------------------------------

.. CG-BLOCK id=interface:GeotechSubdivisionPrefs lines=8-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechSubdivisionPrefs.ts
   :language: typescript
   :lines: 8-34
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechSubdivisionPrefs

**What this does.** Describes the four preference fields: the thinnest packing band to keep (and the persistence a qc change must hold to move a boundary), whether a boundary snaps to a nearby sharp qc break, how far it may snap, and a geo-to-litho snap tolerance.

**Why it is here.** The last field carries a long comment: it has been inert since 2026-08-26 because the owner dropped the division behaviour it governed ("just drop the wall everywhere, user will have to manually do it"), so no backend reads it any more. It is kept only because the save patch overwrites the whole bag, so dropping the field here would silently strip the key from every project's stored view-state on the next save; the comment says to delete the field and the key together, deliberately, when someone will accept that rewrite.

.. CG-EXPLANATION-END id=interface:GeotechSubdivisionPrefs

``const GEOTECH_SUBDIVISION_DEFAULTS``
--------------------------------------

.. CG-BLOCK id=const:GEOTECH_SUBDIVISION_DEFAULTS lines=35-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechSubdivisionPrefs.ts
   :language: typescript
   :lines: 35-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:GEOTECH_SUBDIVISION_DEFAULTS

**What this does.** The default values for the four fields: 0.35 m minimum thickness, gradient snap on, 0.5 m snap window, 0.30 m litho snap tolerance.

**Why it is here.** These are what a project classifies with when the engineer has expressed no preference, and the snap tolerance is noted as matching the backend's own former default.

.. CG-EXPLANATION-END id=const:GEOTECH_SUBDIVISION_DEFAULTS

``const GEOTECH_SUBDIVISION_BOUNDS``
------------------------------------

.. CG-BLOCK id=const:GEOTECH_SUBDIVISION_BOUNDS lines=43-48

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechSubdivisionPrefs.ts
   :language: typescript
   :lines: 43-48
   :lineno-match:

.. CG-EXPLANATION-START id=const:GEOTECH_SUBDIVISION_BOUNDS

**What this does.** The allowed range for each numeric field: 0.1–3.0 m thickness, 0.1–2.0 m snap window, 0.01–2.0 m litho snap tolerance.

**Why it is here.** The bounded reader clamps a stored value into these ranges, so a corrupt or hand-edited number can never push a preference to a nonsensical value.

.. CG-EXPLANATION-END id=const:GEOTECH_SUBDIVISION_BOUNDS

``const VIEW_STATE_KEY``
------------------------

.. CG-BLOCK id=const:VIEW_STATE_KEY lines=49-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechSubdivisionPrefs.ts
   :language: typescript
   :lines: 49-58
   :lineno-match:

.. CG-EXPLANATION-START id=const:VIEW_STATE_KEY

**What this does.** The key under which these preferences live in the project's view-state: "geotech_subdivision".

**Why it is here.** Naming the slot once means the read and the write can never drift onto different keys.

.. CG-EXPLANATION-END id=const:VIEW_STATE_KEY

``function readGeotechSubdivisionPrefs``
----------------------------------------

.. CG-BLOCK id=function:readGeotechSubdivisionPrefs lines=59-92

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechSubdivisionPrefs.ts
   :language: typescript
   :lines: 59-92
   :lineno-match:

.. CG-EXPLANATION-START id=function:readGeotechSubdivisionPrefs

**What this does.** Reads the geotech-subdivision preferences out of a project's view-state bag. If the key is missing it returns a copy of the defaults; otherwise it reads each field, clamping the numbers into their bounds and falling back to the per-field default on a missing key, a malformed value, or an out-of-range number.

**Why it is here.** The docstring records that this is best-effort persistence, not a contract, and that each field defaults independently so a corrupt snap-window does not wipe a valid minimum-thickness setting — the same defensive read the litho preferences use.

.. CG-EXPLANATION-END id=function:readGeotechSubdivisionPrefs

``function buildGeotechSubdivisionPatch``
-----------------------------------------

.. CG-BLOCK id=function:buildGeotechSubdivisionPatch lines=93-107

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechSubdivisionPrefs.ts
   :language: typescript
   :lines: 93-107
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildGeotechSubdivisionPatch

**What this does.** Builds the patch the save uses so these preferences survive the next save, writing all four fields under the geotech-subdivision key in the backend's snake_case field names.

**Why it is here.** The comment records the shallow-merge contract: the server replaces this whole bag while preserving sibling keys, so the now-inert litho snap tolerance is echoed back deliberately — omitting a key the backend still reads would reset the planner's tolerance to its default the first time any other geotech preference is saved.

.. CG-EXPLANATION-END id=function:buildGeotechSubdivisionPatch

