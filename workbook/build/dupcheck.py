"""Does any exercise repeat another one in the same block?
`python build/dupcheck.py [workbook.html]`

`qsim.py` asks whether an exercise is too close to a real exam question. This asks the
other question, which nothing was asking: whether an exercise repeats another exercise
*in the workbook itself*.

It exists because one slipped through. Block 07 ended up investigating the same function,
f(x) = (x^2+3)/(x-1), at rung 2 and again at rung 3 - the tier-3 version was written from
scratch without noticing the intermediate rung already had it. Nine exercises to a block
is exactly the volume at which reading them all before adding one stops happening.

The check is on the FORMULAS, not on the wording. Wording is the wrong signal here and
measuring it was a dead end: every induction exercise opens "הוכיחו באינדוקציה מתמטית כי
לכל n טבעי", so a pair of completely different induction questions scores 0.85 on n-gram
containment. Within a topic the phrasing is supposed to be identical. What must not
repeat is the object - the function, the sequence, the figure.

Comparison is per block: the same standard function appearing in two different topics is
normal and often deliberate.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIN_LEN = 12         # below this it is a symbol, not an object: "x", "n", "a_{1}"


def is_object(tex: str) -> bool:
    """Is this an object the exercise is ABOUT, or scaffolding around it?

    A domain repeats on purpose - three trigonometry exercises over 0 ≤ x ≤ 2π is not a
    duplicate, it is the same syllabus. So a bare inequality does not count. What counts
    is something being defined or evaluated: a function, a sequence, an integral."""
    if "=" in tex.replace("\\le", "").replace("\\ge", "").replace("\\neq", ""):
        return True
    return "\\int" in tex


def norm(tex: str) -> str:
    """Same expression, same string - so a \\dfrac cannot hide behind a \\frac."""
    t = re.sub(r"\s+", "", tex)
    t = t.replace("\\dfrac", "\\frac").replace("\\tfrac", "\\frac")
    t = t.replace("\\left", "").replace("\\right", "").replace("\\,", "")
    t = re.sub(r"\\displaystyle", "", t)
    return t


def exercises(path):
    """(label, topic, [formulas]) for every exercise: block, rung, position in rung."""
    s = Path(path).read_text(encoding="utf-8")
    idx = [m.start() for m in re.finditer(r'class="block"', s)]
    idx.append(s.find('<p class="foot"'))
    out = []
    for a, b in zip(idx, idx[1:]):
        seg = s[a:b]
        num = re.search(r'class="bnum">(.*?)<', seg).group(1)
        topic = re.sub(r"<.*?>", "", re.search(r"<h3>(.*?)</h3>", seg, re.S).group(1)).strip()
        for lvl in "123":
            m = re.search(r'<div class="rung r%s">([\s\S]*?)\n      </div>' % lvl, seg)
            if not m:
                continue
            qx = re.findall(r'<div class="qx">([\s\S]*?)\n        </div>', m.group(1))
            for i, chunk in enumerate(qx or [m.group(1)], start=1):
                # straight out of the raw HTML: the LaTeX source KaTeX kept alongside its
                # render. Cleaning the chunk to text first was the bug in the first
                # version of this file - stripping the <math> element took the
                # annotation, and the formulas, away with it.
                tex = re.findall(
                    r'<annotation encoding="application/x-tex">([\s\S]*?)</annotation>',
                    chunk)
                keep = {norm(t) for t in tex
                        if len(norm(t)) >= MIN_LEN and is_object(norm(t))}
                out.append((f"{num}.{lvl}.{i}", topic, keep))
    return out


def main(path):
    ex = exercises(path)
    print(f"exercises found: {len(ex)}  "
          f"(formulas long enough to matter: {sum(len(f) for _, _, f in ex)})\n")
    hits = 0
    for i, (la, topic, fa) in enumerate(ex):
        for lb, _, fb in ex[i + 1:]:
            if la.split(".")[0] != lb.split(".")[0]:
                continue
            shared = fa & fb
            if shared:
                hits += 1
                print(f"REPEATED OBJECT  {la} and {lb}   ({topic})")
                for f in sorted(shared)[:3]:
                    print(f"      {f}")
    print(f"\n{'no repeats' if not hits else str(hits) + ' pair(s) to look at'}")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else ROOT / "pages" / "workbook.html"))
