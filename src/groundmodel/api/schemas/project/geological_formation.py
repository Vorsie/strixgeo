"""Pydantic schemas for the geological-formation API surface."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from groundmodel.api.schemas.strict_request_model import StrictRequestModel
from groundmodel.domain.services.nad_classifier import class_belongs_to_soil, soil_family_of


class GeologicalFormationCreateRequest(StrictRequestModel):
    """Body of ``POST /projects/{id}/geology/formations``.

    ``name`` is the only required field. Colour defaults at the API
    layer when the caller omits it so the DB column stays NOT NULL.
    """

    name: str = Field(min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def name_must_not_be_whitespace_only(cls, v: str) -> str:
        """Reject names that are entirely whitespace.

        Parameters
        ----------
        v : str
            The incoming name value (already checked for min_length=1
            by the Field constraint, so it is at least one character).

        Returns
        -------
        str
            The original (un-stripped) name value when valid.

        Raises
        ------
        ValueError
            When the name is non-empty but consists only of whitespace.
        """
        # Pydantic's min_length=1 passes a single space — add an explicit
        # strip check so whitespace-only strings are rejected with 422.
        if not v.strip():
            raise ValueError("name must not be whitespace-only")
        return v

    color: str = Field(default="#9ca3af", max_length=20)
    code: str | None = Field(default=None, max_length=50)
    display_order: int = 0
    # Debt #35: a freshly created / seeded formation is NOT pinned —
    # it should still get Build's data-driven age ordering. Only an
    # explicit manual drag-reorder pins it (via the PATCH below).
    pinned_order: bool = False
    regional_ref: str | None = Field(default=None, max_length=200)
    description: str | None = None
    # Three-level hierarchy unit attributes — NULL on a geological
    # formation; set on litho (lithology) / geotech (nad_class) units.
    # Vocabulary validation lands with slice 2; the column is
    # free-text here so the schema doesn't gate ahead of the codelist.
    lithology: str | None = Field(default=None, max_length=20)
    nad_class: int | None = Field(default=None, ge=1, le=31)
    # Litho-unit fields — only set when creating a lithostratigraphic
    # child formation (Bug 2 dogfeed 2026-05-26: "Add new unit" must be
    # able to create the formation row WITHOUT an accompanying contact).
    # ``parent_formation_id`` links this unit to its geological parent
    # formation.  ``litho_main_soil_code`` is the primary Robertson-SBT
    # code (e.g. "ZAND", "KLEI").  ``litho_admixtures`` is the JSONB
    # array serialised from ``AdmixtureItem`` on the client side.
    # All three are optional so the endpoint remains fully backwards-
    # compatible for geological formation creation (where they are absent).
    parent_formation_id: UUID | None = None
    litho_main_soil_code: str | None = Field(default=None, max_length=20)
    litho_admixtures: list[dict] | None = None

    @model_validator(mode="after")
    def nad_class_must_belong_to_the_soil(self) -> GeologicalFormationCreateRequest:
        """Refuse a packing class from a soil family other than this unit's.

        Owner ruling 2026-08-26: *"no a zand body can never carry a silt
        packing class"* — *"the nad coupling is absolute."* The two fields
        arrive together on this request, so the coupling is checkable here and
        the caller gets a 422 naming the family rather than a row that
        contradicts itself.

        Returns
        -------
        GeologicalFormationCreateRequest
            The unchanged request when the class belongs to the soil, or when
            either field is absent (a geological formation carries neither).

        Raises
        ------
        ValueError
            When both fields are present and the class belongs to a different
            soil family. Pydantic surfaces this as a 422.
        """
        if not class_belongs_to_soil(self.nad_class, self.litho_main_soil_code):
            raise ValueError(
                f"NAD class {self.nad_class} belongs to "
                f"{soil_family_of(self.nad_class)}, not to {self.litho_main_soil_code}. "
                "The coupling between a unit's soil and its packing class is absolute: "
                "a packing class describes one soil column and is never valid on another."
            )
        return self


class GeologicalFormationUpdateRequest(StrictRequestModel):
    """Body of ``PATCH /projects/{id}/geology/formations/{fid}``.

    Every field is optional — only keys present in the request body are
    written. Send ``null`` for an optional field to clear it.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    color: str | None = Field(default=None, max_length=20)
    # The engineer's own colour choice. Send a hex string to set it; send an
    # explicit ``null`` to reset the unit to its automatic colour. Omitting the
    # key leaves whatever choice was already made untouched (``exclude_unset``
    # in the router is what makes the three cases distinct).
    color_override: str | None = Field(default=None, max_length=20)
    code: str | None = Field(default=None, max_length=50)
    display_order: int | None = None
    # Debt #35: the drag-end reorder sends ``pinned_order=True``
    # alongside the new ``display_order`` so Build's age-inference
    # leaves this formation alone thereafter.
    pinned_order: bool | None = None
    regional_ref: str | None = Field(default=None, max_length=200)
    description: str | None = None
    lithology: str | None = Field(default=None, max_length=20)
    nad_class: int | None = Field(default=None, ge=1, le=31)
    # Phase-2 Slice 2: the LithologyInspector lock-toggle PATCHes this
    # field to freeze a formation's instance_ordinal so the auto-resolver
    # leaves it untouched.  When True the resolver skips this row unless
    # it is a lock-conflict loser.  When False the resolver may renumber.
    instance_ordinal_locked: bool | None = None
    # Debt #87: cleared to False when the engineer confirms the
    # TIN-extrapolated parent (or reassigns it). The PATCH is also used
    # by the Detach action (parent_formation_id=null + parent_extrapolated=false
    # in one call). Never sent True from the UI — only Accept stamps True.
    parent_extrapolated: bool | None = None
    # Allow Detach to explicitly clear parent_formation_id alongside the
    # extrapolated flag. Sent as null to clear; omitted to leave unchanged.
    parent_formation_id: UUID | None = None


