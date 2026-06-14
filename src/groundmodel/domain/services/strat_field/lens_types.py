"""Frozen value objects describing a matrix/lens partition of a stratigraphic field.

These are pure data containers — no I/O, no logging, no framework dependencies.
They are produced by
:func:`~groundmodel.domain.services.strat_field.lens_classification.classify_lenses`
and consumed by Stage 1 (the matrix backbone is ordered into a single conformable
column) and by the later lens-carving stage (each lens is carved out of its host
matrix body).

Notes
-----
The approved exception to "one class per file" applies here (the same grouping
rationale as ``strat_types.py``): :class:`Lens` and :class:`LensPartition` form a
single small cohesive vocabulary, so they live together in this module.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Lens:
    """A stratigraphic body that is enclosed (above AND below) by its host body.

    A lens is the over-merge signature that breaks the single-field
    stratigraphic order: the resolver records the SAME host body
    (``host_body_id``) both immediately above and immediately below a thin
    minority unit in one investigation column.  Classifying the minority as a
    lens lets Stage 1 order only the conformable matrix backbone; the lens is
    carved back into its host later.

    Parameters
    ----------
    body_id : str
        The ``instance_key`` (resolver ``body_id``) of the enclosed lens body.
    host_body_id : str
        The ``instance_key`` of the body that brackets the lens above and below.
        For a depth-1 lens this is a matrix body; for a deeper lens it is the
        enclosing lens body.
    nesting_depth : int
        How deeply nested the lens is.  ``1`` = lens directly inside a matrix
        body; ``2`` = lens inside a lens (lens-in-lens); and so on.  Always
        ``>= 1``.
    """

    body_id: str
    host_body_id: str
    nesting_depth: int


@dataclass(frozen=True)
class LensPartition:
    """The split of all stratigraphic bodies into matrix backbone and lenses.

    The matrix backbone is the set of bodies that, ordered alone, forms a
    conformable (acyclic) stratigraphic column.  Every lens is carved out of
    its host later, so no lens participates in the Stage-1 ordering.

    Parameters
    ----------
    matrix_body_ids : frozenset of str
        The ``instance_key`` of every body that belongs to the conformable
        matrix backbone (i.e. every body that is NOT a lens).
    lenses : tuple of Lens
        Every enclosed lens body, in deterministic order (ascending nesting
        depth, then ascending ``body_id``).
    """

    matrix_body_ids: frozenset[str]
    lenses: tuple[Lens, ...]
