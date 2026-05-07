"""Parsed GEF file header — metadata, coordinates, and column mapping."""

from dataclasses import dataclass, field


@dataclass
class GEFHeader:
    """Parsed GEF file header — metadata, coordinates, column mapping."""

    project_id: str = ""
    test_id: str = ""
    file_date: str = ""
    company: str = ""
    report_code: str = ""

    x: float | None = None
    y: float | None = None
    z: float | None = None
    epsg: int | None = None  # horizontal CRS from #XYID (e.g. 32000 = Belgian Lambert 72)
    z_epsg: int | None = None  # vertical datum from #ZID (e.g. 32001 = Belgian mTAW/NGF)

    pre_drill_m: float = 0.0
    # MVAR 14 — unreliable in practice; prefer piezometer data for pore pressure normalisation.
    water_depth_m: float | None = None
    net_area_ratio: float | None = None
    stop_criterion: int | None = None
    cone_type_code: int | None = None  # 0=electric, 1=mechanical

    # 1-based column number → GEF quantity number
    column_map: dict[int, int] = field(default_factory=dict)
    # 1-based column number → unit string (lower-cased)
    unit_map: dict[int, str] = field(default_factory=dict)
    # 1-based column number → void value
    void_map: dict[int, float] = field(default_factory=dict)

    n_columns: int = 0
