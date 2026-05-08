"""Field log kind enum — type of field-recorded property logged during drilling."""

from enum import StrEnum


class FieldLogKind(StrEnum):
    """Kind of field-recorded property logged at a depth interval during drilling.

    These are direct observations made by the driller while drilling, not
    interpretations. Three kinds are common in DOV borehole records:

    * COLOR — soil colour
      (DOV examples: "groenbruin" = green-brown, "groengrijs" = green-grey).
    * MOISTURE — moisture state
      (DOV examples: "weinig vochtig" = slightly moist, "vochtig" = moist,
      "verzadigd" = saturated).
    * CONSISTENCY — consistency (DOV example: "plastisch" = plastic).

    Values are stored as plain strings — the source vocabulary is open (DOV uses
    Dutch terms; later parsers may use other vocabularies).
    """

    COLOR = "color"
    MOISTURE = "moisture"
    CONSISTENCY = "consistency"
