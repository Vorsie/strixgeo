desktop.renderer.src.utils.viewStatePrefs
=========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/viewStatePrefs.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/viewStatePrefs.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/utils/viewStatePrefs.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Shared helpers for reading a project's ``view_state`` preference bags — the small named collections of screen settings for the litho segmenter, section defaults, geotech subdivision, DEM overlay, virtuele boring, and so on. It then documents the bounds-checked number reader below.

**Why it is here.** The comment records the design: the bag is best-effort persistence, not a contract, so the readers never throw and fall back field by field, which means a corrupt value in a hand-edited project file cannot wipe its sibling settings. It was pulled out (FE-UTILS-05) because the same validator and preamble had been copied into every preference module.

.. CG-EXPLANATION-END id=module-header

``function readBoundedNumber``
------------------------------

.. CG-BLOCK id=function:readBoundedNumber lines=25-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/viewStatePrefs.ts
   :language: typescript
   :lines: 25-50
   :lineno-match:

.. CG-EXPLANATION-START id=function:readBoundedNumber

**What this does.** Reads a number from a preference bag, returning it only when it is a real, finite number within the given minimum/maximum range, and otherwise returning the supplied fallback. It then documents ``readViewStateBag`` below.

**Why it is here.** The docstring records the intent: a preference read must never crash on a bad stored value, so anything that is not a finite in-range number quietly becomes the fallback.

.. CG-EXPLANATION-END id=function:readBoundedNumber

``function readViewStateBag``
-----------------------------

.. CG-BLOCK id=function:readViewStateBag lines=51-59

.. literalinclude:: ../../../desktop/src/renderer/src/utils/viewStatePrefs.ts
   :language: typescript
   :lines: 51-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:readViewStateBag

**What this does.** Pulls one named preference bag out of a project's ``view_state``, returning the bag's dictionary when it is present and object-shaped, and otherwise returning nothing so the caller falls back to its own defaults.

**Why it is here.** The docstring records that ``view_state`` may be entirely absent on an older project bundle (the additive-only rule: new state is optional), so a missing or non-object value returns nothing rather than throwing.

.. CG-EXPLANATION-END id=function:readViewStateBag

