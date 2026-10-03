"""Surface-similarity detector: how close is each tier-3 question to ANY real
exam question, across all 18 papers — not only the one it cites.

This is the half of the rule that a machine can decide on its own. It answers
"did I reword instead of re-invent", which is exactly the failure that slipped
through block 07: it cited winter 2026 and copied summer 2025, so a check
against the cited paper alone saw nothing.

Method: normalise both texts to Hebrew letters, Latin letters and digits, take
character 5-grams, and score containment = |grams(mine) & grams(theirs)| /
|grams(mine)|. Containment, not Jaccard: a short invented question hiding inside
a long exam question must still score high.

Usage:  python build/qsim.py [workbook.html]          # tier 3, one line per exercise
        python build/qsim.py --all [workbook.html]    # every tier, flagged exercises only

`--all` exists because this script only ever scored tier 3, and the grounding audit of
17.09.2026 found 33 of 94 workbook exercises at or above the flag once every tier was
scored. Most are short warm-ups inflated by two stock phrases (containment is biased by size
at both ends; see CLAUDE.md) — which is why it prints the sizes and the shared text, not a verdict.

`corpus()` and `score()` are the one definition of the baseline. groundfix.py scores against
the same thing, so it imports these rather than rebuild it.
"""
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIDI = "‎‏‪‫‬‭‮⁦⁧⁨⁩"
N = 5
FLAG = 0.20          # anything at or above this wants a human look
DF_MAX = 0.12        # a gram in more than this share of questions is boilerplate
EXPLAIN = True       # on a flag, print the overlapping text itself


def norm(t):
    t = "".join(c for c in t if c not in BIDI)
    t = re.sub(r"[^א-תA-Za-z0-9]", "", t)
    return t


def grams(t):
    t = norm(t)
    return {t[i:i + N] for i in range(len(t) - N + 1)}



def shared_runs(a, b, limit=4):
    """The actual overlapping text, not just a score: merge the shared n-grams
    back into the longest runs so a human can see WHAT is shared. A high score
    made of stock phrasing looks completely different from a copied formula."""
    na, nb = norm(a), norm(b)
    ga = {na[i:i + N] for i in range(len(na) - N + 1)}
    gb = {nb[i:i + N] for i in range(len(nb) - N + 1)}
    hit = ga & gb
    runs, cur = [], ""
    for i in range(len(na) - N + 1):
        g = na[i:i + N]
        if g in hit:
            cur = (cur + na[i + N - 1]) if cur else g
        else:
            if cur:
                runs.append(cur)
            cur = ""
    if cur:
        runs.append(cur)
    return sorted(runs, key=len, reverse=True)[:limit]


# --- where a question starts -------------------------------------------------------
#
# This looked like a one-line regex twice, and was wrong both times. What it is really
# doing is reading a page whose layout `pdftotext` only half preserves, so the number can
# arrive in four different neighbourhoods:
#
#   1. alone at the left of its line          `      .3בכד א' יש...`
#   2. behind drawing labels or the opening formula, which stay Latin
#                                             `F      .4המרובע ABCD חסום...`
#                                             `Ol  Bl        .2בסרטוט שלפניכם מנסרה`
#                                             `z = x + yi .3הוא מספר מרוכב`
#   3. behind the page footer or the previous question's tail, which are Hebrew
#                                             `/המשך בעמוד /5     .3בכד א' יש...`
#   4. at the END of its line, the RTL run left intact
#                                             `נתונה הפונקצייה      .7`
#
# Hence three admissions rather than one pattern: nothing Hebrew before it (1 and 2), or
# it is set off by run-in whitespace (3), or it closes the line (4). A decimal can never
# qualify — `0.5` and `34.79` put a digit immediately before the dot, and the lookbehind
# demands a space there.
#
# THE ORACLE, and this is the part worth keeping: 35571 prints eight questions and 35572
# prints five, on every cover. A splitter is correct when each of the 18 papers yields
# 1..8 / 1..5, once each, in order. That is checkable, and it is what was used — the two
# earlier versions of this code scored 7/18 and 9/18 against it while looking fine.
#
# What that cost: `paper_questions()` is the baseline every originality check scores
# against, so each question it could not see was a question a new exercise could have
# been copied from in silence. The first repair recovered 16, this one another 19. The
# corpus is 117.
#
# 2022\u20132023 (17.09.2026) added 14 papers and one more neighbourhood: a stray digit from
# the opening formula lands between the number and the Hebrew \u2014 `.1 2\u05e0\u05ea\u05d5\u05e0\u05d4 \u05d0\u05dc\u05d9\u05e4\u05e1\u05d4`
# (35572 summer 2023). Up to two such digits are admitted before the Hebrew. The oracle
# now runs on 32 papers, and on the 74 old-track 35581/35582 papers as a regression.
# The oracle as data: how many questions each paper prints on its cover.
QUESTIONS = {"35571": 8, "35572": 5}
QUESTION_MARK = re.compile(r"(?<=[ \t])\.(\d)(?=[ \t]*(?:\d{1,2}[ \t]*)?(?:[\u0590-\u05ea]|$))")
_HEBREW = re.compile(r"[\u0590-\u05ea]")
_RUN_IN = re.compile(r"[ \t]{3,}$")


def question_marks(s):
    """Every question start in one paper's text, as (number, offset)."""
    out = []
    for line in re.finditer(r"^[^\n]*$", s, re.M):
        text = line.group(0)
        for hit in QUESTION_MARK.finditer(text):
            before, after = text[: hit.start()], text[hit.end() :]
            if (
                not _HEBREW.search(before)
                or _RUN_IN.search(before)
                or (not after.strip() and _RUN_IN.search(before))
            ):
                out.append((hit.group(1), line.start() + hit.start()))
                break  # one question can start per line
    return out


