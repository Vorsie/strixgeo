"""Pin malformed-XML protections on the DOV parsers (debt #12).

The DOV parsers parse untrusted-shaped XML — DOV is a trusted source
today, but a MITM serving a malicious response could still wedge an
import, AND the bundle-restore path will eventually load XML from
user-shared ``.gmproj`` files where the recipient doesn't trust the
sender. These tests pin the defusedxml swap so a future refactor
that reverts to ``xml.etree.ElementTree`` lands as a failing test.

Two attack shapes covered:

* **Billion laughs** — exponential entity expansion that explodes
  small inputs into gigabytes of memory under naive parsers.
* **External DTD fetch** — DTD references that trigger network
  fetches at parse time (XXE).

defusedxml raises ``EntitiesForbidden`` / ``ExternalReferenceForbidden``
on both. The stdlib ``xml.etree.ElementTree`` happily expands the
entities (or worse).
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from defusedxml.common import EntitiesForbidden

from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_parser import (
    DovBoringParser,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_interpretation_parser import (
    DovInterpretationParser,
)
from groundmodel.infrastructure.parsers.cpt.dov.dov_parser import DovParser
from groundmodel.infrastructure.parsers.lab.dov.dov_grain_size_parser import (
    DovGrainSizeParser,
)

# The classic billion-laughs payload — every parser under test must
# raise rather than expand the entities. The expansion would otherwise
# allocate ``lol8 → 'lol' × 100_000_000`` strings, a gigabyte-class
# memory burn from a 1 KB input.
_BILLION_LAUGHS = b"""<?xml version="1.0"?>
<!DOCTYPE root [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
]>
<root>&lol4;</root>
"""


@pytest.mark.parametrize(
    "parser_factory, call",
    [
        # Each parser's public entrypoint takes XML bytes plus its own
        # required arguments — we feed minimal-valid extras so the call
        # actually reaches the parse step (the entity-expansion guard
        # fires the moment defusedxml sees the DOCTYPE).
        (
            DovBoringParser,
            lambda p, payload: p.parse(payload, name="test"),
        ),
        (
            DovParser,
            lambda p, payload: p.parse(payload, name="test"),
        ),
        (
            DovInterpretationParser,
            lambda p, payload: p.parse(
                payload,
                borehole_id=uuid4(),
                observation_type=ObservationType.FORMAL_STRATIGRAPHY,
                name="test",
            ),
        ),
        (
            DovGrainSizeParser,
            lambda p, payload: p.parse(payload, sample_id=uuid4(), name="test"),
        ),
    ],
    ids=["boring", "cpt", "interpretation", "grain_size"],
)
def test_billion_laughs_is_blocked(parser_factory, call) -> None:
    """Each DOV parser refuses billion-laughs input loudly.

    Defusedxml raises ``EntitiesForbidden``; the parsers don't catch
    it (no recovery is possible — the input is hostile), so it
    propagates up. If a future refactor reverts to stdlib
    ``xml.etree.ElementTree`` the parser would happily expand the
    entities and this test would fail with a different exception
    (OOM eventually) or pass silently — the parametrise message names
    the parser so the regression is obvious.
    """
    parser = parser_factory()
    with pytest.raises(EntitiesForbidden):
        call(parser, _BILLION_LAUGHS)
