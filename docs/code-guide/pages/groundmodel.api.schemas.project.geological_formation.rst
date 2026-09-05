groundmodel.api.schemas.project.geological_formation
====================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geological_formation.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geological_formation.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geological_formation.py
   :language: python
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports datetime, the free-form ``Any`` type, UUID, the Pydantic tools (including ``computed_field`` for a derived read-only field, and the field/model validators), the strict base class, and three NAD helpers: the family-choice type, the soil-family checks, and the table accessor for a packing class's parameters.

**Why it is here.** These imports set up three request/response schemas plus a small read-only projection of the NAD table. A *computed field* is a value calculated when the reply is built rather than stored — it lets the derived NAD parameters ride on the formation response without a database column (Data Integrity Rule 1: compute on read).

.. CG-EXPLANATION-END id=module-header

Class ``GeologicalFormationCreateRequest`` — header
---------------------------------------------------

.. CG-BLOCK id=class:GeologicalFormationCreateRequest lines=24-32

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geological_formation.py
   :language: python
   :lines: 24-32
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeologicalFormationCreateRequest

**What this does.** The body for creating a formation. Only the name is required (1–200 characters).

**Why it is here.** A *formation* here is a named unit in one of the three model levels (geological, litho, or geotech). Name is the only required field so a unit can be created quickly; the colour and other attributes default or are filled later.

.. CG-EXPLANATION-END id=class:GeologicalFormationCreateRequest

Method ``GeologicalFormationCreateRequest``. ``def name_must_not_be_whitespace_only``
-------------------------------------------------------------------------------------

.. CG-BLOCK id=method:GeologicalFormationCreateRequest.name_must_not_be_whitespace_only lines=33-87

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geological_formation.py
   :language: python
   :lines: 33-87
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologicalFormationCreateRequest.name_must_not_be_whitespace_only

**What this does.** First a field check that rejects a whitespace-only name; then the rest of the create fields are declared — colour (defaulted so the database column stays non-null), code, display order, a pinned-order flag, regional reference, description, and the three-level attributes (lithology, NAD class, parent formation, main soil code, admixtures).

**Why it is here.** The whitespace check closes the gap the length rule leaves (a single space passes length), so a unit stays human-identifiable. The comments record that a fresh formation is deliberately not pinned so the build's data-driven age ordering still applies (debt #35), and the lithology/NAD/parent fields are null on a geological formation and set only on litho or geotech child units — all optional so geological-formation creation stays backwards-compatible. The NAD class is bounded 1–31 and is a characterisation output (MVP).

.. CG-EXPLANATION-END id=method:GeologicalFormationCreateRequest.name_must_not_be_whitespace_only

Method ``GeologicalFormationCreateRequest``. ``def nad_class_must_belong_to_the_soil``
--------------------------------------------------------------------------------------

.. CG-BLOCK id=method:GeologicalFormationCreateRequest.nad_class_must_belong_to_the_soil lines=88-119

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geological_formation.py
   :language: python
   :lines: 88-119
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologicalFormationCreateRequest.nad_class_must_belong_to_the_soil

**What this does.** A whole-object check: if both a NAD packing class and a main soil code are present, it refuses a class that belongs to a different soil family, answering ``422`` with a message naming the correct family.

**Why it is here.** The docstring quotes the owner ruling (2026-08-26): a sand unit can never carry a silt packing class — the coupling between a unit's soil and its packing class is absolute. Because both fields arrive together on this one request, the coupling is checkable here, so the caller gets a clear rejection rather than a stored row that contradicts itself. A packing class describes one soil column and is never valid on another. Classes follow NBN EN 1997-1 ANB Tabel 2.1 (the Belgian national annex).

.. CG-EXPLANATION-END id=method:GeologicalFormationCreateRequest.nad_class_must_belong_to_the_soil

Class ``GeologicalFormationUpdateRequest``
------------------------------------------

