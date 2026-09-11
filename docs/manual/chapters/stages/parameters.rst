Parameters: per-test and per-unit overviews
===========================================

The Parameters stage is where you look at everything you have built, either
**per test** or **per layer**. Two kinds of thing live here, kept apart on
purpose: the **measured spread** behind each unit (the statistics of the cone
channels), and the **characteristic soil parameters** read from the NAD table for
each unit's class.

Per-unit statistics
-------------------

Select a unit, and StrixGeo pools every CPT reading that falls inside the unit's
bands, across all the CPTs the unit stands on, and summarises three channels
independently:

* **qc**, cone resistance (MPa);
* **fs**, sleeve friction (MPa);
* **Rf**, friction ratio (%).

Each channel is kept on its own axis, because each has its own unit and a shared
scale would be misleading. For each channel StrixGeo draws a distribution plot (a
box over the pooled samples, with the individual readings drawn beside it so you
can see how many measurements stand behind the box) and a numeric summary:

* the count of finite samples;
* the five-number summary (minimum, 5th percentile, first quartile, median,
  third quartile, 95th percentile, maximum);
* the arithmetic mean;
* the sample standard deviation (n minus 1).

Any summary the sample count cannot support is left **blank**, never shown as
``0``. An empty unit has no median, a single reading has no standard deviation,
and a zero there would state a fact about the ground that no measurement
supports. The panel also reports how many bands and how many distinct CPTs the
samples came from, and the total metres of ground the unit covers. The exact set
of statistics and the pooling rule are restated in the methods chapter.

The NAD characteristic parameters
---------------------------------

Beside the measured statistics, and clearly separate from them, StrixGeo shows
the **characteristic soil parameters** the NAD table gives for the unit's class,
one general value per body: the dry and wet unit weight, the effective friction
angle, the effective cohesion, and, for the fine soils, the undrained shear
strength. These are read straight from the Belgian NAD table for the packing
class the geotech stage assigned.

They are shown as what they are: **characteristic values**, labelled as an
estimate the engineer must verify. Turning a characteristic value into a design
value means applying the partial safety factors, and that, with the design checks
that use it, happens in your downstream tool. Where the NAD table has no row for a
class, its characteristic parameters are simply left empty rather than filled with
a plausible-looking guess.

Grouping in the Parameters pane
-------------------------------

You can select several units in the pane and **Group** them (and ungroup them
again). Grouping here is the same operation as Join in the Geotech stage: it pools
the members' samples for the statistics and labels them "(group N)", without
merging their identities, so each member keeps its own body.

A group may span **two different litho parents**: loose sand under one sand body
and loose sand under another can be grouped together, because what a group is for
is pooling like with like. The one rule the pane enforces is that the members
share a **packing class**: try to add a medium-dense sand to a group of loose
sands and StrixGeo refuses it by name, because pooling two different classes would
be pooling two different things. A grouped unit's statistics header reads
"group of N" and lists the source bodies, so the provenance of the pooled sample
stays visible.

Grouping adds no extra level to the pane. The "(group N)" label appears behind the
unit you already had, on the same row, and that row keeps its own counts. Click any
member and the whole group is selected: every member row is highlighted, wherever
it sits in the tree, and the statistics show the members pooled together.

From the numbers to the geometry
--------------------------------

There is a jump from a unit to its cross-section and to the 3-D view, so you can
move from the numbers straight to the ground they describe.

What is future work here
------------------------

Two lines of work are planned for this stage and are not in this version.

* **Statistical tools for probabilistic design.** A probability density function
  per parameter, so a characteristic value can be chosen on a statistical basis
  rather than by hand.
* **Comparing parameters across test types.** As StrixGeo learns to read
  triaxial, oedometer, pressuremeter and dilatometer results, this stage will
  show, side by side, the value each test type and each CPT correlation suggests,
  so you can pick a good design value from all of them at once.
