"""One interpretation found in a local DOV borehole XML file."""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.parsers.borehole.dov.interpretation_parse_result import (
    InterpretationParseResult,
)


@dataclass
class DovFileInterpretation:
    """An interpretation stream element parsed out of a local DOV file.

    Parameters
    ----------
    observation_type : ObservationType
        Stream the element belongs to (from its tag).
    permkey : str | None
        The interpretation's own DOV permkey (``dataidentifier/permkey``);
        stored as ``Observation.dov_permkey`` so a refresh matches it and a
        later bbox import of the same boring does not duplicate it.
    result : InterpretationParseResult
        Parsed observation (layers nested) plus the stream parser's issues.
    is_primary : bool
        True for the ONE lithological description the import uses (the one
        with the most layers) when a boring has several.
    """

    observation_type: ObservationType
    permkey: str | None
    result: InterpretationParseResult
    is_primary: bool = False

    @property
    def n_layers(self) -> int:
        """Return the number of parsed (valid) layers."""
        return len(self.result.observation.layers)