def paper_questions():
    """Every numbered question in every paper, as (paper, number, text)."""
    out = []
    for f in sorted((ROOT / "exams" / "text").glob("3557*.txt")):
        s = "".join(c for c in f.read_text(encoding="utf-8") if c not in BIDI)
        marks = question_marks(s)
        for k, (num, i) in enumerate(marks):
            j = marks[k + 1][1] if k + 1 < len(marks) else len(s)
            out.append((f.stem, num, s[i:j]))
    return out


def strip(t):
    """HTML to plain text, keeping the LaTeX source and dropping KaTeX's rendered copy."""
    t = re.sub(r'<annotation encoding="application/x-tex">([\s\S]*?)</annotation>', r" \1 ", t)
    t = re.sub(r'<span class="katex-html"[\s\S]*?</span></span></span>', " ", t)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    return re.sub(r"\s+", " ", t).strip()


def tier3(path):
    """Every tier-3 question in the workbook, as (label, topic, text).

    One entry per exercise, not per block. The rung holds three of them now, and reading
    the rung as a single lump would let a copied second or third question hide inside the
    combined text - the score is a containment ratio, so more text dilutes it."""
    s = Path(path).read_text(encoding="utf-8")
    idx = [m.start() for m in re.finditer(r'class="block"', s)]
    idx.append(s.find('<p class="foot"'))
    out = []
    for a, b in zip(idx, idx[1:]):
        seg = s[a:b]
        num = re.search(r'class="bnum">(.*?)<', seg).group(1)
        topic = re.search(r"<h3>(.*?)</h3>", seg).group(1)
        m = re.search(r'<div class="rung r3">([\s\S]*?)\n      </div>', seg)
        if not m:
            continue
        qx = re.findall(r'<div class="qx">([\s\S]*?)\n        </div>', m.group(1))
        if not qx:                       # page not yet rebuilt: one question per rung
            qx = [m.group(1)]
        for i, chunk in enumerate(qx, start=1):
            text = strip(chunk)
            if text:
                out.append(("%s.%d" % (num, i), topic, text))
    return out


def corpus():
    """The baseline every originality score is taken against.

    Returns (papers, common, text): papers is [(paper, number, grams)] with boilerplate
    removed, common is that boilerplate, text maps (paper, number) to the question.

    Raw n-gram overlap mostly measures the genre, not copying: every calculus question says
    "נתונה הפונקצייה" and "מצאו את שיעורי נקודות הקיצון". Every gram that recurs in more
    than DF_MAX of the questions is dropped, and only the rare ones are scored, which is
    where the actual content of a question lives."""
    qs = paper_questions()
    papers = [(p, n, grams(t)) for p, n, t in qs]
    df = {}
    for _, _, g in papers:
        for x in g:
            df[x] = df.get(x, 0) + 1
    cap = max(2, int(DF_MAX * len(papers)))
    common = {x for x, c in df.items() if c > cap}
    return ([(p, n, g - common) for p, n, g in papers], common,
            {(p, n): t for p, n, t in qs})


def score(text, papers, common, top=3):
    """(size of our text in grams, [(containment, paper, number, size of theirs)] best first)."""
    g = grams(text) - common
    scored = sorted(((len(g & pg) / max(1, len(g)), p, n, len(pg)) for p, n, pg in papers),
                    reverse=True)
    return len(g), scored[:top]


def every_tier(papers, common, text):
    """Every exercise of every tier, through exercises.py — the same reading of the built
    page the pad app gets. Prints only what reaches the flag, with both sizes and the
    shared text, because at this size the number alone cannot tell copying from genre."""
    import exercises
    flagged = total = 0
    for block, exs in exercises.blocks().items():
        for e in exs:
            total += 1
            size, scored = score(e["text"], papers, common)
            sc, p, n, theirs = scored[0]
            if sc < FLAG:
                continue
            flagged += 1
            print("%s  %-30s  %.3f  vs %s Q%s  (%d n-grams vs %d)"
                  % (block, e["label"], sc, p, n, size, theirs))
            for r in shared_runs(e["text"], text[(p, n)]):
                print("        shared: %s" % r)
    print("\n%d of %d exercises at or above %.2f — read the shared text before rewriting"
          % (flagged, total, FLAG))
    return 0


def main(wb, all_tiers=False):
    papers, common, text = corpus()
    print("papers indexed: %d questions from %d files"
          % (len(papers), len({p for p, _, _ in papers})))
    print("boilerplate dropped: %d grams\n" % len(common))
    if all_tiers:
        return every_tier(papers, common, text)

    worst = 0.0
    for num, topic, t in tier3(wb):
        _, scored = score(t, papers, common)
        top = scored[0]
        worst = max(worst, top[0])
        mark = "  <-- TOO CLOSE" if top[0] >= FLAG else ""
        print("%-5s %-24s  max %.3f  vs %s Q%s%s"
              % (num, topic[:24], top[0], top[1], top[2], mark))
        for sc, p, n, _ in scored[1:3]:
            print("%*s      %.3f  vs %s Q%s" % (5, "", sc, p, n))
        if top[0] >= FLAG and EXPLAIN:
            for r in shared_runs(t, text[(top[1], top[2])]):
                print("        shared: %s" % r)
    print("\nhighest similarity anywhere: %.3f (flag at %.2f)" % (worst, FLAG))
    return 1 if worst >= FLAG else 0


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--all"]
    wb = args[0] if args else ROOT / "pages" / "workbook.html"
    sys.exit(main(wb, "--all" in sys.argv))
