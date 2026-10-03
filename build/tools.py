# -*- coding: utf-8 -*-
"""Validate the tools panels and write them into content.py.

    python build/tools.py            # check only, change nothing
    python build/tools.py --write    # inject into build/content.py

WHY THE PANEL EXISTS. Avi opened block 01, rung 3, exercise 1 — ⟦|2x-1|<5⟧ — and found
nothing in the block explains an inequality or an absolute value, in text or on video.
An audit of all 90 workbook exercises and all 216 derived ones (nineteen agents, one per
unit and one per sitting; the report is build/cover/AUDIT.md) found the same shape 136
times: the how-to teaches the PROCEDURE and never names the RULES it calls. "ואז נגזרת"
with no differentiation rule. "עוברים לקדומה" with no antiderivative rule. The law of
sines in step one, with sine never defined as a ratio in a right triangle.

So the fix is one missing layer, not 136 patches — and this file is how it lands.

WHY THE `src` TAG IS THE POINT. Checking the gaps against the official נוסחאון
(data/nushaon.txt, extracted from the ministry's own PDF) turned the diagnosis around:
most of the missing rules ARE on the sheet. The differentiation rules, the integrals,
the arithmetic sequence, the laws of sines and cosines, the distance formula, the
double-angle identities — all there. What is genuinely absent and needed constantly:
the right-triangle definitions, the exact values of the special angles, every circle and
similarity theorem, absolute-value inequalities, and the general solution families.

Avi's problem was never that he could not find the rule. It was that nothing told him it
exists, where, and when to reach for it. That is one column of this panel.

WHAT IS CHECKED HERE. The same traps the rest of the repo has already been burnt by,
because content written by ten agents in parallel will hit every one of them:
  * maths loose in Hebrew prose — it reverses under RTL (`|q|<1` renders as `|1>|q|`)
  * `\\ne`, which this KaTeX build renders as an empty box
  * Hebrew inside `\\text{}`, which has no metrics and renders a hole
  * anything KaTeX 0.18.5 will not parse — rendered for real, not grepped
A KaTeX *warning* counts as a failure, exactly as in dprender.mjs: `strict:false` does
not throw on a glyph with no metrics, it warns and renders a hole.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
ROOT = HERE.parent

from content import HEAD, SHEET  # noqa: E402

# ≠, measured against the page's own embedded fonts (09.09.2026): `\ne`, `\neq`, `\not=`,
# `\mathrel{\not=}` and `{\not}{=}` ALL render as a missing-glyph box, because the woff2
# subset has no composed U+2260. `\mathrel{\char`≠}` is the only spelling that renders.
# This regex used to end at `\ne` with a lookahead that deliberately let `\neq` through,
# on the belief that `\neq` was the fix — so 82 boxes shipped on the sittings page. It
# now rejects both; `\newline` and `\nearrow` are still fine. (These three lived in
# derivecheck.py until the exam ladders it checked were removed, 17.09.2026.)
BARE_NE = re.compile(r"\\neq?(?![a-zA-Z])")

LOOSE_MATH = re.compile(r"(?<!⟦)(?<![\w\\])(?:[A-Za-z]\s*(?:\(|_|\^|=)|\\[a-zA-Z]+|\d+\s*[=<>+^])")


def outside_marks(text: str) -> str:
    """The text with every ⟦…⟧ span removed — what RTL is left holding."""
    return re.sub(r"⟦[^⟧]*⟧", " ", text)


COVER = HERE / "cover"
CONTENT = HERE / "content.py"
BLOCKS = [f"{i:02d}" for i in range(1, 11)]
MIN_ROWS, MAX_ROWS = 5, 14


def load(bid: str) -> list:
    f = COVER / f"tools-{bid}.json"
    if not f.exists():
        raise SystemExit(f"{f.name} is missing — the writer for block {bid} did not run")
    rows = json.loads(f.read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise SystemExit(f"{f.name}: expected a list")
    return rows


def check(bid: str, rows: list, bad: list, tex: dict) -> None:
    if not MIN_ROWS <= len(rows) <= MAX_ROWS:
        bad.append(f"{bid}: {len(rows)} rows, wanted {MIN_ROWS}-{MAX_ROWS}")
    seen = set()
    for i, r in enumerate(rows):
        where = f"{bid}[{i}]"
        if set(r) != {"name", "rule", "src"}:
            bad.append(f"{where}: keys {sorted(r)}")
            continue
        if r["src"] not in (SHEET, HEAD):
            bad.append(f"{where}: src {r['src']!r} is neither {SHEET!r} nor {HEAD!r}")
        if r["name"] in seen:
            bad.append(f"{where}: duplicate name {r['name']!r}")
        seen.add(r["name"])
        for field in ("name", "rule"):
            text = r[field]
            loose = outside_marks(text)
            hit = LOOSE_MATH.search(loose)
            if hit:
                bad.append(f"{where}.{field}: maths outside ⟦…⟧ near {hit.group(0)!r}")
            if BARE_NE.search(text):
                bad.append(f"{where}.{field}: \\ne/\\neq render as a box — use \\mathrel{{\\char`≠}}")
            for f in re.findall(r"⟦(.*?)⟧", text):
                if re.search(r"\\text\{[^}]*[\u0590-\u05FF]", f):
                    bad.append(f"{where}.{field}: Hebrew inside \\text{{}}")
                tex[f] = f
        # a colon straight before a formula jumps to the wrong side under RTL
        if re.search(r":\s*⟦", r["rule"]):
            bad.append(f"{where}.rule: colon immediately before ⟦…⟧ — use a dash")


def render(tex: dict) -> None:
    """Every formula through the repo's own KaTeX, pinned at 0.18.5.

    Grep only knows the traps that have already hurt. An unbalanced brace or a macro this
    build does not carry passes every rule above and explodes during the page build,
    when there are ten files in flight and nothing says which one.
    """
    if not tex:
        return
    tmp_in, tmp_out = HERE / "tl_tex.json", HERE / "tl_html.json"
    tmp_in.write_text(json.dumps(tex, ensure_ascii=False), encoding="utf-8")
    r = subprocess.run(["node", str(HERE / "dprender.mjs"), str(tmp_in), str(tmp_out)],
                       cwd=str(ROOT), capture_output=True, text=True)
    sys.stderr.write(r.stderr)
    if r.returncode:
        raise SystemExit("KaTeX rejected a formula — see above")
    done = json.loads(tmp_out.read_text(encoding="utf-8"))
    missing = sorted(set(tex) - set(done))
    if missing:
        raise SystemExit(f"{len(missing)} formulas did not render: {missing[:3]}")
    print(f"katex       : {len(done)}/{len(tex)} formulas rendered")


def literal(rows: list) -> str:
    """The rows as a Python list literal for content.py.

    `repr` does the escaping, so a LaTeX backslash survives as `\\\\` exactly the way the
    hand-written entries in that file already spell it. SHEET/HEAD go in as names rather
    than as strings — they are a closed set with one home, and content.py is it.
    """
    out = ['    "tools": [']
    for r in rows:
        tag = "SHEET" if r["src"] == SHEET else "HEAD"
        out.append(f"        ({r['name']!r},")
        out.append(f"         {r['rule']!r},")
        out.append(f"         {tag}),")
    out.append("    ],")
    return "\n".join(out)


def inject(all_rows: dict) -> None:
    raw = CONTENT.read_bytes()
    crlf = b"\r\n" in raw
    s = raw.decode("utf-8").replace("\r\n", "\n")
    for bid, rows in all_rows.items():
        head = f"B{bid} = {{\n"
        if head not in s:
            raise SystemExit(f"content.py: no `{head.strip()}`")
        if f'B{bid} = {{\n    "tools"' in s:
            raise SystemExit(f"block {bid} already has a tools panel — "
                             "remove it before re-injecting")
        s = s.replace(head, head + literal(rows) + "\n", 1)
    CONTENT.write_bytes((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
    print(f"content.py  : {len(raw)} -> {CONTENT.stat().st_size} bytes "
          f"({'CRLF' if crlf else 'LF'} kept)")


def main() -> int:
    all_rows, bad, tex = {}, [], {}
    for bid in BLOCKS:
        rows = load(bid)
        check(bid, rows, bad, tex)
        all_rows[bid] = rows

    n = sum(len(v) for v in all_rows.values())
    sheet = sum(1 for v in all_rows.values() for r in v if r["src"] == SHEET)
    print(f"blocks      : {len(all_rows)}")
    print(f"rules       : {n}  ({sheet} {SHEET}, {n - sheet} {HEAD})")
    render(tex)

    if bad:
        print(f"\n{len(bad)} FAILED:")
        for b in bad:
            print("  " + b)
        return 1
    print("schema, typography and maths all clean")

    if "--write" in sys.argv:
        inject(all_rows)
    else:
        print("(dry run — pass --write to inject into content.py)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
