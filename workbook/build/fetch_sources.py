"""Download the official Ministry of Education sources the build reads, and extract them.

    python build/fetch_sources.py            # only what is missing
    python build/fetch_sources.py --force    # everything again

The exam papers, the formula sheet and the תשפ"ז rule documents are the Ministry's, not
this project's, so they are not in the repository (GPL cannot license what it does not
own). Every script here reads the TEXT, so this fetches each PDF from the official site
and runs `pdftotext -layout -enc UTF-8` on it — the same extraction the tools were built
against. Needs `pdftotext` (poppler) on PATH.

What lands where:
    exams/text/<paper>_<year>_<moed>.txt   35571 + 35572, 2022-2026 (the 32 sittings)
    exams/old/<paper>_2026_6.txt           35581 + 35582, summer 2026, for the old/new comparison
    exams/rules/*.txt                      the three תשפ"ז documents (see data/tashpaz.json)
    data/nushaon.txt                       the 5-unit formula sheet
"""
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = "https://meyda.education.gov.il/sheeloney_bagrut/{year}/{moed}/HEB/{paper}.pdf"
MAFMAR = "https://meyda.education.gov.il/files/Pop/0files/matmatika/Chativa-Elyona/mafmar/"

# moed codes in the archive: 1 = winter, 2 = winter (absentees), 6 = summer A, 8 = summer B.
# Not every year has every moed; this is the set the tools were built on.
SITTINGS = [(2022, 1), (2022, 2), (2022, 6), (2022, 8),
            (2023, 1), (2023, 6), (2023, 8),
            (2024, 1), (2024, 6), (2024, 8),
            (2025, 1), (2025, 6), (2025, 8),
            (2026, 1), (2026, 6), (2026, 8)]

SOURCES: list[tuple[str, Path]] = [
    *[(ARCHIVE.format(year=y, moed=m, paper=p), ROOT / "exams" / "text" / f"{p}_{y}_{m}.txt")
      for p in ("35571", "35572") for y, m in SITTINGS],
    *[(ARCHIVE.format(year=2026, moed=6, paper=p), ROOT / "exams" / "old" / f"{p}_2026_6.txt")
      for p in ("35581", "35582")],
    (MAFMAR + "hozer-mafmar-tashpaz.pdf", ROOT / "exams" / "rules" / "hozer-mafmar-tashpaz.txt"),
    (MAFMAR + "exams-time.pdf", ROOT / "exams" / "rules" / "tashpaz-answer-rules.txt"),
    (MAFMAR + "Topics-not-be-taught-in-Tashpaz.pdf", ROOT / "exams" / "rules" / "tashpaz-not-taught.txt"),
    ("https://meyda.education.gov.il/files/Pop/0files/matmatika/Chativa-Elyona/new-curriculum/"
     "5-MATH-Formula_NEW.pdf", ROOT / "data" / "nushaon.txt"),
]


def main() -> int:
    force = "--force" in sys.argv
    pdftotext = shutil.which("pdftotext")
    if not pdftotext:
        raise SystemExit("pdftotext not found - install poppler (e.g. `choco install poppler`)")

    failed = []
    with tempfile.TemporaryDirectory() as tmp:
        for url, out in SOURCES:
            if out.exists() and not force:
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            pdf = Path(tmp) / "source.pdf"
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=60) as r:
                    pdf.write_bytes(r.read())
                subprocess.run([pdftotext, "-layout", "-enc", "UTF-8", str(pdf), str(out)], check=True)
                print("ok  ", out.relative_to(ROOT))
            except Exception as e:  # noqa: BLE001 - report every failure, then exit non-zero
                failed.append(url)
                print("FAIL", out.relative_to(ROOT), "-", e)

    if failed:
        print(f"\n{len(failed)} failed. The archive moves files between years now and then;"
              " check the URL in a browser.")
        return 1
    print("all sources present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
