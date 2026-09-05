groundmodel.domain.services.voxel_litho.label_voxels
====================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/label_voxels.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/label_voxels.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-131

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 1-131
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the heart of the voxel builder, imports its helpers, and sets a few top-level values. Recall a *voxel* is a cube-shaped cell of a 3-D grid, and to *label* the grid is to write into each voxel the identity of the body that fills it. The file's job is: lay a regular grid over the model, and for each vertical line of voxels work out the soil *stack* there (the top-to-bottom list of soil intervals) from the frontend's validated 2-D section fill, then label each voxel from that stack. The constants set how often a build reports progress, the thickness below which an interval is treated as zero, and how close two slices must be to count as touching.

**Why it is here.** The docstring records the pivotal design choice: rather than build bodies and then reconcile them (every earlier 3-D attempt, which produced overlaps, holes and unfaithful shapes), this labels space directly, and because a labelling of space is itself a partition, the per-body boundaries the mesher extracts are watertight and faithful by construction — and any voxel can carry any body, so interfingering and pinch-out can be drawn honestly. The vertical stack at a point reuses the same two-nearest-section, midline-pinch blend the retired loft field validated; only its mesher failed, so this module ports the maths and re-points it at the voxel value objects. The stored ``CONTACT_GOES_TO_THE_BODY_ABOVE`` text pins one rule the two labellers share: a voxel exactly on a contact belongs to the shallower body, so which labeller the caller picks never changes an answer.

.. CG-EXPLANATION-END id=module-header

Class ``_Entry``
----------------

.. CG-BLOCK id=class:_Entry lines=132-165

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 132-165
   :lineno-match:

.. CG-EXPLANATION-START id=class:_Entry

**What this does.** A read-only holder for one vertical interval of a single body at one map point: the body identity, its soil, its top and base elevations, and what the 2-D engine says the body is doing at this position (tied across the gap as a quad, lapping one side as a pinch, or tied on neither side as a lens).

**Why it is here.** This is the atom the whole stack machinery passes around. The docstring stresses that the kind is per position, never per body, following the owner correction that a body which onlaps at one end and bands to the section end is an onlap only where it onlaps. The classification is allowed to be absent so a project saved before that field crossed the network still loads.

.. CG-EXPLANATION-END id=class:_Entry

Class ``_SectionProjection``
----------------------------

.. CG-BLOCK id=class:_SectionProjection lines=166-198

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 166-198
   :lineno-match:

.. CG-EXPLANATION-START id=class:_SectionProjection

**What this does.** A read-only holder for one section's projection and full stack at a column: how far the point sits from the section, the foot point of the projection, the section's full un-clipped stack there, and that stack pre-flattened into the tuple form the band-reach test needs.

**Why it is here.** The docstring explains it is a performance structure. The projection and the section's full stack do not depend on which geological band is being filled — they are the same for every band the column spans — so the band-aware assembler computes one of these per section once per column and threads it into every band, instead of re-projecting and re-slicing each section for each band. That was the secondary hot path the profiler flagged.

.. CG-EXPLANATION-END id=class:_SectionProjection

Class ``_LabelTally`` — header
------------------------------

.. CG-BLOCK id=class:_LabelTally lines=199-219

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 199-219
   :lineno-match:

.. CG-EXPLANATION-START id=class:_LabelTally

**What this does.** A changeable running tally of everything the labelling had to paper over, owned by the top-level function: the rim columns carried by a non-nearest section, the columns no section could fill, the near-ties decided on evidence, the interior voids the blend closed and the worst of them, the over-limit hairline gaps, the logs below the grid floor, and the two gapless-gate counts.

**Why it is here.** The docstring is careful that this is the ONLY changeable state the pure labelling helpers are handed — a scratch counter that never leaves the call — so it cannot become the module-level mutable state the package's no-logger stance exists to avoid. It mirrors the frozen report value object field for field, so freezing it at the end is a straight copy.

.. CG-EXPLANATION-END id=class:_LabelTally

Method ``_LabelTally``. ``def note_closed_void``
------------------------------------------------

.. CG-BLOCK id=method:_LabelTally.note_closed_void lines=220-226

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 220-226
   :lineno-match:

