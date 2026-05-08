"""Field log kind enum — type of field-recorded property logged during drilling."""

from enum import StrEnum


class FieldLogKind(StrEnum):
    """Kind of field-recorded property logged at a depth interval during drilling.

    These are direct observations made by the driller while drilling, not
    interpretations. Three kinds are common in DOV borehole records:

    * COLOR — soil colour (e.g. "groenbruin", "groengrijs").
    * MOISTURE — moisture state (e.g. "weinig vochtig", "vochtig", "verzadigd").
    * CONSISTENCY — consistency (e.g. "plastisch").

    Values are stored as plain strings — the source vocabulary is open (DOV uses
    Dutch terms; later parsers may use other vocabularies).
    """

    COLOR = "color"
    MOISTURE = "moisture"
    CONSISTENCY = "consistency"
