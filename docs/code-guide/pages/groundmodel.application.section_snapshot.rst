groundmodel.application.section_snapshot
========================================

.. CG-PAGE source=src/groundmodel/application/section_snapshot.py complete=true

*Source file:* ``src/groundmodel/application/section_snapshot.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../src/groundmodel/application/section_snapshot.py
   :language: python
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A pure data file: the docstring and the imports for frozen data holders and the id type. It declares the section-scoped export shapes; the builder fills them.

**Why it is here.** The docstring records that where the ground-model snapshot is project-wide, this one is section-scoped and concrete: it carries the two-dimensional geometry of one cross-section's drawn geology. It explains that the cross-section is the editing surface — engineers pick formation tops at columns along the line — so the shape mirrors that workflow, with projected columns and the picks anchored to them.

.. CG-EXPLANATION-END id=module-header

Class ``SectionInvestigationProjection``
----------------------------------------

.. CG-BLOCK id=class:SectionInvestigationProjection lines=34-69

.. literalinclude:: ../../../src/groundmodel/application/section_snapshot.py
   :language: python
   :lines: 34-69
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionInvestigationProjection

**What this does.** A frozen data holder for one investigation column projected onto the section line: its id, whether it is a CPT or borehole, its name, its along-distance from the section start, its surface elevation (which may be missing), and its recorded total depth.

**Why it is here.** The along-distance becomes the column's horizontal position in the two-dimensional section frame, which is what an exporter needs; a missing elevation makes the exporter anchor the column at level zero and stamp a warning. Same value-object pattern as the ground-model snapshot's holders.

.. CG-EXPLANATION-END id=class:SectionInvestigationProjection

Class ``SectionFormationContact``
---------------------------------

.. CG-BLOCK id=class:SectionFormationContact lines=70-110

.. literalinclude:: ../../../src/groundmodel/application/section_snapshot.py
   :language: python
   :lines: 70-110
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionFormationContact

**What this does.** A frozen data holder for one formation-top pick, anchored at one investigation and projected into the section frame: the contact id, its formation, its anchor investigation, the along-distance, the depth below surface, and the absolute level (which may be missing).

**Why it is here.** The docstring records the two ways an exporter uses these: contacts at one column sorted by depth define that column's layer stack, and contacts of one formation across columns sorted by along-distance define the formation's top surface line. The level is null when the anchor has no surface elevation, so absolute-level exporters skip it while depth-coordinate ones still emit it.

.. CG-EXPLANATION-END id=class:SectionFormationContact

Class ``SectionFormation``
--------------------------

.. CG-BLOCK id=class:SectionFormation lines=111-179

.. literalinclude:: ../../../src/groundmodel/application/section_snapshot.py
   :language: python
   :lines: 111-179
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionFormation

**What this does.** A frozen data holder for one formation's display metadata on the section: id, name, optional code, colour, display order, the optional NAD class and main soil code, and the names of any units merged into it by export thinning.

**Why it is here.** Carried with the contacts so exporters need no second lookup for a formation's name or colour, and only formations with a contact on the section are included. The NAD class and soil code are pass-through machine identifiers (debt #104), and the absorbed-names field records what the thinning pass merged in (debt #104b) so the erased boundary stays auditable in the delivered file. The optional fields default to null and an empty tuple so positional fixtures stay valid — a tuple, not a list, because a frozen dataclass must not share a mutable default across instances.

.. CG-EXPLANATION-END id=class:SectionFormation

Class ``SectionSnapshot``
-------------------------

.. CG-BLOCK id=class:SectionSnapshot lines=180-241

.. literalinclude:: ../../../src/groundmodel/application/section_snapshot.py
   :language: python
   :lines: 180-241
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionSnapshot

**What this does.** The top-level frozen data holder for one cross-section: project and section identity, the section length, the horizontal coordinate system, the vertical-datum label, the lists of projected investigations, formations and contacts, and the section-line endpoints.

**Why it is here.** This is the object the section exporters receive through their abstract export method, built in one place so each exporter sees a consistent shape without touching the database. The endpoints are carried here (debt #52) so an exporter that draws a location-map inset need not re-fetch the section row; they default to zero so pre-#52 fixtures stay valid while the build path always sets real values.

.. CG-EXPLANATION-END id=class:SectionSnapshot

