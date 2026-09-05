desktop.renderer.src.utils.geotechBodySelectionStore
====================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechBodySelectionStore.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechBodySelectionStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBodySelectionStore.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is a small shared holder — a *store* — for which geotech body is currently selected on the section view. The comment explains the gesture and the three consumers: clicking a lab-sample dot on the geotech axis selects the body the sample belongs to; the sample overlay produces the selection, the inspector highlights the matching unit row and shows the sample's assignment source, and the fill overlay fades the non-matching bodies. It imports React's ``useSyncExternalStore``.

**Why it is here.** As the comment records, this is the shared selection signal between three sibling components with no shared path to pass it down, so it follows the same store pattern introduced on the ``formationFillStore`` page: module-global state driven by the click gesture and read through ``useSyncExternalStore``. It defaults to nothing selected and is not persisted, because it is transient screen state rather than a project decision.

.. CG-EXPLANATION-END id=module-header

``interface GeotechBodySelection``
----------------------------------

.. CG-BLOCK id=interface:GeotechBodySelection lines=26-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBodySelectionStore.ts
   :language: typescript
   :lines: 26-40
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechBodySelection

**What this does.** Describes the record set when a sample dot is clicked: the id of the selected body and the assignment source for the clicked sample (one of a few known text values, or nothing when unknown).

**Why it is here.** Carrying both the body and the sample's source lets the inspector highlight the right body and also explain where that sample's CPT assignment came from, from a single selection record.

.. CG-EXPLANATION-END id=interface:GeotechBodySelection

``let selection``
-----------------

.. CG-BLOCK id=let:selection lines=41-41

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBodySelectionStore.ts
   :language: typescript
   :lines: 41-41
   :lineno-match:

.. CG-EXPLANATION-START id=let:selection

**What this does.** The module-level holder of the current selection, starting empty (nothing selected).

**Why it is here.** One shared value that the writers change and the readers report; empty means no body is currently selected.

.. CG-EXPLANATION-END id=let:selection

``const listeners``
-------------------

.. CG-BLOCK id=const:listeners lines=42-43

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBodySelectionStore.ts
   :language: typescript
   :lines: 42-43
   :lineno-match:

.. CG-EXPLANATION-START id=const:listeners

**What this does.** The set of callback functions to run whenever the selection changes.

**Why it is here.** This is the *subscribe/notify* backing of the store — the list of interested components the store must tell when the value changes.

.. CG-EXPLANATION-END id=const:listeners

``function notify``
-------------------

.. CG-BLOCK id=function:notify lines=44-59

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBodySelectionStore.ts
   :language: typescript
   :lines: 44-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:notify

**What this does.** Calls every registered listener.

**Why it is here.** The single place that tells all subscribers the selection changed, so a component reading the store redraws.

.. CG-EXPLANATION-END id=function:notify

``function selectGeotechBody``
------------------------------

.. CG-BLOCK id=function:selectGeotechBody lines=60-75

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBodySelectionStore.ts
   :language: typescript
   :lines: 60-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:selectGeotechBody

**What this does.** Sets the selection to a given record, or clears it when passed nothing, then notifies subscribers.

**Why it is here.** The plain writer that both the direct-select and the toggle paths go through, so every change flows through one notify.

.. CG-EXPLANATION-END id=function:selectGeotechBody

``function toggleGeotechBodySelection``
---------------------------------------

.. CG-BLOCK id=function:toggleGeotechBodySelection lines=76-87

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBodySelectionStore.ts
   :language: typescript
   :lines: 76-87
   :lineno-match:

.. CG-EXPLANATION-START id=function:toggleGeotechBodySelection

**What this does.** Toggles a body's selection: if that body is already selected it clears the selection, otherwise it selects that body with the clicked sample's assignment source.

**Why it is here.** Click-to-toggle is the natural gesture for a dot — clicking the already-selected body's dot deselects it — so this wraps the writer with that on/off behaviour.

.. CG-EXPLANATION-END id=function:toggleGeotechBodySelection

``function getGeotechBodySelection``
------------------------------------

.. CG-BLOCK id=function:getGeotechBodySelection lines=88-95

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBodySelectionStore.ts
   :language: typescript
   :lines: 88-95
   :lineno-match:

.. CG-EXPLANATION-START id=function:getGeotechBodySelection

**What this does.** Reads the current selection record once, without subscribing to changes.

**Why it is here.** A non-reactive read for code that needs the value at a moment in time rather than a component that should redraw when it changes.

.. CG-EXPLANATION-END id=function:getGeotechBodySelection

``function getSelectedGeotechBodyId``
-------------------------------------

.. CG-BLOCK id=function:getSelectedGeotechBodyId lines=96-99

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBodySelectionStore.ts
   :language: typescript
   :lines: 96-99
   :lineno-match:

.. CG-EXPLANATION-START id=function:getSelectedGeotechBodyId

**What this does.** Reads just the selected body's id, or nothing when there is no selection, without subscribing.

**Why it is here.** A convenience for the common case where only the id is needed, not the sample source.

.. CG-EXPLANATION-END id=function:getSelectedGeotechBodyId

``function subscribe``
----------------------

.. CG-BLOCK id=function:subscribe lines=100-109

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBodySelectionStore.ts
   :language: typescript
   :lines: 100-109
   :lineno-match:

.. CG-EXPLANATION-START id=function:subscribe

**What this does.** Registers a callback to be run on every change and returns a function that unregisters it.

**Why it is here.** This is the *subscribe* half ``useSyncExternalStore`` requires; returning the unregister function lets React clean up when a component goes away.

.. CG-EXPLANATION-END id=function:subscribe

``function useGeotechBodySelection``
------------------------------------

.. CG-BLOCK id=function:useGeotechBodySelection lines=110-114

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBodySelectionStore.ts
   :language: typescript
   :lines: 110-114
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeotechBodySelection

**What this does.** A hook that returns the current selection record and re-draws the calling component whenever it changes.

**Why it is here.** The reactive read built on ``useSyncExternalStore``, for a component that needs the full selection (body plus sample source).

.. CG-EXPLANATION-END id=function:useGeotechBodySelection

``function useSelectedGeotechBodyId``
-------------------------------------

.. CG-BLOCK id=function:useSelectedGeotechBodyId lines=115-117

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBodySelectionStore.ts
   :language: typescript
   :lines: 115-117
   :lineno-match:

.. CG-EXPLANATION-START id=function:useSelectedGeotechBodyId

**What this does.** A hook that returns just the selected body's id and re-draws when that id changes.

**Why it is here.** The reactive read for a component that only cares which body is selected, so it does not redraw when merely the sample source differs.

.. CG-EXPLANATION-END id=function:useSelectedGeotechBodyId