.. CG-EXPLANATION-START id=method:_LabelTally.note_closed_void

**What this does.** Records one interior void the cumulative layout is about to close: it bumps the count and, if this void is the tallest seen so far, remembers its height and a human-readable site (which section and gap).

**Why it is here.** A void closed by the layout is invisible in the grid that comes out, so it must be counted here to be reported. Keeping only the tallest with its location gives the engineer one concrete place to look rather than a bare number.

.. CG-EXPLANATION-END id=method:_LabelTally.note_closed_void

Method ``_LabelTally``. ``def to_report``
-----------------------------------------

.. CG-BLOCK id=method:_LabelTally.to_report lines=227-243

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 227-243
   :lineno-match:

.. CG-EXPLANATION-START id=method:_LabelTally.to_report

**What this does.** Freezes the changeable tally into the read-only report value object the caller logs, copying every field across.

**Why it is here.** The labelling works against a mutable counter for speed, but the value it hands back must be an immutable snapshot, so nothing downstream can alter the record of what happened during a build.

.. CG-EXPLANATION-END id=method:_LabelTally.to_report

Function ``def _interior_gaps``
-------------------------------

.. CG-BLOCK id=function:_interior_gaps lines=244-279

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 244-279
   :lineno-match:

.. CG-EXPLANATION-START id=function:_interior_gaps

**What this does.** Returns the elevation ranges inside a top-to-bottom stack that no interval covers — the genuine holes. It walks from the deep end upward, tracking the highest elevation covered so far, and reports any range between the running coverage and the next interval's base.

**Why it is here.** The docstring explains the running-coverage walk is what separates a real hole from a body that simply re-enters lower down: comparing only neighbouring intervals would wrongly call the space under a thin nested layer a void even though the layer above reaches straight through it. It matches exactly how the labeller turns stacks into void voxels, so what it reports and what the grid shows are the same ranges. It returns every gap regardless of height, leaving each caller to apply its own threshold.

.. CG-EXPLANATION-END id=function:_interior_gaps

Function ``def _th``
--------------------

.. CG-BLOCK id=function:_th lines=280-284

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 280-284
   :lineno-match:

.. CG-EXPLANATION-START id=function:_th

**What this does.** Returns an interval's vertical thickness — its top elevation minus its base elevation.

**Why it is here.** Thickness is asked for repeatedly by the blend, so it is named once in a single-line helper rather than spelled out at every call site.

.. CG-EXPLANATION-END id=function:_th

Function ``def _mid``
---------------------

.. CG-BLOCK id=function:_mid lines=285-294

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 285-294
   :lineno-match:

.. CG-EXPLANATION-START id=function:_mid

**What this does.** Returns an interval's mid-elevation — the average of its top and base.

**Why it is here.** The mid-elevation is how the blend matches a body's re-entrant occurrences across two sections and how the band clip decides which band a whole interval belongs to, so it is named once in a single-line helper.

.. CG-EXPLANATION-END id=function:_mid

Function ``def _project_point_to_segment``
------------------------------------------

.. CG-BLOCK id=function:_project_point_to_segment lines=295-330

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 295-330
   :lineno-match:

.. CG-EXPLANATION-START id=function:_project_point_to_segment

**What this does.** Drops a map point onto a straight segment between two points, clamped so it never falls off the ends, and returns how far along the segment the foot is, how far the point sits from it, and the foot's coordinates.

**Why it is here.** The docstring notes it is ported verbatim from the retired loft field. It is the geometric primitive underneath finding which section a voxel column is nearest to and where on that section it projects.

.. CG-EXPLANATION-END id=function:_project_point_to_segment

Function ``def slice_region_intervals``
---------------------------------------

.. CG-BLOCK id=function:slice_region_intervals lines=331-383

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 331-383
   :lineno-match:

.. CG-EXPLANATION-START id=function:slice_region_intervals

**What this does.** Cuts one region polygon with a vertical line at a given fraction across its gap and returns the top-and-base pairs where the line is inside the polygon. It uses an even-odd scanline rule: count where the polygon's edges cross the line, sort those crossings, and pair them up into filled intervals.

