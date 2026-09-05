groundmodel.api.schemas.project.cross_section
=============================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/cross_section.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/cross_section.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/cross_section.py
   :language: python
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (``datetime``, ``Any`` and ``Literal`` types, ``UUID``, and the Pydantic pieces), plus a comment explaining why the view-state sub-shapes inherit the strict base.

**Why it is here.** The comment records the load-bearing reason (debt #24): the section's ``view_state`` is a free-form JSON bag stored in the database, and forbidding unknown fields means a typo like ``snap_to_stratigrahpy`` is rejected with a 422 instead of silently persisting junk into that column. *JSONB* is PostgreSQL's binary JSON column type.

.. CG-EXPLANATION-END id=module-header

Class ``CptChannels``
---------------------

.. CG-BLOCK id=class:CptChannels lines=21-39

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/cross_section.py
   :language: python
   :lines: 21-39
   :lineno-match:

.. CG-EXPLANATION-START id=class:CptChannels

**What this does.** The per-section toggles for which CPT channels are drawn (qc, Rf, fs, u2, and qTotal), each optional so a partial update can flip one.

**Why it is here.** The docstring records that this mirrors the frontend interface field-for-field, and the comment keeps ``qTotal`` in camelCase verbatim because changing it would break the saved-bundle round-trip — a raw wire name preserved at the boundary. A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:CptChannels

Class ``BoreholeChannels``
--------------------------

.. CG-BLOCK id=class:BoreholeChannels lines=40-47

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/cross_section.py
   :language: python
   :lines: 40-47
   :lineno-match:

.. CG-EXPLANATION-START id=class:BoreholeChannels

**What this does.** The per-section toggles for which borehole streams are drawn (geotech, formal and informal stratigraphy).

**Why it is here.** Same view-state pattern as the CPT channels above. A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:BoreholeChannels

Class ``ReviewFlags``
---------------------

.. CG-BLOCK id=class:ReviewFlags lines=48-63

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/cross_section.py
   :language: python
   :lines: 48-63
   :lineno-match:

.. CG-EXPLANATION-START id=class:ReviewFlags

**What this does.** Holds ``dismissed`` — the list of litho review flags the engineer has dismissed.

**Why it is here.** The docstring records that a dismissal is a per-project engineering decision, so it rides the section row (and therefore the saved bundle) rather than browser storage; without this key on the allowlist the update is rejected 422 and every dismissal is silently lost. A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:ReviewFlags

Class ``SheetField``
--------------------

.. CG-BLOCK id=class:SheetField lines=64-70

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/cross_section.py
   :language: python
   :lines: 64-70
   :lineno-match:

.. CG-EXPLANATION-START id=class:SheetField

**What this does.** One free-text field of the PDF sheet's title block: a label (max 80 chars) and a value (max 200 chars).

**Why it is here.** A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:SheetField

Class ``SheetSettingsState``
----------------------------

.. CG-BLOCK id=class:SheetSettingsState lines=71-87

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/cross_section.py
   :language: python
   :lines: 71-87
   :lineno-match:

.. CG-EXPLANATION-START id=class:SheetSettingsState

**What this does.** The PDF sheet's per-section settings: which fill to draw (litho or geotech), the scale mode (fit or explicit), optional horizontal and vertical scales, vertical exaggeration, column spacing, and exactly four title-block fields.

**Why it is here.** The docstring records that the desktop's sheet dialog writes this on export and reads it back to seed the dialog, and it travels in the bundle like the rest of the view state. A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:SheetSettingsState

Class ``SectionViewState``
--------------------------

.. CG-BLOCK id=class:SectionViewState lines=88-107

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/cross_section.py
   :language: python
   :lines: 88-107
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionViewState

**What this does.** The validated whole of the section's ``view_state`` bag: the CPT and borehole channel sub-shapes, column spacing, the PDF-sheet settings, a stratigraphy-snap toggle, and the review flags — every field optional.

**Why it is here.** The docstring records the design: the database column stays untyped JSON so a bundle restore can round-trip whatever an older build saved, but this typed gate applies to live update bodies so an unknown top-level key is rejected 422 instead of silently persisted (CLAUDE.md backwards-compatibility). A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:SectionViewState

Class ``CrossSectionCreateRequest`` — header
--------------------------------------------

.. CG-BLOCK id=class:CrossSectionCreateRequest lines=108-143

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/cross_section.py
   :language: python
   :lines: 108-143
   :lineno-match:

.. CG-EXPLANATION-START id=class:CrossSectionCreateRequest

**What this does.** The request to create a section: name, the four endpoint coordinates, the coordinate system code, an optional description, projection buffer and vertical exaggeration (with defaults), excluded-investigation lists, an optional depth window, a display order, and an optional view-state bag. Every coordinate field carries ``allow_inf_nan=False``.

**Why it is here.** The comments record why the non-finite block is load-bearing, not decoration: JSON can carry a bare ``NaN``, Pydantic would accept it into a float, and because ``NaN`` never equals itself it would slip past the distinct-endpoints guard below and poison every later projection and export — a section that could only be repaired by deletion, so it is refused at the door. The docstring notes seeded contacts are deliberately NOT in the create request: a fresh section starts empty and formation content appears only after an explicit seed or draw (the explicit-content invariant). A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:CrossSectionCreateRequest

Method ``CrossSectionCreateRequest``. ``def _endpoints_distinct``
-----------------------------------------------------------------

.. CG-BLOCK id=method:CrossSectionCreateRequest._endpoints_distinct lines=144-150

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/cross_section.py
   :language: python
   :lines: 144-150
   :lineno-match:

.. CG-EXPLANATION-START id=method:CrossSectionCreateRequest._endpoints_distinct

**What this does.** A whole-object check rejecting a section whose two endpoints are the same point.

**Why it is here.** The projection maths divides by the line's length, so a zero-length section is refused with a clear 422.

.. CG-EXPLANATION-END id=method:CrossSectionCreateRequest._endpoints_distinct

Method ``CrossSectionCreateRequest``. ``def _depth_window_ordered``
-------------------------------------------------------------------

.. CG-BLOCK id=method:CrossSectionCreateRequest._depth_window_ordered lines=151-162

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/cross_section.py
   :language: python
   :lines: 151-162
   :lineno-match:

.. CG-EXPLANATION-START id=method:CrossSectionCreateRequest._depth_window_ordered

**What this does.** A whole-object check: when both depth bounds are given, the minimum must be strictly shallower than the maximum.

**Why it is here.** Catches an inverted depth window at the boundary rather than letting it silently disable the window it was meant to define.

.. CG-EXPLANATION-END id=method:CrossSectionCreateRequest._depth_window_ordered

Class ``CrossSectionUpdateRequest``
-----------------------------------

.. CG-BLOCK id=class:CrossSectionUpdateRequest lines=163-209

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/cross_section.py
   :language: python
   :lines: 163-209
   :lineno-match:

.. CG-EXPLANATION-START id=class:CrossSectionUpdateRequest

**What this does.** The partial-update request: every field optional, so only keys present in the body are written. It repeats the same non-finite block, and treats ``view_state`` with a sentinel (``None`` leaves it untouched, an empty object clears it) and ``seeded_formation_contact_ids`` as a wholesale replacement.

**Why it is here.** The docstring records that the distinct-endpoints invariant is re-checked on the server after the update rather than here, because a partial update may leave one endpoint untouched; the strict typing again gives 422 on an unknown view-state key (debt #24). A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:CrossSectionUpdateRequest

Class ``CrossSectionResponse``
------------------------------

.. CG-BLOCK id=class:CrossSectionResponse lines=210-250

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/cross_section.py
   :language: python
   :lines: 210-250
   :lineno-match:

.. CG-EXPLANATION-START id=class:CrossSectionResponse

**What this does.** The section returned to the desktop: all the stored fields plus the seeded-contact set, the body-companion linkage (id, an ever-true "was a companion" flag, and a resolved companion name), and timestamps. It reads straight off the database row via ``from_attributes``.

**Why it is here.** The comments record that the seeded set is the explicit-content included set (a formation contact appears only when its id is in this list) and that the companion name is resolved by the endpoint, not stored. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:CrossSectionResponse