.. CG-BLOCK id=class:GeologicalFormationUpdateRequest lines=120-164

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geological_formation.py
   :language: python
   :lines: 120-164
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeologicalFormationUpdateRequest

**What this does.** The body for a partial update of a formation: every field optional (name, colour, an explicit colour override, code, order, pinned flag, references, lithology, NAD class, an ordinal-lock flag, a parent-extrapolated flag, parent id, and the NAD admixture-family choice).

**Why it is here.** Only present keys are written; sending null clears an optional field, and omitting it leaves the stored value — the comments note the router's exclude-unset is what makes those three cases distinct. The comments record several feature ties: the drag-reorder sends the pinned flag with the new order (debt #35); the ordinal lock freezes a unit against the auto-resolver; the extrapolated flag is only ever cleared from the UI (never set true); and the admixture-family choice ('pure' / 'with_admixture') answers the geotech-stage prompt for a unit the NAD table could classify either way (owner ruling 2026-09-04).

.. CG-EXPLANATION-END id=class:GeologicalFormationUpdateRequest

Class ``NadSoilParametersResponse``
-----------------------------------

.. CG-BLOCK id=class:NadSoilParametersResponse lines=165-188

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geological_formation.py
   :language: python
   :lines: 165-188
   :lineno-match:

.. CG-EXPLANATION-START id=class:NadSoilParametersResponse

**What this does.** A small read-only shape carrying the five NAD characteristic values for one packing class: the unsaturated and saturated unit weights, the effective friction angle, the effective cohesion, and (for cohesive classes) the undrained shear strength.

**Why it is here.** The docstring is explicit that every value is a characteristic value transcribed directly from NBN EN 1997-1 ANB Tabel 2.1 (the Belgian national annex) — NOT a design value and NOT a Strix-computed correlation. It is a plain projection of the table onto the API for the Parameters pane to display (owner ruling 2026-09-05). The undrained strength is null for granular classes where the table carries a dash.

.. CG-EXPLANATION-END id=class:NadSoilParametersResponse

Class ``GeologicalFormationResponse`` — header
----------------------------------------------

.. CG-BLOCK id=class:GeologicalFormationResponse lines=189-267

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geological_formation.py
   :language: python
   :lines: 189-267
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeologicalFormationResponse

**What this does.** The full read shape of a formation row: id, project, name, colour and optional colour override, code, order, pinned flag, references, lithology, NAD class, the litho-builder fields, the geotech dual-reference columns, the extrapolated flag, main soil code, admixtures, the NAD admixture choice, instance ordinal and its lock, the resolved parent name and code, and timestamps. It sets ``from_attributes=True``.

**Why it is here.** Every column is exposed because the read path mirrors the row; the litho and geotech fields are null on levels where they do not apply, all additive-optional so older clients keep working. The comments record that the parent name and code are resolved on read from the project's formation set and never stored (Data Integrity Rule 1), null on a geological row or an orphan; the parent code drives the automatic lens name.

.. CG-EXPLANATION-END id=class:GeologicalFormationResponse

Method ``GeologicalFormationResponse``. ``def nad_parameters``
--------------------------------------------------------------

.. CG-BLOCK id=method:GeologicalFormationResponse.nad_parameters lines=268-289

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geological_formation.py
   :language: python
   :lines: 268-289
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologicalFormationResponse.nad_parameters

**What this does.** A computed read-only field that, for a unit with a NAD class, looks the class up in the shared NAD table and returns its five characteristic values; it returns nothing for a unit with no class or no transcribed row.

**Why it is here.** It derives the parameters on read from the already-present class via the one shared table accessor — the same table the D-Series exporters read — so there is a single source of truth (Data Integrity Rule 1) and no stored duplicate. Additive and optional, so a client that never reads the field is unaffected. Values are transcribed from NBN EN 1997-1 ANB Tabel 2.1.

.. CG-EXPLANATION-END id=method:GeologicalFormationResponse.nad_parameters