**Why it is here.** The docstring explains why this is public rather than private: the seventh clause of the gapless gate measures the 2-D fill with this exact scanline, and a private copy over there would be a second opinion about what a region holds at a place — a check that disagrees with the thing it checks reports its own disagreement as a model defect. Vertical edges are skipped because the nudged slice line never lies exactly on one, and intervals thinner than the tiny tolerance are dropped as float noise.

.. CG-EXPLANATION-END id=function:slice_region_intervals

Function ``def _project_to_section_fence``
------------------------------------------

.. CG-BLOCK id=function:_project_to_section_fence lines=384-463

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 384-463
   :lineno-match:

.. CG-EXPLANATION-START id=function:_project_to_section_fence

**What this does.** Projects a map point onto a section's fence — the polyline through its columns' true world positions — and returns the nearest gap, the gap-local fraction (0 at the left column, 1 at the right), the perpendicular distance, and the foot point. A projection past the first or last column clamps to that end.

**Why it is here.** The docstring insists the faithful geometry is the polyline through the columns' true positions, NOT the smoothed start-to-end line, because in real data the section-view distance does not equal world distance and the columns sit metres off the straight line. It is deliberately purely geometric: it answers where on the fence, never what is drawn there, and it leaves a tie it cannot break (two gaps reaching the point equally well) for the stack function to settle on evidence. A comment explains the bounding-box prune, which skips a gap whose box is already farther than the best found, because this loop runs 2.6 million times on the real model.

.. CG-EXPLANATION-END id=function:_project_to_section_fence

Function ``def _projected_stack``
---------------------------------

.. CG-BLOCK id=function:_projected_stack lines=464-541

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 464-541
   :lineno-match:

.. CG-EXPLANATION-START id=function:_projected_stack

**What this does.** Returns a section's stack at the foot the projection chose, but if that gap is blank it searches the other gaps that reach the point at the same distance and lets a drawn one answer instead. It counts each such rescue on the tally.

**Why it is here.** The docstring records the exact defect: two gaps that share a column reach an off-column point through that very column, so their distances are equal but for float noise, and the projection — which can only compare distances — settles the tie on fence order. Where the winning gap is blank and the tied one is drawn, fence order alone decided whether the section had anything to say, and on the owner's first real build it wrongly emptied 129 columns, including the one in-footprint column of 37,707 that came back with no stack at all. Distance cannot separate the tie, so evidence does. The search starts only when the winner is blank and only scans gaps within the tie window, so a section that has something to say costs exactly the one slice already needed — which is why the rule lives here and not inside the projection, where the slice would be thrown away and recomputed (measured at +43 percent).

.. CG-EXPLANATION-END id=function:_projected_stack

Function ``def _section_stack_at``
----------------------------------

.. CG-BLOCK id=function:_section_stack_at lines=542-589

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 542-589
   :lineno-match:

.. CG-EXPLANATION-START id=function:_section_stack_at

**What this does.** Returns a section's top-to-bottom stack in one gap at a given fraction. It nudges the fraction off the two column edges, slices every region of that gap at the nudged fraction, sorts the pieces shallow to deep, and joins touching same-body pieces.

**Why it is here.** The docstring notes the nudge must clear a full snap cell, a rule owned by the snap-grid module and its debt #259 measurements, because a region drawn the whole way across a gap comes back a snap cell short of the edge and a fixed nudge landed beyond it and found nothing. Each sliced piece carries its region's own classification along, so the blend can later ask what the body does here rather than what kind of body it is.

.. CG-EXPLANATION-END id=function:_section_stack_at

Function ``def _merge_contiguous``
----------------------------------

.. CG-BLOCK id=function:_merge_contiguous lines=590-648

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 590-648
   :lineno-match:

.. CG-EXPLANATION-START id=function:_merge_contiguous

**What this does.** Joins touching slices of the same body into the one interval they really are. Two entries merge only when they share a body identity and the base of one meets the top of the next within a float-noise tolerance.

