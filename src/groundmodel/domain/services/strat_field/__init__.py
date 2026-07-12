"""Implicit stratigraphic 3-D field builder — domain service package.

Builds a volumetric 3-D lithostratigraphic model from section-level
:class:`~groundmodel.domain.services.strat_field.strat_types.StratControlData`
via a scalar potential field approach:

1. Topo-sort formations to assign iso-value ranks (Stage 1).
2. Gather control points + orientation constraints (Stage 2).
3. Compute the scalar potential field on a voxel grid (Stage 3).
4. Extract contact surfaces via marching cubes (Stage 4).
5. Assemble watertight body solids (Stage 5).

Modules
-------
strat_types
    Frozen value objects shared across all stages.
"""
