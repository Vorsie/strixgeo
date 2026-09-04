Parameters — per-unit statistics and grouping
=============================================

The Parameters stage is where you look at the **measured spread** behind each
unit. It is a characterisation stage: it describes the measurements that were
taken over the ground a unit covers, and nothing on it is correlated, converted
or calibrated into a design-ready value.

Per-unit statistics
-------------------

Select a unit and StrixGeo pools every CPT reading that falls inside the unit's
bands — across all the CPTs the unit stands on — and summarises three channels
independently:

* **qc** — cone resistance (MPa);
* **fs** — sleeve friction (MPa);
* **Rf** — friction ratio (%).

Each channel is kept as its own distribution, on its own axis, because each has
its own unit — a single shared scale would be a dual-axis mistake. For each
channel StrixGeo shows a distribution plot (a box over the pooled samples with
the individual readings drawn beside it, so you can see how many measurements
stand behind the box) and a numeric summary:

* the count of finite samples;
* the five-number summary — minimum, 5th percentile, first quartile, median,
  third quartile, 95th percentile, maximum;
* the arithmetic mean;
* the sample standard deviation (n − 1).

Every summary field is blank when the sample count cannot support it: an empty
unit has no median, a single reading has no standard deviation. StrixGeo reports
those as *blank*, never as ``0`` — a zero there would state a fact about the
ground that no measurement supports. The panel also reports how many bands and
how many distinct CPTs the samples came from, and the total metres of ground the
unit covers.

The exact set of statistics and the pooling rule are restated, with the sample
definition, in chapter 3.

Grouping in the Parameters pane
-------------------------------

You can select several units in the pane and **Group** them (and **Ungroup**
them again). Grouping in the Parameters stage is the same operation as Join in
the Geotech stage: it pools the members' samples for the statistics and labels
them "(group N)", **without merging** their identities — each member keeps its
own body id (see the Geotech chapter). A grouped unit's statistics header reads
"group of N" and lists the source bodies, so the provenance of the pooled sample
stays visible.

There is also a jump from a unit to its cross-section and to the 3-D view, so
you can move from the numbers straight to the geometry they describe.

What is, and is not, produced here
----------------------------------

Produced: the descriptive statistics above, and the per-unit CPT-derived
indicators (Ic zone, Dr for sands, NAD class, unit-weight estimate) carried from
the Geotech stage.

Not produced: any design-ready parameter (φ′, c′, cu, E50, OCR, Vs, G0, M) and
any parameter *suggestion*. The panel says so on screen. Those are Phase-5 work
and, when they arrive, will carry provenance and a verification test — they are
not in this build.
