# -*- coding: utf-8 -*-
"""Every exercise in the workbook, addressable, read out of the built page.

    python build/exercises.py            # print what it found, change nothing

The pad's check button used to name only the topic. That is not enough to mark against:
a topic has nine exercises across three rungs, the rung-3 ones have lettered sections,
and "check my work on fractions" leaves Claude to guess which question it is looking at.
So the pad now picks block -> exercise -> section, and this is where that list comes from.

**It is read from `pages/workbook.html`, not from `content.py`, and that is deliberate.**
`content.py` holds only the exercises per rung that `rebuild.py` *adds*; the first one of
every rung was already on the page and lives in `workbook.base.html`. What Avi sees is what
he has to be able to choose from, and the built page is the only place all of them exist
together — it is also the exact thing he is reading.

The maths comes back out as LaTeX rather than as rendered glyphs: KaTeX keeps the source
in `<annotation encoding="application/x-tex">`, so the text handed to Claude reads as
`\\dfrac{x^{2}-9}{x+3}=2` instead of a pile of positioned spans.
"""
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
BUILT = HERE.parent / "pages" / "workbook.html"

# The rung names are NOT retyped here. `rebuild.py` is what prints them onto the page, so
# it is what they mean; a second copy would read the same today and drift the day one of
# them is renamed — and the pad would then offer a rung the workbook does not have.
from blockre import BLOCK  # noqa: E402
from content import BLOCKS  # noqa: E402
from rebuild import RUNG_NAME  # noqa: E402

LETTERS = "אבגדהוזחט"


class _Text(HTMLParser):
    """A KaTeX-rendered fragment as readable text.

    Inside a `span.katex` everything visible is dropped and the annotation's TeX is kept
    instead — the two are the same formula twice, once for eyes and once for machines, and
    the second one is the one worth sending.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self._katex = 0          # tag depth inside a katex span, 0 when outside
        self._annotation = False

    def handle_starttag(self, tag, attrs):
        cls = dict(attrs).get("class", "")
        if self._katex:
            self._katex += 1
            if tag == "annotation":
                self._annotation = True
            return
        if tag == "span" and "katex" in cls.split():
            self._katex = 1
            # Each formula leaves wrapped in $…$. The pad renders the exercise, and without
            # a boundary it cannot tell where the Hebrew ends and the TeX begins; the prompt
            # quotes the same text, and $…$ is also the notation Claude is asked to answer in.
            self.out.append("$")
            return
        if tag == "br":
            self.out.append(" ")

    def handle_endtag(self, tag):
        if self._katex:
            if tag == "annotation":
                self._annotation = False
            self._katex -= 1
            if not self._katex:
                self.out.append("$")

    def handle_data(self, data):
        if self._katex and not self._annotation:
            return
        self.out.append(data)

    def text(self) -> str:
        s = "".join(self.out)
        s = s.replace(" ", " ")
        return re.sub(r"\s+", " ", s).strip()


def plain(fragment: str) -> str:
    p = _Text()
    p.feed(fragment)
    p.close()
    return p.text()


def sections(text: str) -> list[str]:
    """The lettered parts of an exercise, in the order they appear.

    Read off the plain text (`א.` `ב.` …) rather than off `<b>` tags: the bold is how the
    workbook happens to mark them today, the letter followed by a dot is what they ARE.
    """
    found = [m.group(1) for m in re.finditer(r"(?:^|\s)([" + LETTERS + r"])\.", text)]
    seen: list[str] = []
    for f in found:
        if f not in seen:
            seen.append(f)
    # A single stray letter is not a section list; two in order is.
    return seen if len(seen) >= 2 else []


def blocks() -> dict[str, list[dict]]:
    """block id -> its exercises, in the order the page shows them."""
    if not BUILT.exists():
        raise SystemExit(f"{BUILT} is not there — build the workbook first")
    page = BUILT.read_text(encoding="utf-8")

    out: dict[str, list[dict]] = {}
    # The pattern lives in build/blockre.py. Four files were matching it literally,
    # and giving the blocks ids broke all four at once. It still excludes the trinomial
    # guide, which is `class="block guide"`.
    for art in BLOCK.finditer(page):
        body = art.group(1)
        num = re.search(r'class="bnum">(\d\d)</span>', body)
        if not num:
            continue
        found: list[dict] = []
        for rung in re.finditer(r'<div class="rung r(\d)">([\s\S]*?)(?=\n\s*<div class="rung |\Z)', body):
            tier = rung.group(1)
            for qx in re.finditer(r'<div class="qx">([\s\S]*?)</div>', rung.group(2)):
                inner = qx.group(1)
                n = re.search(r'<span class="qn">\s*תרגיל\s*(\d+)\s*</span>', inner)
                # EVERY paragraph, not the first. A lettered exercise puts each section in
                # its own <p class="q">, so taking one of them silently dropped section ב
                # onwards — and with it the very thing this file exists to name.
                qs = re.findall(r'<p class="q">([\s\S]*?)</p>', inner)
                if not n or not qs:
                    continue
                text = " ".join(plain(q) for q in qs).strip()
                found.append(
                    {
                        "tier": tier,
                        "n": int(n.group(1)),
                        "label": f"מדרגה {tier} · {RUNG_NAME[tier]} · תרגיל {n.group(1)}",
                        "text": text,
                        "sections": sections(text),
                    }
                )
        out[num.group(1)] = found
    return out


def main() -> int:
    found = blocks()
    total = sum(len(v) for v in found.values())
    for bid in sorted(found):
        ex = found[bid]
        withsec = sum(1 for e in ex if e["sections"])
        print(f"{bid}: {len(ex)} exercises, {withsec} with sections")
        for e in ex:
            secs = "".join(e["sections"]) or "-"
            print(f"    {e['label']:<34} [{secs}]  {e['text'][:64]}")
    print(f"\n{total} exercises in {len(found)} blocks")
    # The expected count is DERIVED, not a magic number. It used to be a literal 90 —
    # ten blocks, three rungs, three exercises — and the day block 01 grew a fourth
    # bagrut exercise that literal turned a correct page into a failing run. What has
    # to hold is that the page carries exactly what its two sources put there: one
    # exercise per rung from `workbook.base.html`, plus whatever `content.py` adds.
    want = sum(3 + sum(len(v) for v in b["new"].values()) for b in BLOCKS.values())
    if total != want:
        print(f"expected {want} — 3 per block from the base plus {want - 30} from "
              f"content.py — got {total}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
