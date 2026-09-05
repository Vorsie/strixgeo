desktop.renderer.src.components.ElevationEditor
===============================================

.. CG-PAGE source=desktop/src/renderer/src/components/ElevationEditor.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/ElevationEditor.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../desktop/src/renderer/src/components/ElevationEditor.tsx
   :language: tsx
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's behaviour comment and its imports. The comment describes an inline editor for the manually-entered surface elevation (Z), shared by the CPT and borehole detail headers, and lists its states — Z known, Z missing, editing, and clearing — and notes it is non-controlled: it owns its own draft while editing and shows the new value only after the parent's save resolves. The imports bring in three React hooks, four icons, the vertical-datum helpers and the translation helper.

**Why it is here.** DOV and GEF rows can arrive with no elevation, and a per-record manual-entry path is needed before any cross-record correlation can run against them (comment). The one editor is shared because the interaction is identical for a CPT and a borehole; the parent supplies the async ``onSave`` that talks to the correct endpoint, so the frontend still goes through the API. Applying the value only after ``onSave`` resolves means a failed save never leaves a number on screen that did not actually persist.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=35-57

.. literalinclude:: ../../../desktop/src/renderer/src/components/ElevationEditor.tsx
   :language: tsx
   :lines: 35-57
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs — the current elevation and its vertical EPSG, an optional provenance source (``dov`` / ``gef`` / ``manual`` / ``none``), and the async ``onSave`` handler. It also opens the comment for the ``SOURCE_LABEL`` map below.

**Why it is here.** ``onSave`` lives in the parent so this editor stays storage-agnostic — a CPT and a borehole write to different endpoints — and it resolves on success or rejects with an error whose message is surfaced. ``elevationSource`` is optional so older callers that do not yet thread it just see the un-badged version, which is the additive-API pattern; the saved ``zEpsg`` carries the user's datum pick so a row always lands with a known vertical CRS.

.. CG-EXPLANATION-END id=interface:Props

``const SOURCE_LABEL``
----------------------

.. CG-BLOCK id=const:SOURCE_LABEL lines=58-66

.. literalinclude:: ../../../desktop/src/renderer/src/components/ElevationEditor.tsx
   :language: tsx
   :lines: 58-66
   :lineno-match:

.. CG-EXPLANATION-START id=const:SOURCE_LABEL

**What this does.** A small table mapping a source token to short badge text — ``dov`` → DOV, ``gef`` → GEF, ``manual`` → manual. It also opens the comment for ``cleanNumericInput`` below.

**Why it is here.** Keeps the provenance badge tight on the header strip; the ``none`` case never renders because a null elevation shows the amber 'Set elevation' link instead (comment). The raw source tokens are mapped to display text here in the desktop, following the translate-at-the-presentation-boundary rule.

.. CG-EXPLANATION-END id=const:SOURCE_LABEL

``function cleanNumericInput``
------------------------------

.. CG-BLOCK id=function:cleanNumericInput lines=67-80

.. literalinclude:: ../../../desktop/src/renderer/src/components/ElevationEditor.tsx
   :language: tsx
   :lines: 67-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:cleanNumericInput

**What this does.** Strips a typed string down to digits, a single decimal separator (a dot or a comma) and a leading minus, keeping only the first separator.

**Why it is here.** It enforces the same shape a spreadsheet's number cell does, so letters never reach the field — needed because the elevation input is a plain text field (see the component below) rather than a browser number field.

.. CG-EXPLANATION-END id=function:cleanNumericInput

``function ElevationEditor``
----------------------------

.. CG-BLOCK id=function:ElevationEditor lines=81-289

.. literalinclude:: ../../../desktop/src/renderer/src/components/ElevationEditor.tsx
   :language: tsx
   :lines: 81-289
   :lineno-match:

.. CG-EXPLANATION-START id=function:ElevationEditor

**What this does.** The component. When idle it shows either an amber 'Set elevation' link (Z missing) or the readout 'Z = value datum (source)' with a pencil on hover (Z known); clicking either enters edit mode. Editing shows a filtered numeric input, a vertical-datum dropdown, Save and Cancel buttons, a Clear link and any error text. Enter saves, Escape cancels, and an empty input on Save clears the value. On save it parses the draft (accepting a comma decimal), range-checks it, and calls ``onSave``, revealing the result only once the parent resolves.

**Why it is here.** Saving or clearing the elevation is a committed, persisted edit that goes through the API. It is kept non-controlled — owning its own draft — so the user can change the datum mid-edit without it snapping back to the row's stored value, and the value is applied only after ``onSave`` resolves so a failed save never shows an unpersisted number. It mirrors the backend's range guard (−500 to 9000 m) so the user gets feedback before the round-trip. The input is a text field with a decimal input mode, not a number field, because a number field silently coerces bad input to empty and would collide with the empty-means-clear path (comment). The Clear link is the reversible undo for a mistyped value, following the reversible-action UX convention (comment), and the datum dropdown is always shown so the choice is never a hidden default.

.. CG-EXPLANATION-END id=function:ElevationEditor

