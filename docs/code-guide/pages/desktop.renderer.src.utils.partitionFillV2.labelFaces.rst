desktop.renderer.src.utils.partitionFillV2.labelFaces
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/labelFaces.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/labelFaces.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/labelFaces.ts
   :language: typescript
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module colours every traced face. It stamps each with a soil (from the column-edge lines that bound it), a body id (from the same units), and a kind — band, onlap, or lens — decided by what kinds of lines bound it, not by counting ties. It has two paths: the frozen fallback path uses a length-weighted vote over the bounding units plus the flood, substrate and lens colour authorities; the product seed path colours each face from the picked-unit column edge (the seed), the paint-bucket rule, dropping a geometric exterior face and keeping a defect face's interim colour with a defect record.

**Why it is here.** The docstring records the line-id vocabulary that is the colouring signal (a column edge is coln:um, a tie starts tie, a closing starts close), and the two-path design (the fallback path is byte-identical to before the seed rewrite — the campaign safety line; the seed path is the paint-bucket mandate). The interim-defect output is called out as the one temporary deviation from never painting a defect, needed so the holes gate does not break mid-campaign.

.. CG-EXPLANATION-END id=module-header

``type FaceClass``
------------------

.. CG-BLOCK id=type:FaceClass lines=41-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/labelFaces.ts
   :language: typescript
   :lines: 41-49
   :lineno-match:

.. CG-EXPLANATION-START id=type:FaceClass

**What this does.** A type naming the three face kinds: band, onlap, or lens.

**Why it is here.** One shared name for the classification so every consumer uses the same three values.

.. CG-EXPLANATION-END id=type:FaceClass

``interface FaceDefect``
------------------------

.. CG-BLOCK id=interface:FaceDefect lines=50-70

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/labelFaces.ts
   :language: typescript
   :lines: 50-70
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FaceDefect

**What this does.** A type recording a topology defect: a face whose column-edge seeds do not resolve to exactly one soil (zero seeds, several seeds, or a merged-minority artifact), with the seed references, bounding line ids, bounds, and, for a merged minority, the true minority soil and the artifact seed soil.

**Why it is here.** The docstring records a defect face keeps its current colour in the output (so the render never collapses and holes do not explode mid-campaign) but carries this record so the seed gate can pin the exact count and a later step can repair it defect by defect.

.. CG-EXPLANATION-END id=interface:FaceDefect

``interface LabelledFace``
--------------------------

.. CG-BLOCK id=interface:LabelledFace lines=71-130

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/labelFaces.ts
   :language: typescript
   :lines: 71-130
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LabelledFace

**What this does.** A type for a coloured face: the face itself, its soil, body id, and kind, the bounding column-edge unit references, and optional fields — the layer ids that produced its paint, the seed references and seed class, a defect record, a fallback flag, and an enclosed-lens flag.

**Why it is here.** The docstring documents each optional field's contract: layer ids are the label-independent identity evidence (absent when empty, absent on fallback faces because inferred fill names no layer); the fallback flag marks paint that came from a substrate or flood label (inferred, not drilled); and the enclosed-lens flag marks a lens's own face whose true minority soil the seed classifier cannot see because the minority was merged out of the column stack.

.. CG-EXPLANATION-END id=interface:LabelledFace

``const COL_RE``
----------------

.. CG-BLOCK id=const:COL_RE lines=131-171

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/labelFaces.ts
   :language: typescript
   :lines: 131-171
   :lineno-match:

.. CG-EXPLANATION-START id=const:COL_RE

**What this does.** A constant regular expression (a text-matching pattern) that recognises a column-edge line id of the form coln:um and pulls out the column and unit numbers.

**Why it is here.** The column-edge id is the labelling signal for which unit bounds a face, so this pattern extracts the two numbers from it.

.. CG-EXPLANATION-END id=const:COL_RE

``function labelFaces``
-----------------------

.. CG-BLOCK id=function:labelFaces lines=172-350

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/labelFaces.ts
   :language: typescript
   :lines: 172-350
   :lineno-match:

.. CG-EXPLANATION-START id=function:labelFaces

**What this does.** The entry point. For each face it first checks whether it is a bracketed jump-tie strip (which outranks everything). On the product seed path it classifies the face by its column-edge seeds: a single-seed face is coloured from that column (with a channel-matrix relabel where a thin sliver would otherwise paint a whole channel), a merged-minority artifact keeps its true lens soil, a geometric exterior is dropped, and a zero- or multi-seed defect keeps its interim colour with a defect record. On the fallback path it uses the original label helper.

**Why it is here.** The docstring cites the bracket strip (owner 2026-08-18, the VD quad has a top and a bottom correlation so it should be there) as the top authority, and the ruling-8r merge-artifact discriminator (a seed manufactured by the same-soil enclosed-lens merge is not a valid seed) as structural, not a heuristic. It cites the channel-matrix rule (owner 2026-08-18, the channel matrix owns the vacancy) so a 0.38 m silt sliver does not paint a 1 m channel.

.. CG-EXPLANATION-END id=function:labelFaces

``function seedBody``
---------------------

