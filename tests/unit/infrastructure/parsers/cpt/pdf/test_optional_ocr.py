"""OCR stays optional (owner 2026-09-30, answer 6).

"the vector path must work with PyMuPDF only; rapidocr + its OpenCV are an
optional extra group ``pdf-ocr``, imported lazily". So: the digitiser ships
with PyMuPDF as a runtime dependency, OCR and OpenCV ride in the optional
extra, every module of the package imports without them (the packaged
installer's smoke gate imports each compiled module), and a vector report is
triaged and digitised with neither installed.
"""

from __future__ import annotations

import subprocess
import sys
import textwrap
import tomllib
from pathlib import Path

import pytest

from . import _synthetic_cpt_pdf as synth

REPO = Path(__file__).resolve().parents[6]

# A meta-path finder that makes ``import cv2`` / ``import rapidocr_onnxruntime``
# fail, the way they fail in the packaged tree that ships without the extra.
_BLOCK_OPTIONAL = textwrap.dedent(
    """
    import sys
    class _Block:
        def find_spec(self, name, path=None, target=None):
            if name.split('.')[0] in {'cv2', 'rapidocr_onnxruntime'}:
                raise ImportError(f'{name} blocked: not installed')
            return None
    sys.meta_path.insert(0, _Block())
    """
)


def _run_without_optional(body: str) -> subprocess.CompletedProcess[str]:
    """Run ``body`` in a fresh interpreter where cv2 and rapidocr cannot import."""
    code = _BLOCK_OPTIONAL + textwrap.dedent(body)
    return subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        timeout=180,
        cwd=REPO,
    )


def test_pymupdf_is_a_runtime_dependency_and_ocr_an_optional_extra() -> None:
    """PyMuPDF ships; rapidocr + OpenCV sit in the optional ``pdf-ocr`` extra."""
    project = tomllib.loads((REPO / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    runtime = " ".join(project["dependencies"])
    assert "pymupdf" in runtime
    assert "rapidocr" not in runtime
    assert "opencv" not in runtime
    extra = " ".join(project["optional-dependencies"]["pdf-ocr"])
    assert "rapidocr-onnxruntime" in extra
    assert "opencv-python" in extra


def test_every_digitiser_module_imports_without_opencv_or_ocr() -> None:
    """Every module imports with only PyMuPDF (the installer imports each one)."""
    package = REPO / "src" / "groundmodel" / "infrastructure" / "parsers" / "cpt" / "pdf"
    modules = sorted(p.stem for p in package.glob("*.py") if p.stem != "__init__")
    result = _run_without_optional(
        f"""
        import importlib
        for name in {modules!r}:
            importlib.import_module('groundmodel.infrastructure.parsers.cpt.pdf.' + name)
        print('imported', len({modules!r}))
        """
    )
    assert result.returncode == 0, result.stderr[-2000:]


@pytest.fixture(scope="module")
def synthetic_report(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A one-sounding vector report written to disk."""
    path = tmp_path_factory.mktemp("pdf") / "report.pdf"
    doc = synth.synthetic_cpt_pdf()
    for page in doc:
        page.insert_text((300, 20), "DOCUMENTNAAM : Proefverslag TEST-001", fontsize=6)
    doc.save(path)
    return path


def test_a_vector_report_is_triaged_and_digitised_with_pymupdf_only(
    synthetic_report: Path,
) -> None:
    """A vector report is triaged and digitised with PyMuPDF only; OCR reads as absent."""
    result = _run_without_optional(
        f"""
        import logging, pymupdf
        logging.disable(logging.CRITICAL)
        from groundmodel.infrastructure.parsers.cpt.pdf.optional_engines import ocr_available
        from groundmodel.infrastructure.parsers.cpt.pdf.page_triage import PageTriage
        from groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser import CptPdfDigitiser
        doc = pymupdf.open({str(synthetic_report)!r})
        triage = PageTriage().classify(doc)
        soundings = CptPdfDigitiser().digitise_report(doc, triage)
        print('ocr', ocr_available())
        print('soundings', len(soundings), sorted(k.value for k in soundings[0].curves))
        """
    )
    assert result.returncode == 0, result.stderr[-2000:]
    assert "ocr False" in result.stdout
    assert "soundings 1 ['fs', 'qc']" in result.stdout
