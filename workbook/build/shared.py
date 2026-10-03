# -*- coding: utf-8 -*-
"""The look the workbook pages share with the pad, read from shared/skin/ — never copied.

    python workbook/build/shared.py     is the vendored skin still the global sheet? (exit 1 if not)

Before the monorepo this module PUSHED the Hebrew font stacks into four files across two
repos and checked two vendored copies of the global skin for drift, because neither repo
could import from the other. Now there is one copy of each thing, and both sides read it:

    shared/skin/cyberpunk.css   the global skin, vendored once      -> web app import, skin.py
    shared/skin/hebrew.css      the Hebrew font pairing             -> web app import, skin.py
    shared/skin/fonts.json      the Google Fonts URL for all of it  -> web index.html, skin.py

A NEW PAGE takes FONTS_LINK and layer1() from here rather than typing the stacks again —
that is how the pairing once drifted into three different answers.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIN = ROOT.parent / "shared" / "skin"
GLOBAL_SHEET = Path.home() / ".claude" / "artifact-cyberpunk.css"

_SHEET = (SKIN / "cyberpunk.css").read_text(encoding="utf-8")
_HEBREW = (SKIN / "hebrew.css").read_text(encoding="utf-8")


def layer1(drop: tuple[str, ...] = ()) -> str:
    """The tokens and base rules a page opens with: the global skin, then the Hebrew pairing.

    `drop` names top-level rules (by their exact selector) to leave out — for a page whose
    own component layer styles those things itself. The sheet stays one copy; what a
    consumer does not take is said where it is not taken.
    """
    sheet = _SHEET
    for sel in drop:
        sheet, n = re.subn(r"(?m)^" + re.escape(sel) + r"\s*\{[^{}]*\}\n?", "", sheet)
        if not n:
            raise SystemExit(f"shared/skin/cyberpunk.css has no rule `{sel} {{` to drop")
    return sheet.rstrip() + "\n\n" + _HEBREW.rstrip() + "\n"


FONTS_URL = json.loads((SKIN / "fonts.json").read_text(encoding="utf-8"))["url"]
FONTS_LINK = f'<link rel="stylesheet" href="{FONTS_URL}">'

#: Left-to-right mark, written before a label made of numbers joined by `·` — `2·1.`,
#: `571·572`, `35571 · 2024`. The middle dot is a bidi neutral, and a neutral between two
#: numbers in an RTL paragraph resolves to RTL, so the label reads backwards: `2·1.` shows
#: as `1·2`. The mark in front turns the digits LTR (rule W7) and the dot follows them.
#: Measured in a screenshot; it also works inside <title>, where <bdi> cannot go.
LRM = "‎"


def _tokens(path: Path) -> dict:
    """{selector: {--token: value}} for every block that declares custom properties."""
    out = {}
    text = re.sub(r"/\*.*?\*/", "", path.read_text(encoding="utf-8"), flags=re.S)
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*--[^{}]*)\}", text):
        decl = dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", body))
        if decl:
            out.setdefault(" ".join(sel.split()), {}).update({k: " ".join(v.split()) for k, v in decl.items()})
    return out


def verify() -> int:
    """Does the vendored copy still match the global sheet, token for token?

    Only meaningful on the author's machine, where the global sheet lives; anywhere else
    this says so and passes. A difference is reported, not fixed: re-vendoring the skin
    changes how both the pages and the pad look, so it is a decision, not a sync.
    """
    if not GLOBAL_SHEET.exists():
        print(f"SKIP     no global sheet at {GLOBAL_SHEET}")
        return 0
    g, here = _tokens(GLOBAL_SHEET), _tokens(SKIN / "cyberpunk.css")
    bad = 0
    for sel, toks in g.items():
        for tok, want in toks.items():
            have = here.get(sel, {}).get(tok)
            if have != want:
                print(f"PALETTE  {sel} {tok}\n           global {want}\n           here   {have}")
                bad += 1
    return bad


if __name__ == "__main__":
    n = verify()
    print("in step with the global sheet" if n == 0 else
          f"\n{n} differences - re-vendor shared/skin/cyberpunk.css if they are wanted")
    sys.exit(0 if n == 0 else 1)