.. CG-BLOCK id=function:seedBody lines=351-388

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/labelFaces.ts
   :language: typescript
   :lines: 351-388
   :lineno-match:

.. CG-EXPLANATION-START id=function:seedBody

**What this does.** Returns the body id of the seed soil on a single-seed face: the body id of the smallest seed reference whose unit carries the winning soil, resolving both a picked-unit reference and an enclosed-lens reference.

**Why it is here.** The docstring records the enclosed-lens form is resolved because the ruling-8r id-split gave a lens its own column edge and the minority was spliced out of the column stack, so a plain column lookup would miss it and drop the override key for that lens; body ownership stays separate from soil authority.

.. CG-EXPLANATION-END id=function:seedBody

``function seedColumnOf``
-------------------------

.. CG-BLOCK id=function:seedColumnOf lines=389-401

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/labelFaces.ts
   :language: typescript
   :lines: 389-401
   :lineno-match:

.. CG-EXPLANATION-START id=function:seedColumnOf

**What this does.** Returns the single column index a face's seed references all belong to, or nothing when they disagree or none parse.

**Why it is here.** The docstring records a single-seed face's references sit on one column in every real case, and returning nothing on disagreement keeps the channel-matrix rule from guessing which column to read (it then leaves the seed paint alone), so a genuine gap-spanning band is never relabelled.

.. CG-EXPLANATION-END id=function:seedColumnOf

``function unitsOf``
--------------------

.. CG-BLOCK id=function:unitsOf lines=402-427

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/labelFaces.ts
   :language: typescript
   :lines: 402-427
   :lineno-match:

.. CG-EXPLANATION-START id=function:unitsOf

**What this does.** Returns the bounding column-edge unit references of a face, extracted from its bounding line ids.

**Why it is here.** A fallback source of the bounding units when there is no interim label to spread, so the face still records which columns bound it.

.. CG-EXPLANATION-END id=function:unitsOf

``function bracketFaceLabel``
-----------------------------

.. CG-BLOCK id=function:bracketFaceLabel lines=428-464

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/labelFaces.ts
   :language: typescript
   :lines: 428-464
   :lineno-match:

.. CG-EXPLANATION-START id=function:bracketFaceLabel

**What this does.** Returns the bracket-strip colour for a face when the face lies entirely between a bracketed jump-tie pair's two lines within its x-range (with a millimetre slack), else nothing.

**Why it is here.** The docstring records membership is purely geometric because at the anchor columns the bridge coincides with the columns' own contact lines and the arrangement may hand the boundary to either id, while corner-touching neighbours graze both lines without lying between them.

.. CG-EXPLANATION-END id=function:bracketFaceLabel

``function labelOneFace``
-------------------------

.. CG-BLOCK id=function:labelOneFace lines=465-659

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/labelFaces.ts
   :language: typescript
   :lines: 465-659
   :lineno-match:

.. CG-EXPLANATION-START id=function:labelOneFace

**What this does.** Colours one face by the original boundary-composition authorities. It walks the bounding line ids, counting ties and closings and noting flood, substrate and lens labels; returns a lens's own face from the lens label, a substrate or flood wedge (with no column edge) from those labels as a fallback band, and otherwise a length-weighted vote over the bounding units, promoting a gap-spanning face to a band only when a real anchor line is on the boundary.

**Why it is here.** The docstring records the enclosed-lens discriminator (a lens's own face has an all-lens boundary and does not span the gap, distinguishing it from the matrix notch that shares its lens ids — replacing the old holes-length test that mislabelled the notch), and the strict-2/1/0 span-band rule (owner ruling 8): a face that spans the gap only by touching two untied column edges is the retired auto-match and terminates as a lens, not a band.

.. CG-EXPLANATION-END id=function:labelOneFace

``function resolveLabel``
-------------------------

.. CG-BLOCK id=function:resolveLabel lines=660-710

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/labelFaces.ts
   :language: typescript
   :lines: 660-710
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveLabel

**What this does.** Resolves a face's soil and body from its bounding units by length-weighting: the soil is the one whose column edge contributes the longest boundary (measured as its span's overlap with the face's elevation extent), ties broken by smallest column and unit index.

**Why it is here.** The docstring records a pure unit count mis-picks when a face touches two different-soil units of one column (an interbedded onlap face at a SILT/ZAND contact), where the count tie fell to an arbitrary alphabetical id and flipped a thin-ZAND/thick-SILT face; length-weighting picks the soil that actually dominates the face's edge (increment 17, CS1 gap21).

.. CG-EXPLANATION-END id=function:resolveLabel

``function classifyFace``
-------------------------

.. CG-BLOCK id=function:classifyFace lines=711-715

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/labelFaces.ts
   :language: typescript
   :lines: 711-715
   :lineno-match:

.. CG-EXPLANATION-START id=function:classifyFace

**What this does.** Classifies a face from its counts of ties and closings: no closing means band, at least one tie and one closing means onlap, only closings means lens.

**Why it is here.** The docstring pins this to design section 2's boundary-composition rule: a boundary running tie to tie (or exiting the section) is a band, one tied side plus a synthesized closing is an onlap, and no ties is a lens.

.. CG-EXPLANATION-END id=function:classifyFace