**Why it is here.** The docstring records the bug this fixes: the 2-D engine may cut one interval into several polygons on one section where the other has one, and left separate those extra pieces reached the pairing step, were treated as one-sided, and were annihilated by the midline factor — deleting up to 8.85 m of column the section actually agrees on. Only touching slices merge; a body that genuinely re-enters lower with another body between stays two intervals, because that is a re-entrant body, not a cut one. Never-correlated minorities (no shared identity) are never merged, and a merged interval keeps its classification only when every piece agreed, carrying nothing rather than picking one arbitrarily.

.. CG-EXPLANATION-END id=function:_merge_contiguous

Function ``def _layout``
------------------------

.. CG-BLOCK id=function:_layout lines=649-702

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 649-702
   :lineno-match:

.. CG-EXPLANATION-START id=function:_layout

**What this does.** Takes a shallow-to-deep list of placement specs (a reference elevation, a body, a soil, a thickness) and a blended top elevation, and stacks them contiguously downward from that top, so the result is gap-free by construction. A fully pinched (zero-thickness) body is dropped from the output but still advances the running elevation by zero, keeping the result a true partition.

**Why it is here.** The docstring is emphatic that gap-free by construction also means a void on either input stack is closed here — everything below it shifts up by its height — and that this is deliberate but reported, not silent: what a void between two sections should look like is an open geological ruling (debt #268), so each closure is counted and reported rather than answered here. It corrects earlier figures that had over-counted by sampling gaps no voxel column ever reads, re-measured over the real labelling at six sites, worst 13.9 mm, all closed here. Ported from the retired loft field.

.. CG-EXPLANATION-END id=function:_layout

Function ``def _blended_top``
-----------------------------

.. CG-BLOCK id=function:_blended_top lines=703-730

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 703-730
   :lineno-match:

.. CG-EXPLANATION-START id=function:_blended_top

**What this does.** Blends the top elevations of two section stacks by an inverse-distance weight, and copes gracefully when one stack is empty (it returns the other's top, or nothing when both are empty).

**Why it is here.** The layout stacks downward from a single top elevation, so the blend needs one blended surface to start from; this computes it, tolerating an empty side so a point near only one section still gets a top. Ported from the retired loft field.

.. CG-EXPLANATION-END id=function:_blended_top

Function ``def _pair_occurrences``
----------------------------------

.. CG-BLOCK id=function:_pair_occurrences lines=731-787

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 731-787
   :lineno-match:

.. CG-EXPLANATION-START id=function:_pair_occurrences

**What this does.** Matches a body's repeated occurrences across two sections. It considers every pairing of a left occurrence with a right one, takes the globally nearest pair by mid-elevation first, then the next nearest among what remains, and returns any leftovers unpaired.

**Why it is here.** The docstring records the defect it replaced: matching by array position paired a shallow occurrence with a deep one whenever the two sections carried different numbers of occurrences (measured 2.6 m apart on the owner's model), because position is an artifact of sort order, not evidence. Nearest-mid-elevation greedy matching fixes that; whatever is left over is returned unpaired so the caller pinches it exactly as it pinches a body on one section only, because an occurrence with no counterpart is a lens and inventing a partner for it is the thing this function exists to stop.

.. CG-EXPLANATION-END id=function:_pair_occurrences

Function ``def _blend_stacks``
------------------------------

.. CG-BLOCK id=function:_blend_stacks lines=788-931

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 788-931
   :lineno-match:

.. CG-EXPLANATION-START id=function:_blend_stacks

**What this does.** Blends two section stacks at an inverse-distance weight. Bodies present on both stacks blend their thickness by the weight; a body on only one stack pinches. It groups each stack's entries by body, pairs the matched ones by nearest mid-elevation, blends their thickness and position, blends any surplus a body has on one side, and pinches the truly one-sided bodies, then lays the whole set out gap-free.

**Why it is here.** This is the midline pinch — the geological rule for what lies between two sections. The docstring pins several decisions. With the reach-to-evidence rule (owner ruling 2026-07-31) a one-sided body runs from its drawn apex until the facing section contradicts it, reaching that section rather than dying at the equidistance midline, because the midline was never measured. Surplus of a body both sections carry is blended, not pinched, because it is not one-sided — only its internal subdivision differs — and pinching it deleted material both sections agree on. Never-correlated minorities are always one-sided. The final result is re-merged so touching slices of one body read as one, closing a split a lens sliced at its own apex can leave.

.. CG-EXPLANATION-END id=function:_blend_stacks

Function ``def _measured_pinches``
----------------------------------

.. CG-BLOCK id=function:_measured_pinches lines=932-986

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 932-986
   :lineno-match:

.. CG-EXPLANATION-START id=function:_measured_pinches

**What this does.** Works out per-body survival factors for the bodies one stack carries and the facing stack does not — the one-sided bodies. For each such body it asks the measured pinch-out geometry how far the body reaches at this point, excluding the body's apexes on its own section.

**Why it is here.** Only one-sided bodies pinch, so only they need a factor, and a body the partition measures to die nowhere is left out to keep the standing rule. The docstring notes a body's apexes on its own section measure its extent along that section, not away from it, so the own-section index is excluded — otherwise the factor would measure the wrong direction. It returns nothing when there is nothing measured to apply, so the caller keeps its default rule.

.. CG-EXPLANATION-END id=function:_measured_pinches

Function ``def _stack_at``
--------------------------

.. CG-BLOCK id=function:_stack_at lines=987-1123

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 987-1123
   :lineno-match:

.. CG-EXPLANATION-START id=function:_stack_at

**What this does.** Returns the vertical body stack at a map point using the un-bounded blend. It projects onto every section's fence, ranks them by distance, and either blends the two nearest when the point lies between them or extrudes the nearest section alone when the point is beyond them, filling in a one-sided body's pinch. It also counts anomalies onto the tally.

**Why it is here.** This is the ported loft-field stack rule, minus the band and domain clipping the caller handles. The docstring pins the load-bearing stance repeatedly: an empty slice is no information, not a statement that there is no material, so a blend against an empty side defers to the section that does know rather than pinching everything to nothing — the exact bug that made the owner's bottom clay vanish. The beyond branch keeps walking outward past a blank nearest section until one answers, and only when none does is the column genuinely unknown. Interior voids that survive into the blend are reported, never invented, per debt #268.

.. CG-EXPLANATION-END id=function:_stack_at

Function ``def _clip_stack_to_band``
------------------------------------

.. CG-BLOCK id=function:_clip_stack_to_band lines=1124-1219

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 1124-1219
   :lineno-match:

.. CG-EXPLANATION-START id=function:_clip_stack_to_band

**What this does.** Cuts a section stack down to one geological band's top-and-base window using a snap-or-divide rule. A band surface divides an interval only when it crosses strictly inside it and is farther than the snap tolerance from both ends; otherwise the interval stays whole and is kept if its mid-elevation lands in this band. An optional edge-snap closes a tiny gap between the band's outermost soil and its bounding surface.

**Why it is here.** The docstring explains this is the key fix over a naive clip: a thin interval straddling a band edge but too thin to be cut is kept whole in its mid-elevation's band rather than collapsed to nothing, so a near-coincident soil-to-geology contact reads as coincident, with no sliver and no vanished layer. A comment warns not to turn the edge-snap into a hard trim, because the gap-aware labeller resolves the resulting sub-voxel overlap by letting the shallower body win, and a hard trim would open a gap instead.

.. CG-EXPLANATION-END id=function:_clip_stack_to_band

Function ``def _fill_band_voids``
---------------------------------

.. CG-BLOCK id=function:_fill_band_voids lines=1220-1287

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 1220-1287
   :lineno-match:

.. CG-EXPLANATION-START id=function:_fill_band_voids

**What this does.** Fills the holes the midline blend left inside a band from the sections that reach that band, walking them nearest-first. For each reaching section it clips the section's entries to the band, subtracts everything already placed, and drops the still-empty remainder into the void.

**Why it is here.** The docstring records why the void appears: the midline pinch matches bodies by identity, so two sections that both fill a band but with different uncorrelated bodies each read as one-sided and pinch toward zero, which can empty a band the sections actually fill. Filling nearest-first means a nearer section's material wins each gap, and the blended entries win wherever they exist so the pinch geometry is kept; only genuine voids are filled. This is horizontal extrapolation of the nearest reaching section into the gap.

.. CG-EXPLANATION-END id=function:_fill_band_voids

Function ``def _stack_at_band``
-------------------------------

.. CG-BLOCK id=function:_stack_at_band lines=1288-1396

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 1288-1396
   :lineno-match:

.. CG-EXPLANATION-START id=function:_stack_at_band

**What this does.** Returns the band-clipped, blended stack for one geological band at a point. It clips each section's precomputed stack to the band, drops sections whose clip does not reach the band, blends the two nearest reaching sections with the same between-or-beyond rule as the un-bounded path, back-fills any void the blend left, and re-clips and edge-snaps the final band stack to its surfaces.

**Why it is here.** This is the band analogue of the un-bounded stack function, and the docstring stresses the sideways fill: a shallow section that stops above a band is dropped so its next-nearest reaching neighbour fills the band instead — which is how a deep band below a shallow test gets its lithology drawn in from the side. Because the projection, full stack and reach test do not depend on the band, the caller computes them once per column and passes them in, so this per-band work never re-projects or re-scans a surface.

.. CG-EXPLANATION-END id=function:_stack_at_band

Function ``def _column_stack_geo``
----------------------------------

.. CG-BLOCK id=function:_column_stack_geo lines=1397-1466

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 1397-1466
   :lineno-match:

.. CG-EXPLANATION-START id=function:_column_stack_geo

**What this does.** Assembles one whole gap-free column stack when geological surfaces are supplied. It evaluates every surface at the column once, projects and slices each section once, works out which bands the column's elevation range spans, fills each band independently, and concatenates the per-band stacks shallow to deep.

**Why it is here.** The docstring explains the concatenation is a gap-free partition because each band's clip snaps to the shared geological surface, so adjacent bands abut exactly — which is what the gap-free labeller consumes. A comment records the performance reason for evaluating the surfaces and slicing the sections once up front: it avoids re-scanning per band per section, which the profiler measured at 60 to 100 times the cost. The rule that a litho body never crosses a geological surface is enforced here by construction, band by band.

.. CG-EXPLANATION-END id=function:_column_stack_geo

Function ``def _honored_cells``
-------------------------------

.. CG-BLOCK id=function:_honored_cells lines=1467-1525

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 1467-1525
   :lineno-match:

.. CG-EXPLANATION-START id=function:_honored_cells

**What this does.** Returns the grid cells an investigation's own log should own, as index pairs. It always includes the nearest cell, and adds every cell whose centre lies within a given radius of the investigation's true position.

**Why it is here.** The docstring records two problems with owning only the nearest cell (debt #249): a test near a cell boundary was honored up to half a voxel from where it stands, and which side it landed on moved with the grid phase; and the column drawn on a section is wider than one voxel, so the neighbouring cells showed blended material instead of the log. A radius fixes both. A note on the geometry explains that a radius of one spacing reaches the four orthogonal neighbours but not the diagonals, so the honored footprint is a plus shape, not a three-by-three block. The cells are sorted so contention between two investigations resolves the same way every run.

.. CG-EXPLANATION-END id=function:_honored_cells

Function ``def _column_labels``
-------------------------------

.. CG-BLOCK id=function:_column_labels lines=1526-1621

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 1526-1621
   :lineno-match:

.. CG-EXPLANATION-START id=function:_column_labels

**What this does.** Labels one vertical line of voxels from a gap-free shallow-to-deep stack. A voxel takes the body of the interval whose base-inclusive, top-exclusive range contains it, and nothing where no interval does. It builds the boundary edges walking deep to shallow and uses one fast sorted-array lookup (``np.searchsorted``, which finds each voxel's slot among the ascending edges in one vectorised pass) to assign every voxel at once.

**Why it is here.** The docstring pins the ruling this encodes: an interval no entry covers is VOID, not the body above it, because the owner's rule is that a void below TD stays unknown unless a correlation fills it. An earlier version silently made every entry reach down to the next, so the grid invented lithology the partition had left blank. A void must be wider than the snap grid to count, because the millimetre snapping of a flush contact would otherwise thread a line of void voxels through it. It records that on today's real data no final stack reaches here with a gap over a millimetre, so this guard is currently what keeps void out of a contact rather than a slot that fires.

.. CG-EXPLANATION-END id=function:_column_labels

Function ``def _column_labels_gapped``
--------------------------------------

.. CG-BLOCK id=function:_column_labels_gapped lines=1622-1677

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 1622-1677
   :lineno-match:

.. CG-EXPLANATION-START id=function:_column_labels_gapped

**What this does.** Labels a vertical line of voxels from a stack that MAY contain gaps — the band path's output. It point-locates each voxel independently, applying the intervals deep to shallow so the shallower one wins on a shared contact, and leaves any voxel no interval claims as void.

**Why it is here.** The docstring explains why the gap-free fast lookup cannot be used here: the band-scoped column is the concatenation of independently filled bands, so a band whose soil pinches out before reaching its surface leaves a genuine void, and a deeper band's body must not bleed up into it — which the gap-free lookup would wrongly do. It uses the same shallower-wins contact rule as the gap-free labeller, stated once so the two cannot drift, and for a contiguous stack the two are byte-identical.

.. CG-EXPLANATION-END id=function:_column_labels_gapped

Function ``def _honored_column_labels``
---------------------------------------

.. CG-BLOCK id=function:_honored_column_labels lines=1678-1782

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 1678-1782
   :lineno-match:

.. CG-EXPLANATION-START id=function:_honored_column_labels

**What this does.** Labels a vertical line of voxels that hosts an investigation, letting the investigation's own log win over the section blend within its logged depth range, and falling back to the blend above the log's top and below its base. It starts from the blend, voids everything at and above the log's own surface, then overrides each voxel inside the logged range with its own log interval.

**Why it is here.** The docstring explains the honoring stance: an investigation feeds a section at its projected foot, but its true position sits off to the side, so the blend there can disagree with the log — this makes the investigation faithful to its own log without punching a hole below a shallow log, because the blend still fills above and below. Voiding at and above the log's top is because a borehole defines its own ground surface, so a neighbour's higher blended surface must not leave a wrong sliver of soil above it. The log need not be a contiguous partition, so a gap-aware labeller leaves an unlogged interval to defer to the blend rather than letting one bounding unit bridge it.

.. CG-EXPLANATION-END id=function:_honored_column_labels

Function ``def label_voxels``
-----------------------------

.. CG-BLOCK id=function:label_voxels lines=1783-2172

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/label_voxels.py
   :language: python
   :lines: 1783-2172
   :lineno-match:

.. CG-EXPLANATION-START id=function:label_voxels

**What this does.** The public entry point that builds and labels the whole grid. It validates the spacings, frames the horizontal extent from the domain hull and the vertical extent from both the section regions and the honored logs, builds the three axis arrays, refuses an unaffordable grid before allocating, assigns every body a deterministic index, maps each honored investigation to the cells it owns, then walks every column: it computes the column's stack (band-scoped when geological surfaces are given, else the un-bounded blend), labels it (honoring an investigation's log where one is present), tallies anomalies, and returns the labelled grid plus the report.

**Why it is here.** The docstring gathers the whole method's rules. The body ordering is sorted so the labelling and every downstream mesh are reproducible. The vertical range covers the honored logs too, per the owner ruling 'down to the deepest investigation', so nothing measured falls outside the model. Reach-to-evidence is on by default because the real-data A/B earned it (the drilled gate unchanged, triangles down, 52,602 cubic metres filled with not one cell going the other way), while measured-pinch stays off until its own A/B earns it. Honor precedence decides which investigation wins a shared column — a cone over a borehole, then the deeper, then the lower id. The footprint tolerance admits any cell touching the hull, because a strict test is numerically unstable on a boundary edge. Cancel is checked every column and progress is throttled, both only at column boundaries so a column's vertical fill is never interrupted mid-write. Because this is a pure module with no logger, the returned report is how a closed void, a truncated log or a void column reaches the engineer instead of disappearing into the grid.

.. CG-EXPLANATION-END id=function:label_voxels