class GeologicalFormationResponse(BaseModel):
    """API representation of a GeologicalFormation row.

    Includes the Phase 1 litho-builder columns (``parent_formation_id``,
    ``litho_main_soil_code``, ``litho_admixtures``, ``instance_ordinal``).
    These are ``None`` on geological-model formations and populated on
    lithostratigraphic formations created by ``AcceptLithoSuggestions``.

    Includes the geotech-stage dual-reference columns
    (``source_litho_formation_id``, ``source_geo_formation_id``) that
    record the explicit provenance of a geotech unit — which litho formation
    it subdivides and which geological formation it sits within (spec §3).
    Both are ``None`` on geological- and litho-model rows.

    ``parent_formation_name`` is a server-resolved display value derived from
    the project formation set (the name of the formation whose id equals
    ``parent_formation_id``).  It is ``None`` on geological-model rows
    (which have no parent) and on litho units whose parent id is not found
    in the project (defensive / orphan case).  Never persisted — computed on
    read per Data Integrity Rule §1 (compute on read over store-derived).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    app_project_id: UUID
    name: str
    color: str
    # ``None`` until the engineer picks a colour for this unit; his pick then
    # wins over the automatic colour on every surface that draws the unit.
    color_override: str | None = None
    code: str | None
    display_order: int
    pinned_order: bool
    regional_ref: str | None
    description: str | None
    lithology: str | None
    nad_class: int | None
    # Litho-builder Phase 1 fields — NULL on geological-model rows.
    parent_formation_id: UUID | None = None
    # Geotech-stage dual-reference columns (spec §3).
    # ``source_litho_formation_id`` — the lithostratigraphic formation this
    # geotech unit subdivides; NULL on geological- and litho-model rows.
    # ``source_geo_formation_id`` — the geological formation the unit sits
    # within; NULL on geological- and litho-model rows.  Both are additive
    # optional fields so legacy API consumers that predate the geotech stage
    # receive ``None`` and continue to function without modification.
    source_litho_formation_id: UUID | None = None
    source_geo_formation_id: UUID | None = None
    # Debt #87: True when ``parent_formation_id`` was inferred from TIN
    # extrapolation rather than from a geology contact at the investigation
    # the litho unit was created on. The LithologyInspector renders an
    # amber dot + "extrapolated" tooltip on flagged units and offers a
    # confirm/reassign/detach dialog that PATCHes this flag to false.
    parent_extrapolated: bool = False
    litho_main_soil_code: str | None = None
    # JSONB list of {"soil_code": str, "amount": str, "locally": bool} dicts.
    # NULL on geological rows; [] on a litho unit with no admixtures.
    litho_admixtures: list[Any] | None = None
    instance_ordinal: int | None = None
    instance_ordinal_locked: bool = False
    # Slice 5 / debt #67: server-resolved display name of the parent geological
    # formation.  Populated from the project-formation id→name map at response
    # time; never stored in the DB.  None on geological rows and on orphaned
    # litho units whose parent id is not present in the project set.
    parent_formation_name: str | None = None
    # Server-resolved ``code`` of the parent geological formation (the DOV
    # codelist code), resolved from the project formation id→code map at
    # response time; never stored on the litho row. Drives the lens auto-name
    # (``{parent code}{lithology abbrev}{depth rank}`` e.g. ``QPSa1``). None on
    # geological rows and on orphans / parents without a code.
    parent_formation_code: str | None = None
    created_at: datetime
    updated_at: datetime
