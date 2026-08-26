"""Read a stored 3-D build generation's ``payload`` back into domain sections.

``LithoBuildGenerationOrm.payload`` is written by ``_generation_payload`` in
:mod:`groundmodel.application.build_voxel_litho_model` — the build's own input,
stored verbatim so ``--reproduce`` and every build diagnostic replay exactly
what ran.  This module is that writer's INVERSE, and it lives in the same layer
for the same reason the writer does: the payload shape is an application-level
contract between one build and a later reader of it, not an HTTP wire shape.

Symmetry with the writer is load-bearing.  ``_generation_payload`` deliberately
takes its field names from the value objects (``asdict``) rather than listing
them by hand, because hand-listed field names are what silently dropped the 2-D
classification at three separate points in one pipeline (debt #256).  The reader
here holds the same line: it splats the stored mapping into the dataclass
constructors instead of naming fields, so a field added to
:class:`~groundmodel.domain.services.voxel_litho.voxel_types.RegionInput`
survives a write-then-read round trip with no edit here.  A payload that does
NOT match the current dataclasses raises ``TypeError`` from the constructor,
which is the correct outcome: a generation written by an older builder must be
reported as unreadable, never silently reconstructed with defaults that were
not what the build actually used.

The only field needing explicit handling is ``polygon``: JSON has no tuples, so
the writer stores ``[[fraction, elevation], ...]`` and the reader restores the
nested-tuple shape the domain type declares.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

__all__ = ["sections_from_generation_payload"]


def sections_from_generation_payload(payload: object) -> list[SectionPartitionInput]:
    """Rehydrate a stored generation payload into domain section partitions.

    Parameters
    ----------
    payload : object
        ``LithoBuildGenerationOrm.payload``.  At rest this is always a JSONB
        mapping, but it is typed ``object`` because a row written by an older
        or foreign builder is untrusted input that must fail loudly rather than
        be coerced.

    Returns
    -------
    list of SectionPartitionInput
        One entry per stored section, in stored order.

    Raises
    ------
    TypeError
        If ``payload`` is not a mapping, if ``payload["sections"]`` is not a
        sequence, or if a stored section / column / region does not match the
        current value-object fields.
    KeyError
        If ``payload`` carries no ``"sections"`` key.
    """
    if not isinstance(payload, Mapping):
        raise TypeError(f"generation payload must be a mapping, got {type(payload).__name__}")

    sections_raw = payload["sections"]
    # A bare str is a Sequence; excluding it stops "abc" parsing as 3 sections.
    if not isinstance(sections_raw, Sequence) or isinstance(sections_raw, str | bytes):
        raise TypeError(f"payload['sections'] must be a list, got {type(sections_raw).__name__}")

    return [_section(raw) for raw in sections_raw]


def _section(raw: object) -> SectionPartitionInput:
    """Rehydrate one stored section, columns and regions included."""
    if not isinstance(raw, Mapping):
        raise TypeError(f"a stored section must be a mapping, got {type(raw).__name__}")

    fields = dict(raw)
    columns = fields.pop("columns", [])
    regions = fields.pop("regions", [])
    return SectionPartitionInput(
        **fields,
        columns=tuple(_column(c) for c in _as_list("columns", columns)),
        regions=tuple(_region(r) for r in _as_list("regions", regions)),
    )


def _column(raw: object) -> SectionColumnInput:
    """Rehydrate one stored section column."""
    if not isinstance(raw, Mapping):
        raise TypeError(f"a stored column must be a mapping, got {type(raw).__name__}")
    return SectionColumnInput(**dict(raw))


def _region(raw: object) -> RegionInput:
    """Rehydrate one stored region, restoring its tuple-of-tuples polygon."""
    if not isinstance(raw, Mapping):
        raise TypeError(f"a stored region must be a mapping, got {type(raw).__name__}")

    fields = dict(raw)
    polygon = fields.pop("polygon", [])
    layer_ids = fields.pop("layer_ids", ())
    return RegionInput(
        **fields,
        polygon=tuple(_point(p) for p in _as_list("polygon", polygon)),
        layer_ids=tuple(str(lid) for lid in _as_list("layer_ids", layer_ids)),
    )


def _point(raw: object) -> tuple[float, float]:
    """Restore one ``[fraction, elevation]`` polygon point — JSON has no tuples."""
    pair = _as_list("polygon point", raw)
    if len(pair) != 2:
        raise TypeError(f"a polygon point must have 2 values, got {len(pair)}")
    return (float(pair[0]), float(pair[1]))  # type: ignore[arg-type]


def _as_list(field: str, value: object) -> Sequence[object]:
    """Assert a stored field is a sequence, naming it when it is not."""
    if not isinstance(value, Sequence) or isinstance(value, str | bytes):
        raise TypeError(f"payload field '{field}' must be a list, got {type(value).__name__}")
    return value
