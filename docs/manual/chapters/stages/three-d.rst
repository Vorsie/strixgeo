3-D — the voxel build and the fence
===================================

The 3-D stage turns the interpreted sections into a solid, three-dimensional
ground model that you can rotate, slice and export.

What "Build" does
-----------------

Pressing **Build** runs the **voxel builder**. It does *not* invent geometry: it
**labels space** from the same 2-D partition you drew on the sections. The
partition (the bands, onlaps and lenses of the 2 / 1 / 0 rule) is the single
source of truth, and the voxel build threads exactly the same inputs — the same
column positions, the same correlations — so the 3-D solid and the 2-D sections
describe the same ground.

Mechanically, the builder lays a voxel grid over the modelled volume, and for
each voxel decides which unit it belongs to by mapping its position back onto the
section partitions, bounded by the geological formation surfaces. It honours the
boreholes: a voxel column at a borehole is labelled from that borehole's observed
stratigraphy. It then extracts a mesh from the labelled grid (a greedy-meshing
step, accelerated in a native code path) so the solid renders efficiently. The
model floor extends down to the deepest investigation, so the deepest tests are
represented rather than clipped.

Because a build can take a little while on a large project, StrixGeo runs it as a
**background job** with a progress indicator and a Cancel button, so the program
stays responsive.

The fence diagram
-----------------

The **fence diagram** stands the section walls up in world space — each drawn
section becomes a vertical panel, and the panels together form a 3-D fence you
can view and export. The fence is built in the renderer from the same section
partition, one panel per connected body per section. It carries the on-screen
unit name and colour (on the geotech axis, the packing colour), so the fence you
export matches the fence you see.

Other 3-D references
--------------------

The 3-D view can also show the **DEM ground surface** (the G7 surface) as a
reference for the top of the model, and a **footprint ring** marking the extent
of the interpreted volume. A **split viewport** lets you compare two views (for
example the litho and geotech axes) side by side.
