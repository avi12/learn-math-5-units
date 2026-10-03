# -*- coding: utf-8 -*-
"""One dossier per teaching unit, so the coverage audit reads data and not markup.

    python build/coverdata.py [outdir]

Avi found a hole by reading: block 01 rung 3 exercise 1 opens on ⟦|2x-1|<5⟧, and nothing
in that block — not the how-to, not its one video — ever says how an inequality or an
absolute value is handled. The question this file exists to make answerable, for every
exercise rather than the one he happened to open, is:

    does the unit that carries this exercise explain, in words and on video, every
    technique the exercise actually needs?

Answering it is a reading job, not a grep job, so the point here is only to put each
unit's teaching and its exercises side by side in one small file. Both pools are covered:

  * the workbook — ten topic blocks plus the trinom guide, each with a how-to, a trap and
    video cards, and nine exercises
  * the sittings page — 72 real exam questions, each with its `techniques` list and three
    derived exercises

Maths comes out as LaTeX, not as glyphs: `plain()` in build/exercises.py already keeps
the `<annotation>` and drops the rendered spans, and it is imported rather than repeated.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
ROOT = HERE.parent

from exercises import plain, sections  # noqa: E402
from rebuild import RUNG_NAME  # noqa: E402

WORKBOOK = ROOT / "pages" / "workbook.html"
DERIVED = ROOT / "data" / "derived"
VIDS = json.loads((ROOT / "data" / "blockvids.json").read_text(encoding="utf-8"))

TIER_NAME = {"warm": "1 · חימום", "mid": "2 · ביניים", "bagrut": "3 · רמת בגרות"}


def vid_line(url: str) -> str:
    """A video card as one line — id, kind, title, channel.

    The thumbnails in blockvids.json are base64 JPEGs; carrying those into a dossier
    would be tens of kilobytes of nothing an auditor can read.
    """
    key = re.search(r"(?:watch\?v=|playlist\?list=)([\w-]+)", url)
    meta = VIDS.get(key.group(1), {}) if key else {}
    kind = "פלייליסט" if meta.get("kind") == "p" else "סרטון"
    return f"  [{kind}] {meta.get('title', '(no title)')} — {meta.get('author', '?')}\n    {url}"


# --------------------------------------------------------------- workbook ---
# Not blockre.BLOCK: this one WANTS the trinomial guide, and captures the class suffix
# to tell it apart. It only has to stop assuming the class is the last thing in the tag.
BLOCK = re.compile(r'<article class="block([^"]*)"[^>]*>([\s\S]*?)</article>')


def workbook_units() -> list[dict]:
    page = WORKBOOK.read_text(encoding="utf-8")
    units = []
    for m in BLOCK.finditer(page):
        body = m.group(2)
        num = re.search(r'class="bnum">([^<]+)</span>', body)
        title = re.search(r"<h3>([\s\S]*?)</h3>", body)
        if not title:
            continue
        bid = plain(num.group(1)) if num else "00"
        why = re.search(r'<p class="bwhy">([\s\S]*?)</p>', body)
        howto = re.search(r'<div class="howto[^"]*">([\s\S]*?)</div>\s*(?=<div|<details|<p class="trap")',
                          body)
        steps = []
        if howto:
            for li in re.finditer(r"<li>([\s\S]*?)</li>", howto.group(1)):
                steps.append(plain(li.group(1)))
        trap = re.search(r'<p class="trap">([\s\S]*?)</p>', body)
        vids = [vid_line(u) for u in re.findall(r'class="bvid" href="([^"]+)"', body)]

        ex = []
        for rung in re.finditer(r'<div class="rung r(\d)">([\s\S]*?)(?=\n\s*<div class="rung |\Z)', body):
            for qx in re.finditer(r'<div class="qx">([\s\S]*?)</div>', rung.group(2)):
                n = re.search(r'<span class="qn">\s*תרגיל\s*(\d+)\s*</span>', qx.group(1))
                qs = re.findall(r'<p class="q">([\s\S]*?)</p>', qx.group(1))
                if not n or not qs:
                    continue
                text = " ".join(plain(q) for q in qs).strip()
                ex.append({"label": f"מדרגה {rung.group(1)} · {RUNG_NAME[rung.group(1)]} · "
                                    f"תרגיל {n.group(1)}",
                           "text": text, "sections": sections(text)})
        units.append({"id": bid, "title": plain(title.group(1)),
                      "why": plain(why.group(1)) if why else "",
                      "steps": steps, "trap": plain(trap.group(1)) if trap else "",
                      "vids": vids, "ex": ex,
                      "guide": "guide" in m.group(1)})
    return units


def workbook_dossier(u: dict) -> str:
    out = [f"# חוברת · בלוק {u['id']} — {u['title']}", ""]
    if u["guide"]:
        out += ["(מדריך, לא בלוק נושא — אין לו מדרגות)", ""]
    out += ["## ה\"למה\" של הבלוק", u["why"] or "(אין)", ""]
    out += [f"## הסבר \"איך פותרים\" — {len(u['steps'])} צעדים"]
    out += [f"{i}. {s}" for i, s in enumerate(u["steps"], 1)] or ["(אין הסבר!)"]
    out += ["", "## המלכודת", u["trap"] or "(אין)", ""]
    out += [f"## סרטונים מצורפים לבלוק — {len(u['vids'])}"]
    out += u["vids"] or ["  (אין סרטון!)"]
    out += ["", f"## התרגילים — {len(u['ex'])}"]
    for e in u["ex"]:
        secs = "".join(e["sections"]) or "ללא סעיפים"
        out += ["", f"### {e['label']}  [{secs}]", e["text"]]
    return "\n".join(out) + "\n"


# --------------------------------------------------------------- sittings ---
MOED = {"1": "חורף", "6": "קיץ א׳", "8": "קיץ ב׳"}


def sitting_dossier(paper: str) -> str:
    year, moed = paper.split("_")[1:3]
    out = [f"# מועדים · שאלון 35571 · {MOED[moed]} {year}", "",
           "לדף הזה **אין סרטונים בכלל** — הטקסט ההסברי היחיד לכל שאלה הוא רשימת",
           "ה־techniques שלה. זה נתון, לא ממצא; מה שנבדק הוא אם הרשימה מכסה את מה",
           "שהתרגילים באמת דורשים.", ""]
    for n in range(1, 9):
        f = DERIVED / f"{paper}_q{n}.json"
        if not f.exists():
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        out += ["", "=" * 70, f"## שאלה {n} — {d['topic']}", "",
                f"מה השאלה המקורית ביקשה: {d['source_shape']}", "",
                f"### techniques — ההסבר היחיד שיש ({len(d['techniques'])})"]
        out += [f"{i}. {t}" for i, t in enumerate(d["techniques"], 1)]
        out += ["", "### התרגילים"]
        by = {e["tier"]: e for e in d["exercises"]}
        for tier in ("warm", "mid", "bagrut"):
            e = by.get(tier)
            if e:
                out += ["", f"#### מדרגה {TIER_NAME[tier]}", e["q"]]
    return "\n".join(out) + "\n"


def main() -> int:
    outdir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "build" / "cover"
    outdir.mkdir(parents=True, exist_ok=True)
    for f in outdir.glob("*.md"):
        f.unlink()

    units = workbook_units()
    nex = 0
    for u in units:
        name = f"workbook-{u['id']}.md" if not u["guide"] else "workbook-guide-trinom.md"
        (outdir / name).write_bytes(workbook_dossier(u).encode("utf-8"))
        nex += len(u["ex"])
    print(f"workbook: {len(units)} units, {nex} exercises")

    papers = sorted({f.name.rsplit("_", 1)[0] for f in DERIVED.glob("35571_*.json")})
    for p in papers:
        (outdir / f"sitting-{p}.md").write_bytes(sitting_dossier(p).encode("utf-8"))
    print(f"sittings: {len(papers)} papers, {len(papers) * 8} questions, "
          f"{len(papers) * 24} exercises")

    kb = sum(f.stat().st_size for f in outdir.glob("*.md")) // 1024
    print(f"{len(list(outdir.glob('*.md')))} dossiers in {outdir}, {kb} kb total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
