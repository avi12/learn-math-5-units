"""Apply data/cyberskin.css to the four published pages.

The skin has exactly one home (data/cyberskin.css). This script swaps it into
each page in place of the old Material 3 token block, and appends the HUD
component pass at the end of the page's own <style>. Idempotent: re-running
replaces what it wrote last time, so it can follow any page rebuild.
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from shared import FONTS_LINK as FONTS  # noqa: E402

ROOT = HERE.parent
SKIN = (ROOT / "data" / "cyberskin.css").read_text(encoding="utf-8")
PAGES = ["plan.html", "workbook.html", "eqpage.html", "powpage.html",
         "srcpage.html"]

# None of the pages declared one. As Artifacts they survived on the server's header,
# but opened from disk - or served by anything that does not say charset - Chrome falls
# back to Latin-1 and every Hebrew character on the page turns to mojibake.
CHARSET = '<meta charset="utf-8">'

MARK = "/* =================== LAYER 3 — HUD COMPONENT PASS ======================== */"
assert MARK in SKIN, "layer 3 marker missing from cyberskin.css"
head, layer3 = SKIN.split(MARK, 1)
layer3 = MARK + layer3

H_BEG, H_END = "/* CYBERSKIN:TOKENS:BEGIN */", "/* CYBERSKIN:TOKENS:END */"
L_BEG, L_END = "/* CYBERSKIN:PASS:BEGIN */", "/* CYBERSKIN:PASS:END */"

# The M3 token region every page opens with: :root{...} + the two dark blocks,
# ending right before the page's own body rule.
BODY_ANCHOR = "body{background:var(--surface);color:var(--on-surface);}"


def apply(path: Path) -> None:
    s = path.read_text(encoding="utf-8")

    # --- charset, before anything a browser has to guess at --------------
    if CHARSET not in s:
        s = CHARSET + "\n" + s

    # --- fonts ----------------------------------------------------------
    if FONTS not in s:
        s = re.sub(r"(</title>\n)", r"\1" + FONTS + "\n", s, count=1)

    # --- tokens ---------------------------------------------------------
    block = H_BEG + "\n" + head.rstrip() + "\n" + H_END + "\n"
    if H_BEG in s:
        s = re.sub(re.escape(H_BEG) + r".*?" + re.escape(H_END) + r"\n",
                   lambda _m: block, s, count=1, flags=re.S)
    else:
        i = s.index(":root{")
        j = s.index(BODY_ANCHOR)
        s = s[:i] + block + s[j:]

    # --- component pass, last rule in the page's own <style> ------------
    pas = L_BEG + "\n" + layer3.rstrip() + "\n" + L_END + "\n"
    if L_BEG in s:
        s = re.sub(re.escape(L_BEG) + r".*?" + re.escape(L_END) + r"\n",
                   lambda _m: pas, s, count=1, flags=re.S)
    else:
        k = s.index("</style>")
        s = s[:k] + pas + s[k:]

    # --- SVG rects are part of the chassis: no radii there either --------
    s = re.sub(' (r[xy])="[0-9.]+"', lambda m: ' ' + m.group(1) + '="0"', s)

    path.write_text(s, encoding="utf-8")
    print(f"{path.name}: skinned, {len(s.encode()) // 1024} kb")


if __name__ == "__main__":
    targets = sys.argv[1:] or PAGES
    for name in targets:
        apply(ROOT / "pages" / name)
