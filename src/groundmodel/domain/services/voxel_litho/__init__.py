"""Voxel litho builder — domain service package.

Builds a watertight 3-D lithostratigraphic model by LABELLING a regular
voxel grid from the frontend's validated 2-D section partition
(``computeSectionFill``), then extracting each body's greedy-meshed
cell-boundary.  Watertight + faithful by construction: a labelling of
space IS a partition, and a voxel may carry any body, so interfingering
is representable (unlike the retired implicit strat-field builder, which
monotone-clamped to a layer-cake; deleted 2026-07-12 — git history has it).

Modules
-------
voxel_types
    Frozen value objects for the build-request contract — the input the
    frontend POSTs (section partitions) and the intermediate label grid.
"""
