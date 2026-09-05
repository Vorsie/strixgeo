desktop.renderer.src.utils.sectionFenceData
===========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sectionFenceData.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sectionFenceData.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFenceData.ts
   :language: typescript
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file assembles, for one section, the ordered list of columns the fill engine and the 3-D fence/voxel builders need. It imports the fence-column and partition-column types, the partition-unit type, and the projection-foot helper, and then declares the shape of a projected investigation column: its id, its along-position in metres, and its surface elevation.

**Why it is here.** Gathering this column assembly into pure, reusable helpers keeps one copy of the logic out of both the fill overlay component and the two 3-D builders.

.. CG-EXPLANATION-END id=module-header

``interface FenceProjectedColumn``
----------------------------------

.. CG-BLOCK id=interface:FenceProjectedColumn lines=7-13

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFenceData.ts
   :language: typescript
   :lines: 7-13
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FenceProjectedColumn

**What this does.** The shape of one investigation already projected onto the section — its id, its along-distance in metres, and its surface elevation (which may be absent). It is followed by the docstring for the litho-layer input below.

**Why it is here.** This is the per-column geometry the assembly below starts from.

.. CG-EXPLANATION-END id=interface:FenceProjectedColumn

``interface FenceLayerInput``
-----------------------------

.. CG-BLOCK id=interface:FenceLayerInput lines=14-44

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFenceData.ts
   :language: typescript
   :lines: 14-44
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FenceLayerInput

**What this does.** The shape of one litho layer tied to an investigation — its layer, formation and body ids, its top and base depth, and whether it has been accepted — followed by the documentation for the assembly function, which keeps only accepted layers, drops columns that have no accepted layers or no surface elevation, and sorts the columns by along-position and each column's units shallow-to-deep.

**Why it is here.** The docstring records that this mirrors the column assembly inside ``PartitionFillOverlay`` but is pure and reusable, so the same input can feed the on-screen fill, the 3-D fence and the voxel builder from one place.

.. CG-EXPLANATION-END id=interface:FenceLayerInput

``function assembleSectionPartitionInput``
------------------------------------------

.. CG-BLOCK id=function:assembleSectionPartitionInput lines=45-79

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFenceData.ts
   :language: typescript
   :lines: 45-79
   :lineno-match:

.. CG-EXPLANATION-START id=function:assembleSectionPartitionInput

**What this does.** Builds the section's columns. It buckets every accepted layer by investigation into partition units, sorts the projected columns left-to-right by along-distance, and for each column that has a surface elevation and at least one accepted unit it emits a partition column (its units sorted shallow-to-deep) and a matching fence column carrying the along-position — the two lists kept in the same order. It then documents the assembled-section shape below.

**Why it is here.** The docstring records the filtering: dropping columns with no accepted layers or no surface elevation, and sharing one left-to-right order between the two lists, hands the fill engine a clean, ordered input. That engine then applies the 2/1/0 contact-correlation model (2 ties → a through BAND, 1 tie → an ONLAP, 0 ties → a LENS) to turn the columns into a filled partition.

.. CG-EXPLANATION-END id=function:assembleSectionPartitionInput

``interface AssembledSection``
------------------------------

.. CG-BLOCK id=interface:AssembledSection lines=80-86

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFenceData.ts
   :language: typescript
   :lines: 80-86
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AssembledSection

**What this does.** A section line paired with its assembled partition columns and ordered columns; followed by the docstring for the caller-shape interface below.

**Why it is here.** Bundles a section's endpoints with its assembled columns so the canonical-position pass can work over many sections at once.

.. CG-EXPLANATION-END id=interface:AssembledSection

``interface AssemblableSection``
--------------------------------

.. CG-BLOCK id=interface:AssemblableSection lines=87-113

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFenceData.ts
   :language: typescript
   :lines: 87-113
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AssemblableSection

**What this does.** The minimal section fields the shared assembly reads — the section line, its projected columns, and its layers — followed by the documentation for the shared "Pass 1", which assembles every section's input, keeps only the sections with a fillable gap (two or more columns), and computes the canonical per-test world positions across all of them.

**Why it is here.** The docstring records that the shape is kept minimal, with a generic type carrying the caller's richer input (for example the correlation edges) attached, so the 3-D fence builder and the voxel builder share one assembly pass.

.. CG-EXPLANATION-END id=interface:AssemblableSection

``function assembleSectionsWithCanonical``
------------------------------------------

.. CG-BLOCK id=function:assembleSectionsWithCanonical lines=114-164

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFenceData.ts
   :language: typescript
   :lines: 114-164
   :lineno-match:

.. CG-EXPLANATION-START id=function:assembleSectionsWithCanonical

**What this does.** The shared Pass 1. For every section it assembles the partition input, skips any with fewer than two columns (no gap to fill), and keeps the rest paired with the caller's original input; then it computes the canonical world position per test across all the kept sections. It returns the assembled list and the canonical position map, and documents the canonical-position function below.

**Why it is here.** The docstring records the payoff: because both the 3-D fence builder and the voxel builder run this one pass, tie and cross-section columns agree at their crossing points in both.

.. CG-EXPLANATION-END id=function:assembleSectionsWithCanonical

``function computeCanonicalColumnWorldPositions``
-------------------------------------------------

.. CG-BLOCK id=function:computeCanonicalColumnWorldPositions lines=165-188

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFenceData.ts
   :language: typescript
   :lines: 165-188
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeCanonicalColumnWorldPositions

**What this does.** Computes one canonical world position per test id. For each section that has a gap it takes each column's projected foot on the line, and records it, keeping the position from whichever section holds the most columns; it then strips the internal bookkeeping count and returns a map of investigation id to world position.

**Why it is here.** The comment records the rule (dogfeed 2026-06-10): each column is drawn at its position on the densest section that contains it, so a cross-section (many columns) owns the position and renders unchanged, while a tie (only two columns) inherits the cross-sections' positions and the rung meets the walls cleanly. This is the section-view spacing rule in its cross-section form — draw at the shared canonical position, not each section's own raw projection — and it is pure view geometry, so the correlation data fed to the solid and voxel builders is left untouched.

.. CG-EXPLANATION-END id=function:computeCanonicalColumnWorldPositions

